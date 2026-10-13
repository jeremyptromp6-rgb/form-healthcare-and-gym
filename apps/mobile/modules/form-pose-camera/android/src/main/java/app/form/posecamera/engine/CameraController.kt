package app.form.posecamera.engine

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.util.Log
import android.util.Size
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.ViewPort
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LiveData
import androidx.lifecycle.Observer
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory

/** Camera events, always delivered on the main thread. [onError] names are the WebView error names. */
interface CameraListener {
    /** The first analysed frame arrived (also re-sent when frames resume after an error). */
    fun onLive()

    /** The camera closed while the owner is still started (unplugged, taken by the system). */
    fun onEnded()

    /** One of NotAllowedError | NotFoundError | NotReadableError | NotSupportedError. */
    fun onError(name: String)
}

/**
 * Binds a CameraX [Preview] and an RGBA [ImageAnalysis] to one [UseCaseGroup] with the
 * [PreviewView]'s [ViewPort], so the analysed region is exactly the visible region, and feeds every
 * analysis frame to [PoseEngine.analyze] on a dedicated analyzer thread.
 *
 * [start] and [stop] must be called on the main thread. The analyzer never blocks: the analysis use
 * case is KEEP_ONLY_LATEST and the engine returns quickly.
 */
class CameraController(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val previewView: PreviewView,
    private val listener: CameraListener,
) {
    private val main = Handler(Looper.getMainLooper())

    // Main thread only.
    private var generation = 0
    private var provider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private var executor: ExecutorService? = null
    private var stateData: LiveData<CameraState>? = null
    private var stateObserver: Observer<CameraState>? = null
    private var bindRunnable: Runnable? = null
    private var viewPortRetries = 0
    private var layoutWaitMs = 0L
    private var everLive = false

    @Volatile
    private var liveSent = false

    @Volatile
    private var note: String = ""

    /** "viewport:on" or "viewport:off", for the diagnostics delegate note. */
    fun note(): String = note

    /** Starts (or restarts) the camera. [front] selects the lens; frames go to [engine]. */
    fun start(front: Boolean, engine: PoseEngine) {
        stop()
        val gen = ++generation
        liveSent = false
        everLive = false
        viewPortRetries = 0
        layoutWaitMs = 0L
        val future = try {
            ProcessCameraProvider.getInstance(context)
        } catch (t: Throwable) {
            Log.w(TAG, "camera provider unavailable", t)
            listener.onError("NotReadableError")
            return
        }
        future.addListener(
            {
                if (gen != generation) return@addListener
                val p = try {
                    future.get()
                } catch (t: Throwable) {
                    Log.w(TAG, "camera provider failed", t)
                    listener.onError("NotReadableError")
                    return@addListener
                }
                provider = p
                tryBind(gen, front, engine)
            },
            ContextCompat.getMainExecutor(context),
        )
    }

    /** Unbinds everything and stops the analyzer thread. Safe to call repeatedly. */
    fun stop() {
        generation++
        bindRunnable?.let { main.removeCallbacks(it) }
        bindRunnable = null
        val data = stateData
        val obs = stateObserver
        if (data != null && obs != null) data.removeObserver(obs)
        stateData = null
        stateObserver = null
        try {
            analysis?.clearAnalyzer()
        } catch (t: Throwable) {
            Log.w(TAG, "clearAnalyzer failed", t)
        }
        analysis = null
        try {
            provider?.unbindAll()
        } catch (t: Throwable) {
            Log.w(TAG, "unbindAll failed", t)
        }
        provider = null
        // shutdown (not shutdownNow): a frame already queued still runs and closes its image.
        executor?.shutdown()
        executor = null
    }

    private fun retryLater(gen: Int, front: Boolean, engine: PoseEngine, delayMs: Long) {
        val r = Runnable { tryBind(gen, front, engine) }
        bindRunnable = r
        main.postDelayed(r, delayMs)
    }

    private fun tryBind(gen: Int, front: Boolean, engine: PoseEngine) {
        if (gen != generation) return
        bindRunnable = null
        // Wait for the first real layout: the ViewPort needs the view's size and a display.
        if (previewView.width == 0 || previewView.height == 0 || !previewView.isAttachedToWindow) {
            layoutWaitMs += RETRY_MS
            if (layoutWaitMs > MAX_LAYOUT_WAIT_MS) {
                listener.onError("NotReadableError")
                return
            }
            retryLater(gen, front, engine, RETRY_MS)
            return
        }
        val viewPort: ViewPort? = previewView.viewPort
        if (viewPort == null && viewPortRetries < MAX_VIEWPORT_RETRIES) {
            viewPortRetries++
            retryLater(gen, front, engine, RETRY_MS)
            return
        }
        note = if (viewPort != null) "viewport:on" else "viewport:off"
        try {
            bind(gen, front, engine, viewPort)
        } catch (t: Throwable) {
            Log.w(TAG, "bind failed", t)
            listener.onError(errorName(t))
        }
    }

    private fun bind(gen: Int, front: Boolean, engine: PoseEngine, viewPort: ViewPort?) {
        val p = provider ?: return
        // TextureView-backed preview: behaves with RN siblings and the modal transition.
        if (previewView.implementationMode != PreviewView.ImplementationMode.COMPATIBLE) {
            previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        if (previewView.scaleType != PreviewView.ScaleType.FILL_CENTER) {
            previewView.scaleType = PreviewView.ScaleType.FILL_CENTER
        }

        val preview = Preview.Builder()
            .setResolutionSelector(selector(Size(PREVIEW_W, PREVIEW_H)))
            .build()
        preview.surfaceProvider = previewView.surfaceProvider

        val analysisCase = ImageAnalysis.Builder()
            .setResolutionSelector(selector(Size(ANALYSIS_W, ANALYSIS_H)))
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()

        val exec = Executors.newSingleThreadExecutor(analyzerThreads())
        executor = exec
        analysisCase.setAnalyzer(exec, FrameAnalyzer(gen, engine))
        analysis = analysisCase

        val group = UseCaseGroup.Builder()
            .addUseCase(preview)
            .addUseCase(analysisCase)
            .apply { if (viewPort != null) setViewPort(viewPort) }
            .build()
        val selectorLens = CameraSelector.Builder()
            .requireLensFacing(if (front) CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK)
            .build()

        p.unbindAll()
        val camera: Camera = p.bindToLifecycle(lifecycleOwner, selectorLens, group)
        observeState(gen, camera)
    }

    private fun selector(bound: Size): ResolutionSelector =
        ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
            .setResolutionStrategy(
                ResolutionStrategy(bound, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER),
            )
            .build()

    private fun observeState(gen: Int, camera: Camera) {
        val data = camera.cameraInfo.cameraState
        val obs = Observer<CameraState> { state ->
            if (gen != generation) return@Observer
            val err = state.error
            if (err != null) {
                liveSent = false // frames after recovery report live again
                listener.onError(errorName(err.code))
            } else if (state.type == CameraState.Type.OPEN) {
                // The camera itself is open; "live" waits for the first frame.
            } else if (state.type == CameraState.Type.CLOSED && everLive &&
                lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
            ) {
                listener.onEnded()
            }
        }
        stateData = data
        stateObserver = obs
        data.observeForever(obs)
    }

    private fun errorName(code: Int): String = when (code) {
        CameraState.ERROR_DO_NOT_DISTURB_MODE_ENABLED -> "NotAllowedError"
        CameraState.ERROR_STREAM_CONFIG -> "NotSupportedError"
        else -> "NotReadableError" // in use, too many cameras, disabled, fatal, removed, other
    }

    private fun errorName(t: Throwable): String = when (t) {
        is SecurityException -> "NotAllowedError"
        is IllegalArgumentException -> "NotFoundError" // the selector resolved to no camera
        else -> "NotReadableError"
    }

    private fun analyzerThreads() = ThreadFactory { r ->
        Thread(
            {
                try {
                    Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY)
                } catch (ignored: Throwable) {
                }
                r.run()
            },
            "form-pose-analyzer",
        ).apply { isDaemon = true }
    }

    private inner class FrameAnalyzer(
        private val gen: Int,
        private val engine: PoseEngine,
    ) : ImageAnalysis.Analyzer {
        override fun analyze(image: ImageProxy) {
            var handedOver = false
            try {
                if (!liveSent && gen == generation) {
                    liveSent = true
                    main.post {
                        if (gen == generation) {
                            everLive = true
                            listener.onLive()
                        }
                    }
                }
                handedOver = true
                // The engine always closes the image, on every path.
                engine.analyze(image, image.cropRect, image.imageInfo.rotationDegrees)
            } catch (t: Throwable) {
                Log.w(TAG, "analyze failed", t)
                if (!handedOver) {
                    try {
                        image.close()
                    } catch (ignored: Throwable) {
                    }
                }
            }
        }
    }

    private companion object {
        const val TAG = "FormPoseCamera"
        const val PREVIEW_W = 1280
        const val PREVIEW_H = 960
        const val ANALYSIS_W = 640
        const val ANALYSIS_H = 480
        const val RETRY_MS = 50L
        const val MAX_VIEWPORT_RETRIES = 5
        const val MAX_LAYOUT_WAIT_MS = 10_000L
    }
}
