package app.form.posecamera.overlay

import android.content.Context
import android.graphics.Canvas
import android.os.SystemClock
import android.view.View
import app.form.posecamera.core.Extrapolator
import app.form.posecamera.core.FillCenter
import app.form.posecamera.core.OverlayMode
import app.form.posecamera.core.OverlayStyle
import app.form.posecamera.core.Palette
import app.form.posecamera.core.PoseFrameResult
import app.form.posecamera.core.Polyline
import app.form.posecamera.core.Tone
import java.util.Arrays
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

/** Draw statistics, refreshed about once a second. Times are milliseconds. */
class OverlayStats(
    /** Mean time spent in onDraw (recording the canvas commands, not GPU time). */
    val drawMs: Float,
    /** Result age at draw: elapsedRealtime at draw minus the capture time of the displayed result. Not photon-to-pixel. */
    val ageP50: Float,
    val ageP95: Float,
    /** Slowest onDraw in the window. */
    val drawMsMax: Float = 0f,
    /** Outline source on screen: "mask", "capsule" or "none" (joints only). */
    val source: String = "none",
    /** Governor level: 0 = full quality, 2 = simplest. */
    val level: Int = 0,
)

/** Everything the UI thread needs about one result. Immutable once published. */
private class Snapshot(
    val captureNs: Long,
    val regionW: Int,
    val regionH: Int,
    /** Own copy of the 99 landmark floats; null = nobody in this result. */
    val landmarks: FloatArray?,
    val lines: List<Polyline>,
    val source: Int,
)

private const val HOLD_NS = 250_000_000L
private const val FADE_IN_MS = 120f
private const val FADE_OUT_MS = 200f

/** Colour change time constant when the tone changes. */
private const val TONE_TAU_MS = 90f

private const val MAX_LEAD_MS = 120f
private const val MAX_DISP = 0.06f
private const val MAX_SPEED = 2.5f
private const val VEL_TAU_MS = 60f

/** Restart the time origin after this long so Float milliseconds keep sub-millisecond precision. */
private const val REBASE_NS = 20L * 60L * 1_000_000_000L

private const val STATS_WINDOW_NS = 1_000_000_000L
private const val AGE_RING = 256

/** Governor: simplify above this smoothed onDraw time, recover well below it. */
private const val BUDGET_MS = 8f
private const val RECOVER_MS = 3f
private const val WARMUP_FRAMES = 10
private const val DEGRADE_FRAMES = 30
private const val RECOVER_FRAMES = 300
private const val MAX_LEVEL = 2

/**
 * Transparent view over the preview: the glowing body outline plus small dots on the exercise's
 * chain joints.
 *
 * Threading: [submit] may be called from any thread (normally the engine's result thread); it does
 * the mask/capsule to polyline work there and publishes one immutable snapshot through a volatile
 * reference, so it never blocks and never waits for the UI thread. Everything else (extrapolation,
 * smoothing, fades, painting) happens on the UI thread in onDraw, at display rate through
 * postInvalidateOnAnimation while something is visible, and idle otherwise.
 */
class OverlayView(context: Context) : View(context) {
    @Volatile private var style: OverlayStyle? = null
    @Volatile private var fillW = 0
    @Volatile private var fillH = 0
    @Volatile private var mirrorX = false

    @Volatile private var latest: Snapshot? = null
    @Volatile private var stats = OverlayStats(0f, 0f, 0f)
    private val epoch = AtomicInteger()

    // Submit-side state, guarded by prepLock.
    private val prepLock = Any()
    private val pipeline = OutlinePipeline()

    // UI-thread state.
    private val density = resources.displayMetrics.density
    private val outlinePainter = OutlinePainter(density)
    private val jointPainter = JointPainter(density)
    private var extrapolator = newExtrapolator()
    private val exOut = FloatArray(99)
    private var consumed: Snapshot? = null
    private var shown: Snapshot? = null
    private var seenEpoch = 0
    private var originNs = 0L
    private var lastSeenNs = 0L
    private var frozen = false
    private var frozenAtMs = 0f
    private var presence = 0f
    private var lastFrameNs = 0L
    private var toneColor = 0
    private var hasToneColor = false
    private var fc: FillCenter? = null
    private var fcRegionW = 0
    private var fcRegionH = 0
    private var fcViewW = 0f
    private var fcViewH = 0f
    private var fcMirror = false

    // Stats and governor.
    private val ages = FloatArray(AGE_RING)
    private val agesSorted = FloatArray(AGE_RING)
    private var ageN = 0
    private var drawSum = 0f
    private var drawMax = 0f
    private var drawN = 0
    private var windowStartNs = 0L
    private var level = 0
    private var framesDrawn = 0
    private var smoothedMs = -1f
    private var framesSinceChange = 0
    private var lowFrames = 0
    private var shownSource = SOURCE_NONE

