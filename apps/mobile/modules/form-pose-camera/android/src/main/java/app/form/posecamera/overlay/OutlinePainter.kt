package app.form.posecamera.overlay

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import app.form.posecamera.core.FillCenter
import app.form.posecamera.core.MaskGrid
import app.form.posecamera.core.PoseFrameResult
import app.form.posecamera.core.Polyline
import app.form.posecamera.core.capsuleOutline
import app.form.posecamera.core.chaikin
import app.form.posecamera.core.contours
import app.form.posecamera.core.ema

/** Where an outline came from. Shown in the diagnostics as the rung actually on screen. */
internal const val SOURCE_NONE = 0
internal const val SOURCE_MASK = 1
internal const val SOURCE_CAPSULE = 2

internal fun sourceName(source: Int): String = when (source) {
    SOURCE_MASK -> "mask"
    SOURCE_CAPSULE -> "capsule"
    else -> "none"
}

/** Lines in normalized region coordinates, ready to be mapped and stroked. */
internal class BuiltOutline(val lines: List<Polyline>, val source: Int) {
    companion object {
        val NONE = BuiltOutline(emptyList(), SOURCE_NONE)
    }
}

private const val MASK_EMA_ALPHA = 0.6f
private const val ISO = 0.5f
private const val MIN_AREA_FRAC = 0.015f
private const val MAX_LINES = 3
private const val CHAIKIN_ITERATIONS = 2
private const val TOTAL_POINT_CAP = 1200
private const val CAPSULE_MIN_VIS = 0.5f

/** A result without a mask reuses the last mask outline for this long before the capsule takes over. */
private const val MASK_STICKY_NS = 400_000_000L

/**
 * mask -> ema -> contours -> chaikin (or the landmark capsule when there is no mask), capped at
 * [TOTAL_POINT_CAP] points in total. Stateful (the mask EMA), not thread-safe: the caller serialises
 * [build] and [reset]. Runs on the submitting thread, never on the UI thread.
 */
internal class OutlinePipeline {
    private var held: MaskGrid? = null
    private var lastMaskLines: List<Polyline> = emptyList()
    private var lastMaskNs = 0L

    fun reset() {
        held = null
        lastMaskLines = emptyList()
        lastMaskNs = 0L
    }

    fun build(r: PoseFrameResult, nowNs: Long): BuiltOutline {
        val lm = r.landmarks
        if (lm == null || lm.size < 99) {
            // Nobody: forget the mask so a returning person does not blend with a stale silhouette.
            held = null
            return BuiltOutline.NONE
        }
        val mask = r.mask
        if (mask != null) {
            val smoothed = smooth(mask)
            val lines = finish(contours(smoothed, ISO, MIN_AREA_FRAC, MAX_LINES))
            if (lines.isNotEmpty()) {
                lastMaskLines = lines
                lastMaskNs = nowNs
                return BuiltOutline(lines, SOURCE_MASK)
            }
            // A blank or tiny mask while landmarks say a person is there: fall through to the capsule.
        } else {
            held = null
            if (lastMaskLines.isNotEmpty() && nowNs - lastMaskNs < MASK_STICKY_NS) {
                return BuiltOutline(lastMaskLines, SOURCE_MASK)
            }
        }
        val aspect = if (r.regionW > 0 && r.regionH > 0) r.regionW.toFloat() / r.regionH else 1f
        val lines = finish(capsuleOutline(lm, CAPSULE_MIN_VIS, aspect))
        return if (lines.isEmpty()) BuiltOutline.NONE else BuiltOutline(lines, SOURCE_CAPSULE)
    }

    /**
     * ema() may return [cur] itself (on reset) and the engine may reuse that grid's array for the
     * next frame, so the held grid is always our own copy.
     */
    private fun smooth(cur: MaskGrid): MaskGrid {
        val out = ema(held, cur, MASK_EMA_ALPHA)
        val own = if (out === cur) MaskGrid(cur.gw, cur.gh, cur.v.copyOf()) else out
        held = own
        return own
    }

    /** Chaikin on every line, then thin to the total point cap (proportionally, endpoints kept). */
    private fun finish(raw: List<Polyline>): List<Polyline> {
        if (raw.isEmpty()) return emptyList()
        val smoothed = ArrayList<Polyline>(raw.size)
        var total = 0
        for (p in raw) {
            if (smoothed.size >= MAX_LINES) break
            val c = chaikin(p, CHAIKIN_ITERATIONS, TOTAL_POINT_CAP)
            if (c.size < 2) continue
            smoothed.add(c)
            total += c.size
        }
        if (total <= TOTAL_POINT_CAP) return smoothed
        val capped = ArrayList<Polyline>(smoothed.size)
        for (c in smoothed) {
            val cap = (TOTAL_POINT_CAP.toLong() * c.size / total).toInt().coerceAtLeast(if (c.closed) 3 else 2)
            capped.add(if (c.size > cap) chaikin(c, 0, cap) else c)
        }
        return capped
    }
}

/** Glow layers, outermost drawn first: widths in dp. Index 0 is the dark halo under-stroke. */
private val LAYER_WIDTH_DP = floatArrayOf(4.5f, 14f, 9f, 5f, 2.5f)
private val LAYER_ALPHA = floatArrayOf(0.50f, 0.10f, 0.16f, 0.30f, 1.0f)

