package app.form.posecamera

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import app.form.posecamera.core.OverlayMode
import app.form.posecamera.core.OverlayStyle
import app.form.posecamera.core.Palette
import app.form.posecamera.core.PoseFrameResult
import app.form.posecamera.core.Prefs
import app.form.posecamera.core.Rung
import app.form.posecamera.core.Tone
import app.form.posecamera.core.parseHex
import app.form.posecamera.engine.CameraController
import app.form.posecamera.engine.CameraListener
import app.form.posecamera.engine.EngineConfig
import app.form.posecamera.engine.EngineListener
import app.form.posecamera.engine.PoseEngine
import app.form.posecamera.overlay.OverlayView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Hosts the CameraX preview, the pose engine and the overlay.
 *
 * The module's prop setters only store; [applyProps] runs once per update batch and
 * (re)starts the camera + engine session only when a prop that needs a new session changed.
 * Style props (tone, chain, palette, overlay mode, reduce motion, lead) never restart anything.
 */
@SuppressLint("ViewConstructor")
class FormPoseCameraView(
    context: Context,
    appContext: AppContext,
) : ExpoView(context, appContext) {

    // Props, written by the module's setters.
    var active: Boolean = false
    var facing: String = "front"
    var modelUrl: String = ""
    var liteModelUrl: String? = null
    var confidence: FloatArray = floatArrayOf(0.5f, 0.5f, 0.5f)
    var budgetMs: Int = 32
    var overlayMode: String = "outline"
    var tone: String = "good"
    var chain: IntArray = IntArray(0)
    var palette: PaletteProp = PaletteProp()
    var reduceMotion: Boolean = false
    var maskEnabled: Boolean = true
    var leadMs: Int = 60
    var diagnostics: Boolean = false

    private val onCamera by EventDispatcher<CameraEvent>()
    private val onPose by EventDispatcher<PoseEvent>()

    // Frames and diagnostics are latest-wins: a constant coalescing key lets React Native drop a
    // stale event that JS has not consumed yet. State events (camera, pose) are never coalesced.
    private val onFrame by EventDispatcher<FrameEvent>(coalescingKey = { _ -> 0.toShort() })
    private val onDiag by EventDispatcher<DiagEvent>(coalescingKey = { _ -> 0.toShort() })

    private val previewView = PreviewView(context).apply {
        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        scaleType = PreviewView.ScaleType.FILL_CENTER
    }
    private val overlay = OverlayView(context).apply {
        isClickable = false
        isFocusable = false
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    // Current session. `generation` invalidates callbacks from a session that was already stopped.
    @Volatile private var generation = 0
    private var sessionKey: String? = null
    private var engine: PoseEngine? = null
    private var cameraController: CameraController? = null
    @Volatile private var regionW = 0
    @Volatile private var regionH = 0
    // Frame events to JS are capped at about 40 Hz, so 30 fps results with a little jitter are not
    // dropped (the rep engine samples at most every 50 ms anyway); the overlay still gets every result.
    @Volatile private var lastFrameEventNs = 0L

    private val diagTick = object : Runnable {
        override fun run() {
            diagScheduled = false
            emitDiag()
            syncDiagnostics()
        }
    }
    private var diagScheduled = false

    init {
        addView(previewView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        addView(overlay, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    // PreviewView adds its TextureView only once CameraX asks for a surface, after React Native has
    // laid this view out. React Native swallows that child's requestLayout, so without Android layout
    // the TextureView stays 0x0, no preview surface is ever provided, the camera session never starts
    // and no frame reaches the analyzer ("The camera didn't start").
    override val shouldUseAndroidLayout: Boolean = true

    // Both children always fill the view. The FILL_CENTER crop is done by PreviewView and mirrored
    // by the overlay's FillCenter, so neither child needs a measure result of its own.
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        val w = right - left
        val h = bottom - top
        val exactW = MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY)
        val exactH = MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY)
        previewView.measure(exactW, exactH)
        previewView.layout(0, 0, w, h)
        overlay.measure(exactW, exactH)
        overlay.layout(0, 0, w, h)
    }

    /** Called once per prop update batch (OnViewDidUpdateProps). */
    fun applyProps() {
        overlay.setStyle(buildStyle())

        val key = if (active && modelUrl.isNotEmpty()) {
            listOf(facing, modelUrl, liteModelUrl ?: "", budgetMs, maskEnabled, confidence.joinToString(","))
                .joinToString("|")
        } else {
            null
        }
        if (key != sessionKey) {
            stopSession()
            sessionKey = key
            if (key != null) startSession()
        }
        syncDiagnostics()
    }

    // A view that is detached but not destroyed must never keep the camera running; the session key is
    // kept so that re-attaching restarts it.
    // React Native can detach and re-attach this view while re-parenting it (e.g. when a wrapper view
    // is flattened or un-flattened on a re-render). Stopping right away turned every such move into a
    // full restart (camera, model download, warm-up), so a detach only stops the session if the view
    // stays detached; a re-attach within the grace period keeps the running session.
    private val detachedStop = Runnable { if (!isAttachedToWindow && (engine != null || cameraController != null)) stopSession() }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        mainHandler.removeCallbacks(detachedStop)
        mainHandler.postDelayed(detachedStop, DETACH_GRACE_MS)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        mainHandler.removeCallbacks(detachedStop)
        if (sessionKey != null && engine == null && cameraController == null) startSession()
    }

    /** Called when React Native drops the view (OnViewDestroys). */
    fun cleanup() {
        mainHandler.removeCallbacks(detachedStop)
        stopSession()
        sessionKey = null
    }

    private fun buildStyle(): OverlayStyle {
        val p = palette
        return OverlayStyle(
            mode = when (overlayMode) {
                "joints" -> OverlayMode.JOINTS
                "off" -> OverlayMode.OFF
                else -> OverlayMode.OUTLINE
            },
            tone = when (tone) {
                "fix" -> Tone.FIX
                "warn" -> Tone.WARN
                "untrackable" -> Tone.UNTRACKABLE
                else -> Tone.GOOD
            },
            chain = chain,
            palette = Palette(
                good = parseHex(p.good),
                fix = parseHex(p.fix),
                warn = parseHex(p.warn),
                untrackable = parseHex(p.untrackable),
                other = parseHex(p.other),
                halo = parseHex(p.halo),
                highlight = parseHex(p.highlight),
            ),
            reduceMotion = reduceMotion,
            leadMs = leadMs,
        )
    }

    private fun startSession() {
        val owner = appContext.currentActivity as? LifecycleOwner
        if (owner == null) {
            // No activity to own the camera lifecycle: nothing native can work, so tell JS to give up.
            onPose(PoseEvent("failed", null, null, null, null, null, false, "No activity for the camera", true))
            return
        }
        val gen = ++generation
        val front = facing != "back"
        try {
            val engineConfig = EngineConfig(
                modelUrl = modelUrl,
                liteModelUrl = liteModelUrl,
                confidence = confidence,
                budgetMs = budgetMs,
                maskEnabled = maskEnabled,
            )
            val newEngine = PoseEngine(
                context.applicationContext,
                engineConfig,
                ViewPrefs(context.applicationContext),
                SessionEngineListener(gen, front),
            )
            val controller = CameraController(context, owner, previewView, SessionCameraListener(gen))
            engine = newEngine
            cameraController = controller
            newEngine.prepare()
            controller.start(front, newEngine)
        } catch (t: Throwable) {
            // E.g. a missing native library: JS switches this session to the WebView engine.
            stopSession()
            onPose(PoseEvent("failed", null, null, null, null, null, false, t.message ?: t.javaClass.simpleName, true))
        }
    }

    private fun stopSession() {
        generation++ // anything still in flight from the old session is dropped
        val oldController = cameraController
        val oldEngine = engine
        cameraController = null
        engine = null
        regionW = 0
        regionH = 0
        try {
            oldController?.stop()
        } catch (ignored: Throwable) {
        }
        try {
            oldEngine?.close()
        } catch (ignored: Throwable) {
        }
        overlay.clear()
        mainHandler.removeCallbacks(diagTick)
        diagScheduled = false
    }

    private fun syncDiagnostics() {
        if (diagnostics && engine != null) {
            if (!diagScheduled) {
                diagScheduled = true
                mainHandler.postDelayed(diagTick, DIAG_PERIOD_MS)
            }
        } else {
            mainHandler.removeCallbacks(diagTick)
            diagScheduled = false
        }
    }

    private fun emitDiag() {
        val e = engine ?: return
        if (!diagnostics) return
        val s = e.stats()
        val d = overlay.drawStats()
        onDiag(
            DiagEvent(
                fps = s.fps.toDouble(),
                inferMs = s.inferMs.toDouble(),
                ageP50 = d.ageP50.toDouble(),
                ageP95 = d.ageP95.toDouble(),
                drawMs = d.drawMs.toDouble(),
                backend = s.backend.toString(),
                variant = s.variant.toString(),
                rung = rungKind(s.rung.toString()),
                mirrorX = facing != "back",
                region = "${regionW}x$regionH",
                view = "${width}x$height",
                maskMs = s.maskMs.toDouble(),
                delegateNote = listOfNotNull(s.note.ifBlank { null }, cameraController?.note(), "overlay ${d.source} L${d.level}").joinToString(" "),
            ),
        )
    }

    // Engine callbacks arrive on engine threads. View events are safe to dispatch from any thread.
    private inner class SessionEngineListener(
        private val gen: Int,
        private val mirrorX: Boolean,
    ) : EngineListener {
        private fun current() = gen == generation

        override fun onLoading(stage: String, pct: Int) {
            if (!current()) return
            onPose(PoseEvent("loading", stage, pct, null, null, null, null, null, null))
        }

        override fun onReady(backend: String, variant: String, rung: Rung) {
            if (!current()) return
            onPose(PoseEvent("ready", null, null, backend, variant, rungKind(rung.name), null, null, null))
        }

        override fun onModel(variant: String, rung: Rung) {
            if (!current()) return
            onPose(PoseEvent("model", null, null, null, variant, rungKind(rung.name), null, null, null))
        }

        override fun onFailed(message: String, offline: Boolean, fatal: Boolean) {
            if (!current()) return
            onPose(PoseEvent("failed", null, null, null, null, null, offline, message, fatal))
        }

        override fun onResult(r: PoseFrameResult, warm: Boolean) {
            // Warm-up results are never forwarded to JS or the overlay.
            if (warm || !current()) return
            if (r.regionW != regionW || r.regionH != regionH) {
                regionW = r.regionW
                regionH = r.regionH
                val w = r.regionW
                val h = r.regionH
                post { if (current()) overlay.setFill(w, h, mirrorX) }
            }
            overlay.submit(r)
            val now = r.arrivedNs
            if (now - lastFrameEventNs < MIN_FRAME_EVENT_NS) return
            lastFrameEventNs = now
            onFrame(
                FrameEvent(
                    ts = r.tsMs.toDouble(),
                    w = r.regionW,
                    h = r.regionH,
                    ms = r.inferMs.toDouble(),
                    // Mean luma of the visible frame, sampled every 500 ms; -1 until the first sample.
                    b = if (r.brightness >= 0f) r.brightness.toDouble() else -1.0,
                    lm = r.landmarks ?: NO_LANDMARKS,
                ),
            )
        }
    }

    private inner class SessionCameraListener(private val gen: Int) : CameraListener {
        private fun current() = gen == generation

        override fun onLive() {
            if (current()) onCamera(CameraEvent("live", null))
        }

        override fun onEnded() {
            if (current()) onCamera(CameraEvent("ended", null))
        }

        override fun onError(name: String) {
            if (current()) onCamera(CameraEvent("error", name))
        }
    }

    // The GPU guard's "attempt in progress" flag must survive a native crash, hence commit().
    private class ViewPrefs(context: Context) : Prefs {
        private val prefs = context.getSharedPreferences("form_pose_camera", Context.MODE_PRIVATE)

        override fun getBool(key: String): Boolean = prefs.getBoolean(key, false)

        override fun putBool(key: String, v: Boolean) {
            prefs.edit().putBoolean(key, v).commit()
        }
    }

    private companion object {
        const val DIAG_PERIOD_MS = 1000L
        const val DETACH_GRACE_MS = 2000L
        const val MIN_FRAME_EVENT_NS = 24_000_000L
        val NO_LANDMARKS = FloatArray(0)

        /** JS rung name: mask (full or lite), capsule or joints. */
        fun rungKind(name: String): String = when (name) {
            "FULL_MASK", "LITE_MASK" -> "mask"
            "LITE_CAPSULE" -> "capsule"
            "LITE_JOINTS" -> "joints"
            else -> name.lowercase()
        }
    }
}