    init {
        setWillNotDraw(false)
        isClickable = false
        isFocusable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    /** Any thread. Applies from the next frame. */
    fun setStyle(s: OverlayStyle) {
        style = s
        postInvalidateOnAnimation()
    }

    /**
     * Called on region change. The mirror flag is applied at draw time only (the data is never
     * mirrored). The image size is only a fallback: each result carries its own region size, which
     * is what its normalized coordinates refer to.
     */
    fun setFill(imgW: Int, imgH: Int, mirrorX: Boolean) {
        fillW = imgW
        fillH = imgH
        this.mirrorX = mirrorX
        postInvalidateOnAnimation()
    }

    /** Any thread. Never blocks on the UI thread. */
    fun submit(r: PoseFrameResult) {
        val st = style
        val built = if (st != null && st.mode == OverlayMode.OUTLINE && r.landmarks != null) {
            synchronized(prepLock) { pipeline.build(r, SystemClock.elapsedRealtimeNanos()) }
        } else {
            if (r.landmarks == null) synchronized(prepLock) { pipeline.reset() }
            BuiltOutline.NONE
        }
        val lm = r.landmarks
        val capture = if (r.captureNs > 0L) r.captureNs else r.arrivedNs
        latest = Snapshot(
            capture,
            r.regionW,
            r.regionH,
            if (lm != null && lm.size >= 99) lm.copyOf(99) else null,
            built.lines,
            built.source,
        )
        postInvalidateOnAnimation()
    }

    /** Any thread. Removes everything at once (no fade) and forgets all smoothing state. */
    fun clear() {
        synchronized(prepLock) { pipeline.reset() }
        latest = null
        epoch.incrementAndGet()
        postInvalidateOnAnimation()
    }

    fun drawStats(): OverlayStats = stats

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (latest != null) postInvalidateOnAnimation()
    }

    override fun onDetachedFromWindow() {
        lastFrameNs = 0L
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val t0 = System.nanoTime()
        val now = SystemClock.elapsedRealtimeNanos()
        val ep = epoch.get()
        if (ep != seenEpoch) {
            seenEpoch = ep
            resetDrawState()
        }
        val st = style
        val vw = width.toFloat()
        val vh = height.toFloat()
        if (st == null || st.mode == OverlayMode.OFF || vw <= 0f || vh <= 0f) {
            lastFrameNs = 0L
            return
        }

        val snap = latest
        if (snap !== consumed) {
            consumed = snap
            if (snap != null) onSnapshot(snap, now)
        }

        val dtMs = if (lastFrameNs == 0L) 16f else ((now - lastFrameNs) / 1e6f).coerceIn(0f, 50f)
        lastFrameNs = now
        updatePresence(now, dtMs, st.reduceMotion)
        val sh = shown
        if (sh == null || presence <= 0.002f) {
            // Idle: nothing is visible, so do not schedule another frame. submit() wakes the view.
            presence = 0f
            lastFrameNs = 0L
            return
        }
        val lm = sh.landmarks
        if (lm == null) {
            shown = null
            return
        }

        // Display time and the extrapolated landmarks.
        val nowMs = (now - originNs) / 1e6f
        val tDispMs = if (frozen) min(nowMs, frozenAtMs) else nowMs
        extrapolator.at(tDispMs, st.leadMs.toFloat(), exOut)
        val fill = fillFor(sh, vw, vh)

        val target = toneOf(st.palette, st.tone)
        updateToneColor(target, dtMs, st.reduceMotion)
        val eased = if (st.reduceMotion) presence else presence * presence * (3f - 2f * presence)

        if (st.mode == OverlayMode.OUTLINE && sh.lines.isNotEmpty()) {
            outlinePainter.draw(
                canvas, sh.lines, fill,
                extrapolator.torsoDx, extrapolator.torsoDy,
                toneColor, st.palette.halo, eased, level,
            )
        }
        jointPainter.draw(
            canvas, exOut, st.chain, fill, nowMs / 1000f, dtMs,
            toneColor, st.palette.highlight, eased, st.reduceMotion, level >= 2,
        )
        shownSource = sh.source

        recordStats(now, (now - sh.captureNs) / 1e6f, (System.nanoTime() - t0) / 1e6f)
        postInvalidateOnAnimation()
    }

    /** UI thread: a new result becomes the displayed one. */
    private fun onSnapshot(s: Snapshot, nowNs: Long) {
        val lm = s.landmarks
        if (lm == null) {
            // Nobody: keep showing the last outline for the hold period, frozen where it was.
            if (!frozen && shown != null) {
                frozen = true
                frozenAtMs = (nowNs - originNs) / 1e6f
            }
            return
        }
        if (originNs == 0L || s.captureNs - originNs > REBASE_NS || s.captureNs < originNs) {
            originNs = s.captureNs
            extrapolator = newExtrapolator()
            // The filters' timestamps are on the old origin.
            jointPainter.resetFilters()
        }
        extrapolator.update((s.captureNs - originNs) / 1e6f, lm)
        shown = s
        lastSeenNs = nowNs
        frozen = false
    }