/** Layers drawn per governor level: 0 = all, 1 = halo + mid glow + core, 2 = inner glow + core. */
private val LEVEL_LAYERS = arrayOf(
    intArrayOf(0, 1, 2, 3, 4),
    intArrayOf(0, 2, 4),
    intArrayOf(3, 4),
)

/** How much white the core stroke is mixed with, so it reads as a bright tube inside the glow. */
private const val CORE_WHITE_MIX = 0.25f

/**
 * Draws the silhouette lines as a stack of strokes (no BlurMaskFilter: it is unreliable on hardware
 * canvases): a dark halo, three widening translucent glow strokes in the tone colour, and a core.
 * Path and point buffers are reused, so drawing allocates nothing per frame.
 */
internal class OutlinePainter(density: Float) {
    private val path = Path()
    private var px = FloatArray(1400)
    private var py = FloatArray(1400)
    private val paints = Array(LAYER_WIDTH_DP.size) { i ->
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            strokeWidth = LAYER_WIDTH_DP[i] * density
        }
    }

    /**
     * [dx]/[dy] shift every point (normalized units, the rigid torso extrapolation). [alpha] is the
     * presence fade (0..1). [level] is the governor level (0 = full quality).
     */
    fun draw(
        canvas: Canvas,
        lines: List<Polyline>,
        fc: FillCenter,
        dx: Float,
        dy: Float,
        toneColor: Int,
        haloColor: Int,
        alpha: Float,
        level: Int,
    ) {
        if (lines.isEmpty() || alpha <= 0f) return
        val lvl = level.coerceIn(0, LEVEL_LAYERS.size - 1)
        if (!buildPath(lines, fc, dx, dy, smooth = lvl < 2, stride = if (lvl >= 2) 2 else 1)) return
        val coreColor = mixWhite(toneColor, CORE_WHITE_MIX)
        for (i in LEVEL_LAYERS[lvl]) {
            val p = paints[i]
            p.color = when (i) {
                0 -> haloColor
                4 -> coreColor
                else -> toneColor
            }
            p.alpha = (LAYER_ALPHA[i] * alpha * 255f + 0.5f).toInt().coerceIn(0, 255)
            canvas.drawPath(path, p)
        }
    }

    private fun mixWhite(c: Int, k: Float): Int {
        val r = ((c shr 16) and 0xFF)
        val g = ((c shr 8) and 0xFF)
        val b = (c and 0xFF)
        val rr = (r + (255 - r) * k).toInt()
        val gg = (g + (255 - g) * k).toInt()
        val bb = (b + (255 - b) * k).toInt()
        return (0xFF shl 24) or (rr shl 16) or (gg shl 8) or bb
    }

    private fun ensure(n: Int) {
        if (px.size < n + 1) {
            px = FloatArray(n + 64)
            py = FloatArray(n + 64)
        }
    }

    /** Maps the lines to view pixels into one reused Path. Returns false when nothing was added. */
    private fun buildPath(lines: List<Polyline>, fc: FillCenter, dx: Float, dy: Float, smooth: Boolean, stride: Int): Boolean {
        path.rewind()
        var any = false
        for (line in lines) {
            val n = line.size
            if (n < 2) continue
            ensure(n)
            val step = if (stride > 1 && n > 8) stride else 1
            var m = 0
            var i = 0
            while (i < n) {
                px[m] = fc.x(line.xs[i] + dx)
                py[m] = fc.y(line.ys[i] + dy)
                m++
                i += step
            }
            if (!line.closed && i - step != n - 1) {
                px[m] = fc.x(line.xs[n - 1] + dx)
                py[m] = fc.y(line.ys[n - 1] + dy)
                m++
            }
            if (m < 2 || (line.closed && m < 3)) continue
            any = true
            if (smooth) appendSmooth(m, line.closed) else appendPlain(m, line.closed)
        }
        return any
    }

    private fun appendPlain(m: Int, closed: Boolean) {
        path.moveTo(px[0], py[0])
        for (k in 1 until m) path.lineTo(px[k], py[k])
        if (closed) path.close()
    }

    /** Quadratic curve through segment midpoints: C1-smooth with the points as control points. */
    private fun appendSmooth(m: Int, closed: Boolean) {
        if (closed) {
            path.moveTo((px[m - 1] + px[0]) * 0.5f, (py[m - 1] + py[0]) * 0.5f)
            for (k in 0 until m) {
                val j = if (k + 1 == m) 0 else k + 1
                path.quadTo(px[k], py[k], (px[k] + px[j]) * 0.5f, (py[k] + py[j]) * 0.5f)
            }
            path.close()
        } else {
            path.moveTo(px[0], py[0])
            if (m == 2) {
                path.lineTo(px[1], py[1])
                return
            }
            path.lineTo((px[0] + px[1]) * 0.5f, (py[0] + py[1]) * 0.5f)
            for (k in 1 until m - 1) {
                path.quadTo(px[k], py[k], (px[k] + px[k + 1]) * 0.5f, (py[k] + py[k + 1]) * 0.5f)
            }
            path.lineTo(px[m - 1], py[m - 1])
        }
    }
}