    private fun updatePresence(nowNs: Long, dtMs: Float, reduceMotion: Boolean) {
        val present = shown != null && nowNs - lastSeenNs < HOLD_NS
        presence = if (reduceMotion) {
            if (present) 1f else 0f
        } else if (present) {
            min(1f, presence + dtMs / FADE_IN_MS)
        } else {
            max(0f, presence - dtMs / FADE_OUT_MS)
        }
    }

    private fun updateToneColor(target: Int, dtMs: Float, reduceMotion: Boolean) {
        if (!hasToneColor || reduceMotion || toneColor == target) {
            toneColor = target
            hasToneColor = true
            return
        }
        val k = 1f - exp(-dtMs / TONE_TAU_MS)
        toneColor = lerpArgb(toneColor, target, k)
    }

    private fun fillFor(s: Snapshot, vw: Float, vh: Float): FillCenter {
        val rw = if (s.regionW > 0) s.regionW else fillW
        val rh = if (s.regionH > 0) s.regionH else fillH
        val mirror = mirrorX
        val cached = fc
        if (cached != null && rw == fcRegionW && rh == fcRegionH && vw == fcViewW && vh == fcViewH && mirror == fcMirror) {
            return cached
        }
        val made = FillCenter.of(rw, rh, vw, vh, mirror)
        fc = made
        fcRegionW = rw
        fcRegionH = rh
        fcViewW = vw
        fcViewH = vh
        fcMirror = mirror
        return made
    }

    private fun resetDrawState() {
        consumed = null
        shown = null
        presence = 0f
        frozen = false
        lastSeenNs = 0L
        originNs = 0L
        hasToneColor = false
        shownSource = SOURCE_NONE
        extrapolator = newExtrapolator()
        jointPainter.reset()
    }

    private fun recordStats(nowNs: Long, ageMs: Float, drawMs: Float) {
        if (windowStartNs == 0L) windowStartNs = nowNs
        if (ageN < AGE_RING) ages[ageN++] = ageMs
        drawSum += drawMs
        drawN++
        if (drawMs > drawMax) drawMax = drawMs
        governor(drawMs)
        if (nowNs - windowStartNs >= STATS_WINDOW_NS) {
            var p50 = 0f
            var p95 = 0f
            if (ageN > 0) {
                System.arraycopy(ages, 0, agesSorted, 0, ageN)
                Arrays.sort(agesSorted, 0, ageN)
                p50 = agesSorted[((ageN - 1) * 0.50f).toInt()]
                p95 = agesSorted[((ageN - 1) * 0.95f).toInt()]
            }
            stats = OverlayStats(
                if (drawN > 0) drawSum / drawN else 0f,
                p50, p95, drawMax, sourceName(shownSource), level,
            )
            ageN = 0
            drawSum = 0f
            drawN = 0
            drawMax = 0f
            windowStartNs = nowNs
        }
    }

    /** Simplifies drawing when onDraw stays over budget; restores it after a long calm spell. */
    private fun governor(drawMs: Float) {
        framesDrawn++
        if (framesDrawn <= WARMUP_FRAMES) return
        smoothedMs = if (smoothedMs < 0f) drawMs else smoothedMs * 0.9f + drawMs * 0.1f
        framesSinceChange++
        if (smoothedMs > BUDGET_MS && level < MAX_LEVEL && framesSinceChange >= DEGRADE_FRAMES) {
            level++
            framesSinceChange = 0
            lowFrames = 0
        } else if (smoothedMs < RECOVER_MS && level > 0) {
            lowFrames++
            if (lowFrames >= RECOVER_FRAMES) {
                level--
                lowFrames = 0
                framesSinceChange = 0
                smoothedMs = -1f
            }
        } else {
            lowFrames = 0
        }
    }

    private fun newExtrapolator() = Extrapolator(MAX_LEAD_MS, MAX_DISP, MAX_SPEED, VEL_TAU_MS)

    private fun toneOf(p: Palette, t: Tone): Int = when (t) {
        Tone.GOOD -> p.good
        Tone.FIX -> p.fix
        Tone.WARN -> p.warn
        Tone.UNTRACKABLE -> p.untrackable
    }

    /** Per-channel step toward [b] that always makes progress (so the colour converges exactly). */
    private fun lerpArgb(a: Int, b: Int, k: Float): Int {
        var out = 0xFF shl 24
        var shift = 16
        while (shift >= 0) {
            val ca = (a ushr shift) and 0xFF
            val cb = (b ushr shift) and 0xFF
            val d = cb - ca
            val stepF = d * k
            val step = when {
                d == 0 -> 0
                abs(stepF) < 1f -> if (d > 0) 1 else -1
                else -> stepF.toInt()
            }
            out = out or ((ca + step).coerceIn(0, 255) shl shift)
            shift -= 8
        }
        return out
    }
}
