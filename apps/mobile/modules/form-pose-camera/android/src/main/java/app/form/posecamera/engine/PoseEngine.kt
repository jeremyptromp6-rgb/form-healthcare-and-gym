package app.form.posecamera.engine

import android.content.Context
import android.graphics.Rect
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.ImageProxy
import app.form.posecamera.core.Delegate
import app.form.posecamera.core.GpuGuard
import app.form.posecamera.core.Ladder
import app.form.posecamera.core.LadderAction
import app.form.posecamera.core.LadderConfig
import app.form.posecamera.core.MaskGrid
import app.form.posecamera.core.PoseFrameResult
import app.form.posecamera.core.Prefs
import app.form.posecamera.core.Rung
import app.form.posecamera.core.downsampleMask
import app.form.posecamera.core.maskLooksBlank
import app.form.posecamera.core.meanLumaRgba
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.ErrorListener
import com.google.mediapipe.tasks.core.OutputHandler
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import java.io.File
import java.io.RandomAccessFile
import java.nio.Buffer
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import com.google.mediapipe.tasks.core.Delegate as MpDelegate

/**
 * [confidence] is [detection, presence, tracking]. [budgetMs] is the JS model budget (32); the
 * ladder derives the per-rung budgets from it. [inferLongEdge] caps the long edge of the bitmap fed
 * to the landmarker.
 */
class EngineConfig(
    val modelUrl: String,
    val liteModelUrl: String?,
    val confidence: FloatArray,
    val budgetMs: Int,
    val maskEnabled: Boolean,
    val inferLongEdge: Int = 480,
)

/**
 * Callbacks arrive on engine threads (the worker thread for lifecycle events, the MediaPipe result
 * thread for [onResult]); implementations must be thread-safe and quick. [onResult] is called
 * synchronously for every result; `warm = true` results belong to start-up and must not be shown or
 * forwarded.
 */
interface EngineListener {
    fun onLoading(stage: String, pct: Int)
    fun onReady(backend: String, variant: String, rung: Rung)

    /** [variant] is "switching" | "full" | "lite". */
    fun onModel(variant: String, rung: Rung)
    fun onFailed(message: String, offline: Boolean, fatal: Boolean)
    fun onResult(r: PoseFrameResult, warm: Boolean)
}

/** A snapshot for diagnostics. [backend] is "GPU" | "CPU", [variant] "full" | "lite". */
class EngineStats(
    val fps: Float,
    val inferMs: Float,
    val maskMs: Float,
    val backend: String,
    val variant: String,
    val rung: Rung,
    /** Last luma sample 0..255, -1 when none yet. */
    val brightness: Float,
    /** Free text for the diagnostics chip: timestamp clock, GPU fallbacks, mask problems. */
    val note: String,
)

/** Thrown when no landmarker could be created even on the CPU (nothing native can work). */
private class EngineCreateException(message: String, cause: Throwable?) : RuntimeException(message, cause)

private class EngineClosedException : RuntimeException("engine closed")

/** Per-frame bookkeeping that joins a result back to the frame it came from. */
private class FrameMeta(
    val tsMs: Long,
    val captureNs: Long,
    val sendNs: Long,
    val regionW: Int,
    val regionH: Int,
    val destW: Int,
    val destH: Int,
)

/** One landmarker creation, run on its own thread so that a hung GPU delegate can be abandoned. */
private class CreateJob(private val build: () -> PoseLandmarker) : Runnable {
    private val latch = CountDownLatch(1)

    // 0 running, 1 finished, 2 abandoned (the caller timed out)
    private val state = AtomicInteger(0)

    @Volatile
    private var result: PoseLandmarker? = null

    @Volatile
    private var error: Throwable? = null

    override fun run() {
        var lm: PoseLandmarker? = null
        var err: Throwable? = null
        try {
            lm = build()
        } catch (t: Throwable) {
            err = t
        }
        if (state.compareAndSet(0, 1)) {
            result = lm
            error = err
        } else {
            // Nobody is waiting any more: do not leak the late landmarker.
            try {
                lm?.close()
            } catch (ignored: Throwable) {
            }
        }
        latch.countDown()
    }

    fun await(timeoutMs: Long): PoseLandmarker {
        try {
            if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                if (state.compareAndSet(0, 2)) throw TimeoutException("landmarker creation timed out")
                latch.await(1, TimeUnit.SECONDS) // it finished in the same instant
            }
        } catch (e: InterruptedException) {
            // close() interrupts the worker: abandon the job so that run() closes a late landmarker.
            if (state.compareAndSet(0, 2)) throw e
            try {
                latch.await(1, TimeUnit.SECONDS) // it finished in the same instant
            } catch (ignored: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
        error?.let { throw it }
        return result ?: throw IllegalStateException("landmarker creation gave nothing")
    }
}

/**
 * The pose pipeline: model download, MediaPipe PoseLandmarker (LIVE_STREAM, optionally with
 * segmentation masks), start-up tuning, in-session quality governor.
 *
 * Threads:
 * - analyzer thread (the caller of [analyze]): crops/rotates/scales the frame and hands it to
 *   MediaPipe. Never blocks on model work; a frame arriving while no landmarker is installed is
 *   simply dropped.
 * - worker thread ("form-pose-engine"): download, create, warm-up decisions, the 1 Hz governor,
 *   closing old landmarkers.
 * - MediaPipe result thread: turns results into [PoseFrameResult] and calls the listener.
 * - creation threads: one per landmarker creation, so a hung creation can be abandoned.
 */
class PoseEngine(
    context: Context,
    private val config: EngineConfig,
    prefs: Prefs,
    private val listener: EngineListener,
) {
    private enum class Phase { IDLE, LOADING, WARMING, READY, FAILED }

    private val appContext: Context = context.applicationContext
    private val store = ModelStore(appContext)
    private val guard = GpuGuard(prefs, gpuBuildKey(appContext))
    private val converter = FrameConverter()
    private val worker = ScheduledThreadPoolExecutor(1, namedThreads("form-pose-engine", Process.THREAD_PRIORITY_DEFAULT))
        .apply { removeOnCancelPolicy = true }
    private val createPool = Executors.newCachedThreadPool(namedThreads("form-pose-create", Process.THREAD_PRIORITY_DEFAULT))

    private val closed = AtomicBoolean(false)
    private val started = AtomicBoolean(false)

    @Volatile
    private var phase = Phase.IDLE

    // The installed landmarker. Swaps and detectAsync calls are serialised by callLock, so a
    // landmarker is never closed while the analyzer is inside a call on it.
    private val callLock = Any()

    @Volatile
    private var landmarker: PoseLandmarker? = null

    @Volatile
    private var gen = 0
    private var genCounter = 0

    @Volatile
    private var curRung = Rung.FULL_MASK

    @Volatile
    private var curDelegate = Delegate.CPU

    @Volatile
    private var maskActive = false

    @Volatile
    private var maskDisabled = false

    // Models.
    private var fullFile: File? = null
    private var liteFile: File? = null
    private var liteFailed = false
    private val mapped = HashMap<String, ByteBuffer>() // kept alive: MediaPipe may read it for the graph's life

    private var ladder: Ladder? = null
    private var tick: ScheduledFuture<*>? = null

    @Volatile
    private var gpuAttemptOpen = false

    // Analyzer-thread state.
    private var lastTsMs = 0L
    private var clockIsSensor: Boolean? = null // decided on the first frame, then fixed
    private var lastLumaMs = Long.MIN_VALUE

    @Volatile
    private var brightness = -1f

    @Volatile
    private var lastRegionW = 0

    @Volatile
    private var lastRegionH = 0
    private var submitFailures = 0

    // Frame ring (analyzer writes, result thread reads).
    private val ringLock = Any()
    private val ring = arrayOfNulls<FrameMeta>(RING_SIZE)
    private var ringNext = 0

    // Result-thread state.
    @Volatile
    private var blankStreak = 0

    @Volatile
    private var errorStreak = 0

    @Volatile
    private var lastResultGen = -1
    private val resultCount = AtomicInteger(0)

    // Rolling stats.
    private val statLock = Any()
    private val inferRing = FloatArray(STAT_RING)
    private var inferN = 0
    private var inferIdx = 0
    private val maskRing = FloatArray(STAT_RING)
    private var maskN = 0
    private var maskIdx = 0

    @Volatile
    private var fps = 0f
    private var lastTickMs = 0L
    private var lastTickCount = 0

    @Volatile
    private var note = ""

    // Warm-up.
    private val warmLock = ReentrantLock()
    private val warmCond = warmLock.newCondition()
    // Only results with a person count: an empty scene skips the mask work and would look cheap. If
    // nobody steps into view, the any-result sample (warmAnyTimes) is used after EMPTY_SCENE_MS.
    private val warmTimes = FloatArray(WARM_TOTAL)
    private val warmAnyTimes = FloatArray(WARM_TOTAL)
    private var warmCount = 0
    private var warmAnyCount = 0
    private var warmGen = -1
    private var warmActive = false

    /** Async: download, create, warm up, then [EngineListener.onReady] (or onFailed). Call once. */
    fun prepare() {
        if (closed.get() || !started.compareAndSet(false, true)) return
        try {
            worker.execute { runPrepare() }
        } catch (ignored: RejectedExecutionException) {
        }
    }

    /**
     * Analyzer thread. Always closes [image], including when it throws internally. [crop] is the
     * visible region in buffer coordinates (before rotation).
     */
    fun analyze(image: ImageProxy, crop: Rect, rotationDegrees: Int) {
        try {
            if (closed.get() || landmarker == null) return
            val entryNs = SystemClock.elapsedRealtimeNanos()

            // Brightness every 500 ms, from the visible region of the raw RGBA frame.
            val nowMs = entryNs / NS_PER_MS
            if (lastLumaMs == Long.MIN_VALUE || nowMs - lastLumaMs >= LUMA_EVERY_MS) {
                lastLumaMs = nowMs
                sampleLuma(image, crop)?.let { brightness = it }
            }

            val bmp = converter.convert(image, crop, rotationDegrees, config.inferLongEdge) ?: return
            lastRegionW = converter.regionW
            lastRegionH = converter.regionH

            // The sensor timestamp is on the elapsedRealtime clock on most devices; where it is not
            // (some report a monotonic clock) it is far from "now", and entry time is used instead.
            val sensorNs = image.imageInfo.timestamp
            val useSensor: Boolean = clockIsSensor ?: (abs(sensorNs - entryNs) <= CLOCK_TOLERANCE_NS).also {
                clockIsSensor = it
                setNote(if (it) "clock=sensor" else "clock=entry")
            }
            val captureNs = if (useSensor) sensorNs else entryNs
            var ts = captureNs / NS_PER_MS
            if (ts <= lastTsMs) ts = lastTsMs + 1 // strictly increasing, whatever the source does
            lastTsMs = ts

            val sendNs = SystemClock.elapsedRealtimeNanos()
            synchronized(ringLock) {
                ring[ringNext] = FrameMeta(ts, captureNs, sendNs, converter.regionW, converter.regionH, converter.destW, converter.destH)
                ringNext = (ringNext + 1) % RING_SIZE
            }
            // Not closed on purpose: closing a Bitmap-backed MPImage would recycle our reused bitmap.
            val mpImage = BitmapImageBuilder(bmp).build()
            synchronized(callLock) {
                landmarker?.detectAsync(mpImage, ts)
            }
            submitFailures = 0
        } catch (t: Throwable) {
            onSubmitFailure(t)
        } finally {
            try {
                image.close()
            } catch (ignored: Throwable) {
            }
        }
    }

    /** A cheap snapshot (rolling medians over the last ~30 results). */
    fun stats(): EngineStats {
        val rung = curRung
        return EngineStats(
            fps = fps,
            inferMs = median(inferRing, inferN, statLock).let { if (it.isNaN()) 0f else it },
            maskMs = median(maskRing, maskN, statLock).let { if (it.isNaN()) 0f else it },
            backend = if (curDelegate == Delegate.GPU) "GPU" else "CPU",
            variant = variantFor(rung),
            rung = rung,
            brightness = brightness,
            note = note,
        )
    }

    /** Non-blocking: the landmarker is closed on a separate thread. Idempotent. */
    fun close() {
        if (!closed.compareAndSet(false, true)) return
        phase = Phase.FAILED
        // Closing is not a crash. Clear the persisted GPU attempt flag now, not after the slow
        // teardown below: a quick reopen would otherwise read a stale flag as "the GPU crashed".
        endGpuAttempt()
        try {
            worker.shutdownNow()
        } catch (ignored: Throwable) {
        }
        createPool.shutdown()
        val lm: PoseLandmarker?
        synchronized(callLock) {
            lm = landmarker
            landmarker = null
        }
        warmLock.withLock { warmCond.signalAll() }
        converter.release()
        val closer = Thread(
            {
                try {
                    lm?.close()
                } catch (t: Throwable) {
                    Log.w(TAG, "landmarker close failed", t)
                }
                // Closing is not a crash: do not leave the GPU attempt flag set for the next start.
                endGpuAttempt()
            },
            "form-pose-close",
        )
        closer.isDaemon = true
        closer.start()
    }

    // ---------------------------------------------------------------- start-up (worker thread)

    private fun runPrepare() {
        try {
            if (config.modelUrl.isBlank()) throw EngineCreateException("No model configured", null)
            phase = Phase.LOADING
            safe { listener.onLoading("model", 0) }
            val full = store.ensure(config.modelUrl, EXPECTED_FULL_BYTES, { closed.get() }) { pct ->
                safe { listener.onLoading("model", pct) }
            }
            fullFile = full
            if (closed.get()) return
            safe { listener.onLoading("starting", 0) }
            startup()
        } catch (ignored: EngineClosedException) {
            // closed while working: nothing to report
        } catch (e: ModelException) {
            fail(e.message ?: "Model download failed", e.offline, false)
        } catch (e: EngineCreateException) {
            fail(e.message ?: "Pose engine failed to start", false, true)
        } catch (t: Throwable) {
            Log.w(TAG, "prepare failed", t)
            fail(t.message ?: t.javaClass.simpleName, false, true)
        }
    }

    private fun startup() {
        val ladder = Ladder(LadderConfig(config.budgetMs), guard.gpuAllowed())
        this.ladder = ladder
        var rung = if (maskAllowed()) ladder.rung else Rung.LITE_CAPSULE
        phase = Phase.WARMING
        var used = installInstance(rung, ladder.delegate, closeOldFirst = true, warm = true)
        ladder.rung = rung
        ladder.delegate = used
        // Model creation can take seconds, so the start-up clock only starts once the first landmarker
        // is installed, and every recreate gets its own measurement window (the total stays capped).
        val startMs = SystemClock.elapsedRealtime()
        var windowMs = startMs

        loop@ while (true) {
            if (closed.get()) throw EngineClosedException()
            awaitWarm(min(windowMs + STARTUP_CAP_MS, startMs + STARTUP_TOTAL_CAP_MS), windowMs + EMPTY_SCENE_MS, rung.hasMask)
            if (closed.get()) throw EngineClosedException()
            if (used == Delegate.GPU) endGpuAttempt() // warm-up survived (or the cap passed): not a crash

            // The mask turned out unusable (bad buffer): go straight to the capsule rung.
            if (maskDisabled && rung.hasMask) {
                rung = Rung.LITE_CAPSULE
                ladder.rung = rung
                emitModel("switching", rung)
                used = installInstance(rung, used, closeOldFirst = true, warm = true)
                ladder.delegate = used
                windowMs = SystemClock.elapsedRealtime()
                continue@loop
            }

            val blank = rung.hasMask && blankStreak >= BLANK_FRAMES
            val medianMs = warmMedian()
            val nowMs = SystemClock.elapsedRealtime()
            // The ladder's cap is per measurement window; the total cap ends start-up whatever happens.
            val elapsed = if (nowMs - startMs >= STARTUP_TOTAL_CAP_MS) STARTUP_CAP_MS else nowMs - windowMs
            val action = ladder.startupAction(medianMs, blank, rung, used, elapsed)
            when (action) {
                is LadderAction.Accept -> break@loop
                is LadderAction.Stay -> sleepQuietly(STAY_SLEEP_MS)
                is LadderAction.UseCpu -> {
                    if (blank) guard.markBad() // the GPU mask is unreliable on this phone
                    emitModel("switching", rung)
                    used = installInstance(rung, Delegate.CPU, closeOldFirst = true, warm = true)
                    ladder.delegate = used
                    windowMs = SystemClock.elapsedRealtime()
                }
                is LadderAction.Switch -> {
                    rung = action.rung
                    emitModel("switching", rung)
                    used = installInstance(rung, action.delegate, closeOldFirst = true, warm = true)
                    ladder.rung = rung
                    ladder.delegate = used
                    windowMs = SystemClock.elapsedRealtime()
                }
            }
        }

        if (closed.get()) throw EngineClosedException()
        phase = Phase.READY
        lastTickMs = SystemClock.elapsedRealtime()
        lastTickCount = resultCount.get()
        val backend = if (used == Delegate.GPU) "GPU" else "CPU"
        safe { listener.onReady(backend, variantFor(rung), rung) }
        try {
            tick = worker.scheduleWithFixedDelay({ governorTick() }, TICK_MS, TICK_MS, TimeUnit.MILLISECONDS)
        } catch (ignored: RejectedExecutionException) {
        }
    }

    // ------------------------------------------------------------ in-session governor (worker)

    private fun governorTick() {
        if (closed.get() || phase != Phase.READY) return
        try {
            val ladder = this.ladder ?: return
            val now = SystemClock.elapsedRealtime()
            val count = resultCount.get()
            val dt = max(1L, now - lastTickMs)
            fps = (count - lastTickCount) * 1000f / dt
            lastTickMs = now
            lastTickCount = count

            val medianMs = recentMedian()
            val action = ladder.onSecond(medianMs, fps, now)
            if (action is LadderAction.Switch) switchInSession(action.rung, action.delegate)
        } catch (t: Throwable) {
            if (!closed.get()) Log.w(TAG, "governor tick failed", t)
        }
    }

    /** Recreates the landmarker at [target] while the old one keeps serving frames, then swaps. */
    private fun switchInSession(target: Rung, delegate: Delegate) {
        val ladder = this.ladder ?: return
        val previousRung = curRung
        val previousDelegate = curDelegate
        if (target.hasMask && !maskAllowed()) {
            // The mask is switched off (JS kill switch or unusable buffer): stay where we are.
            ladder.rung = previousRung
            ladder.delegate = previousDelegate
            return
        }
        emitModel("switching", previousRung)
        try {
            val used = installInstance(target, delegate, closeOldFirst = false, warm = false)
            ladder.rung = target
            ladder.delegate = used
            val newGen = gen
            val deadline = SystemClock.elapsedRealtime() + FIRST_RESULT_WAIT_MS
            while (!closed.get() && lastResultGen != newGen && SystemClock.elapsedRealtime() < deadline) {
                sleepQuietly(20)
            }
            if (used == Delegate.GPU) endGpuAttempt()
            emitModel(variantFor(target), target)
        } catch (ignored: EngineClosedException) {
            // closed meanwhile
        } catch (t: Throwable) {
            Log.w(TAG, "in-session switch to $target failed; keeping $previousRung", t)
            ladder.rung = previousRung
            ladder.delegate = previousDelegate
            emitModel(variantFor(previousRung), previousRung)
        }
    }

    private fun forceCapsuleRung() {
        if (closed.get() || phase != Phase.READY || !curRung.hasMask) return
        switchInSession(Rung.LITE_CAPSULE, curDelegate)
    }

    // ------------------------------------------------------------------ landmarker management

    private fun maskAllowed(): Boolean = config.maskEnabled && !maskDisabled

    private fun wantsMask(rung: Rung): Boolean = rung.hasMask && maskAllowed()

    private fun variantFor(rung: Rung): String =
        if (rung != Rung.FULL_MASK && liteFile != null) "lite" else "full"

    private fun emitModel(variant: String, rung: Rung) {
        safe { listener.onModel(variant, rung) }
    }

    /** The model file for [rung]; the lite model is fetched quietly the first time it is needed. */
    private fun fileFor(rung: Rung): File {
        val full = fullFile ?: throw EngineCreateException("Model missing", null)
        if (rung == Rung.FULL_MASK) return full
        liteFile?.let { return it }
        val url = config.liteModelUrl
        if (url.isNullOrBlank() || liteFailed) return full
        // While start-up waits for this download, JS must see progress or it takes the wait for a stall.
        var lastReportMs = 0L
        return try {
            store.ensure(url, EXPECTED_LITE_BYTES, { closed.get() }) { pct ->
                val nowMs = SystemClock.elapsedRealtime()
                if (phase != Phase.READY && pct < 100 && nowMs - lastReportMs >= LITE_PROGRESS_EVERY_MS) {
                    lastReportMs = nowMs
                    safe { listener.onLoading("starting", pct) }
                }
            }.also { liteFile = it }
        } catch (t: Throwable) {
            if (closed.get()) throw EngineClosedException()
            Log.w(TAG, "lite model unavailable, using the full model", t)
            liteFailed = true
            setNote("lite model unavailable")
            full
        }
    }

    private fun mappedModel(file: File): ByteBuffer {
        mapped[file.absolutePath]?.let { return it }
        val buf = RandomAccessFile(file, "r").use { raf ->
            raf.channel.map(FileChannel.MapMode.READ_ONLY, 0, raf.length())
        }
        mapped[file.absolutePath] = buf
        return buf
    }

    /**
     * Creates a landmarker for [rung]/[delegate] and swaps it in. Returns the delegate actually
     * used (GPU failures fall back to CPU). On any failure the previously installed landmarker is
     * left as it was (unless [closeOldFirst], which frees it before creating).
     */
    private fun installInstance(rung: Rung, delegate: Delegate, closeOldFirst: Boolean, warm: Boolean): Delegate {
        if (closed.get()) throw EngineClosedException()
        val file = fileFor(rung)
        val model = mappedModel(file)
        val mask = wantsMask(rung)
        val newGen = ++genCounter

        if (closeOldFirst) {
            val old: PoseLandmarker?
            synchronized(callLock) {
                old = landmarker
                landmarker = null
            }
            closeQuietly(old)
        }
        if (warm) {
            warmLock.withLock {
                warmGen = newGen
                warmCount = 0
                warmAnyCount = 0
                warmActive = true
            }
        }

        var used = delegate
        var created: PoseLandmarker? = null
        if (delegate == Delegate.GPU && guard.gpuAllowed()) {
            try {
                created = createLandmarker(model, true, mask, newGen)
            } catch (t: Throwable) {
                Log.w(TAG, "GPU landmarker failed, falling back to CPU", t)
                setNote("gpu failed: " + (t.message ?: t.javaClass.simpleName))
            }
        }
        if (created == null) {
            used = Delegate.CPU
            try {
                created = createLandmarker(model, false, mask, newGen)
            } catch (t: Throwable) {
                if (closed.get()) throw EngineClosedException()
                throw EngineCreateException(t.message ?: "Landmarker creation failed", t)
            }
        }

        val old: PoseLandmarker?
        var discard: PoseLandmarker? = null
        synchronized(callLock) {
            if (closed.get()) {
                discard = created
                old = null
            } else {
                old = landmarker
                landmarker = created
                gen = newGen
                curRung = rung
                curDelegate = used
                maskActive = mask
            }
        }
        if (discard != null) {
            closeQuietly(discard)
            throw EngineClosedException()
        }
        closeQuietly(old)
        blankStreak = 0
        synchronized(statLock) {
            inferN = 0
            inferIdx = 0
            maskN = 0
            maskIdx = 0
        }
        if (!warm) warmLock.withLock { warmActive = false }
        return used
    }

    private fun createLandmarker(model: ByteBuffer, gpu: Boolean, mask: Boolean, myGen: Int): PoseLandmarker {
        if (gpu) beginGpuAttempt()
        val job = CreateJob { buildLandmarker(model, gpu, mask, myGen) }
        try {
            createPool.execute(job)
            return job.await(if (gpu) GPU_CREATE_TIMEOUT_MS else CPU_CREATE_TIMEOUT_MS)
        } catch (t: Throwable) {
            // A failed or hung GPU creation: CPU only for this build from now on.
            if (gpu && !closed.get()) {
                guard.markBad()
                gpuAttemptOpen = false
            }
            throw t
        }
    }

    private fun buildLandmarker(model: ByteBuffer, gpu: Boolean, mask: Boolean, myGen: Int): PoseLandmarker {
        val base = BaseOptions.builder()
            .setModelAssetBuffer(model)
            .setDelegate(if (gpu) MpDelegate.GPU else MpDelegate.CPU)
            .build()
        val c = config.confidence
        val resultListener = OutputHandler.ResultListener<PoseLandmarkerResult, MPImage> { result, input ->
            handleResult(myGen, result, input)
        }
        val errorListener = ErrorListener { e -> handleError(myGen, e) }
        val options = PoseLandmarker.PoseLandmarkerOptions.builder()
            .setBaseOptions(base)
            .setRunningMode(RunningMode.LIVE_STREAM)
            .setNumPoses(1)
            .setMinPoseDetectionConfidence(if (c.size > 0) c[0] else 0.5f)
            .setMinPosePresenceConfidence(if (c.size > 1) c[1] else 0.5f)
            .setMinTrackingConfidence(if (c.size > 2) c[2] else 0.5f)
            .setOutputSegmentationMasks(mask)
            .setResultListener(resultListener)
            .setErrorListener(errorListener)
            .build()
        return PoseLandmarker.createFromOptions(appContext, options)
    }

    private fun beginGpuAttempt() {
        gpuAttemptOpen = true
        guard.beginAttempt()
    }

    private fun endGpuAttempt() {
        if (gpuAttemptOpen) {
            gpuAttemptOpen = false
            guard.endAttemptOk()
        }
    }

    private fun closeQuietly(lm: PoseLandmarker?) {
        if (lm == null) return
        try {
            lm.close()
        } catch (t: Throwable) {
            Log.w(TAG, "landmarker close failed", t)
        }
    }

    // ------------------------------------------------------------------- results (MediaPipe thread)

    private fun handleResult(myGen: Int, result: PoseLandmarkerResult, input: MPImage) {
        val arrivedNs = SystemClock.elapsedRealtimeNanos()
        try {
            if (closed.get() || myGen != gen) return // stale: a swapped-out landmarker's late result
            val ts = result.timestampMs()
            val meta = findMeta(ts)
            val captureNs = meta?.captureNs ?: 0L
            val inferMs = if (meta != null) (arrivedNs - meta.sendNs) / 1_000_000f else 0f

            var lm: FloatArray? = null
            val poses = result.landmarks()
            if (poses.isNotEmpty()) {
                val pose = poses[0]
                if (pose.size >= LANDMARK_COUNT) {
                    val out = FloatArray(LANDMARK_COUNT * 3)
                    for (i in 0 until LANDMARK_COUNT) {
                        val p = pose[i]
                        out[i * 3] = p.x()
                        out[i * 3 + 1] = p.y()
                        out[i * 3 + 2] = p.visibility().orElse(0f)
                    }
                    lm = out
                }
            }

            var grid: MaskGrid? = null
            var maskMs = 0f
            if (maskActive && lm != null) {
                val t0 = System.nanoTime()
                grid = extractMask(result, meta)
                maskMs = (System.nanoTime() - t0) / 1_000_000f
                trackBlank(lm, grid)
            }

            if (meta != null) recordStats(inferMs, maskMs, maskActive && lm != null)
            val r = PoseFrameResult(
                tsMs = ts,
                captureNs = captureNs,
                arrivedNs = arrivedNs,
                regionW = meta?.regionW ?: lastRegionW,
                regionH = meta?.regionH ?: lastRegionH,
                landmarks = lm,
                mask = grid,
                inferMs = inferMs,
                brightness = brightness,
            )
            errorStreak = 0
            lastResultGen = myGen
            resultCount.incrementAndGet()
            val warm = phase != Phase.READY
            if (warm) recordWarm(myGen, inferMs, lm != null)
            safe { listener.onResult(r, warm) }
        } catch (t: Throwable) {
            Log.w(TAG, "result handling failed", t)
        } finally {
            // The result's own images (the echoed input bitmap and any masks). Not our input bitmap.
            try {
                input.close()
            } catch (ignored: Throwable) {
            }
            try {
                val masks = result.segmentationMasks()
                if (masks.isPresent) {
                    for (m in masks.get()) {
                        try {
                            m.close()
                        } catch (ignored: Throwable) {
                        }
                    }
                }
            } catch (ignored: Throwable) {
            }
        }
    }

    /** The raw (not smoothed: the overlay does that) mask grid, or null; disables masks if the buffer is not as expected. */
    private fun extractMask(result: PoseLandmarkerResult, meta: FrameMeta?): MaskGrid? {
        try {
            val opt = result.segmentationMasks()
            if (!opt.isPresent) return null
            val list = opt.get()
            if (list.isEmpty()) return null
            val m = list[0]
            val mw = m.width
            val mh = m.height
            val bb = ByteBufferExtractor.extract(m)
            val expected = mw.toLong() * mh * 4L
            if (mw <= 0 || mh <= 0 || bb.remaining().toLong() != expected) {
                disableMask("mask buffer ${bb.remaining()} bytes, expected $expected")
                return null
            }
            if (meta != null && meta.destW > 0 && meta.destH > 0) {
                // The mask must cover the same region as the input (same aspect), or the outline would drift.
                val lhs = mw.toLong() * meta.destH
                val rhs = mh.toLong() * meta.destW
                if (abs(lhs - rhs) > rhs / 20) {
                    disableMask("mask ${mw}x$mh does not match input ${meta.destW}x${meta.destH}")
                    return null
                }
            }
            return downsampleMask(bb.asFloatBuffer(), mw, mh, MASK_GRID_EDGE, null)
        } catch (t: Throwable) {
            disableMask("mask extract failed: " + (t.message ?: t.javaClass.simpleName))
            return null
        }
    }

    private fun trackBlank(lm: FloatArray, grid: MaskGrid?) {
        val vis = (lm[11 * 3 + 2] + lm[12 * 3 + 2] + lm[23 * 3 + 2] + lm[24 * 3 + 2]) / 4f
        val personVisible = vis > BLANK_VISIBILITY
        if (!personVisible) return
        val blank = grid == null || maskLooksBlank(grid, true)
        blankStreak = if (blank) blankStreak + 1 else 0
        if (blankStreak >= BLANK_SESSION_FRAMES && phase == Phase.READY) {
            disableMask("mask stayed blank")
        }
    }

    private fun disableMask(reason: String) {
        if (maskDisabled) return
        maskDisabled = true
        setNote("mask off: $reason")
        Log.w(TAG, "segmentation disabled: $reason")
        if (phase == Phase.READY) {
            try {
                worker.execute { forceCapsuleRung() }
            } catch (ignored: RejectedExecutionException) {
            }
        }
    }

    private fun handleError(myGen: Int, e: RuntimeException) {
        if (closed.get() || myGen != gen) return
        Log.w(TAG, "MediaPipe error", e)
        if (++errorStreak == MAX_ERROR_STREAK) {
            fail("Pose engine errors: " + (e.message ?: e.javaClass.simpleName), false, true)
        }
    }

    private fun onSubmitFailure(t: Throwable) {
        if (closed.get()) return
        Log.w(TAG, "frame submit failed", t)
        if (++submitFailures == MAX_ERROR_STREAK) {
            fail("Pose engine could not process frames: " + (t.message ?: t.javaClass.simpleName), false, true)
        }
    }

    private fun findMeta(ts: Long): FrameMeta? = synchronized(ringLock) {
        for (m in ring) {
            if (m != null && m.tsMs == ts) return@synchronized m
        }
        null
    }

    // ------------------------------------------------------------------------------- statistics

    private fun recordStats(inferMs: Float, maskMs: Float, hasMask: Boolean) {
        synchronized(statLock) {
            inferRing[inferIdx] = inferMs
            inferIdx = (inferIdx + 1) % STAT_RING
            if (inferN < STAT_RING) inferN++
            if (hasMask) {
                maskRing[maskIdx] = maskMs
                maskIdx = (maskIdx + 1) % STAT_RING
                if (maskN < STAT_RING) maskN++
            }
        }
    }

    private fun recentMedian(): Float {
        val n = synchronized(statLock) { inferN }
        return if (n < MIN_GOVERNOR_SAMPLES) Float.NaN else median(inferRing, n, statLock)
    }

    private fun median(ring: FloatArray, n: Int, lock: Any): Float {
        if (n <= 0) return Float.NaN
        val copy: FloatArray
        synchronized(lock) {
            copy = ring.copyOf(min(n, ring.size))
        }
        copy.sort()
        return copy[copy.size / 2]
    }

    private fun recordWarm(myGen: Int, inferMs: Float, hasPerson: Boolean) {
        warmLock.withLock {
            if (warmActive && myGen == warmGen) {
                if (warmAnyCount < WARM_TOTAL) warmAnyTimes[warmAnyCount++] = inferMs
                if (hasPerson && warmCount < WARM_TOTAL) warmTimes[warmCount++] = inferMs
                warmCond.signalAll()
            }
        }
    }

    /**
     * Waits for the warm-up sample (3 discarded + 12 kept, results with a person), a blank mask, a
     * dead mask, or [deadlineMs]. From [emptyFromMs] on, a full sample of results without a person
     * also ends the wait, so an empty scene does not hold start-up for the whole cap.
     */
    private fun awaitWarm(deadlineMs: Long, emptyFromMs: Long, rungHasMask: Boolean) {
        warmLock.withLock {
            while (!closed.get()) {
                if (warmCount >= WARM_TOTAL) break
                if (warmAnyCount >= WARM_TOTAL && SystemClock.elapsedRealtime() >= emptyFromMs) break
                if (rungHasMask && (blankStreak >= BLANK_FRAMES || maskDisabled)) break
                val left = deadlineMs - SystemClock.elapsedRealtime()
                if (left <= 0) break
                warmCond.await(min(left, 100L), TimeUnit.MILLISECONDS)
            }
        }
    }

    private fun warmMedian(): Float = warmLock.withLock {
        val sample = when {
            warmCount >= WARM_TOTAL -> warmTimes
            warmAnyCount >= WARM_TOTAL -> warmAnyTimes
            else -> return@withLock Float.NaN
        }
        val kept = sample.copyOfRange(WARM_DISCARD, WARM_TOTAL)
        kept.sort()
        kept[kept.size / 2]
    }

    // ---------------------------------------------------------------------------------- helpers

    private fun sampleLuma(image: ImageProxy, crop: Rect): Float? {
        val w = image.width
        val h = image.height
        val planes = image.planes
        if (planes.isEmpty() || w <= 0 || h <= 0) return null
        val stride = planes[0].rowStride
        var l = crop.left.coerceIn(0, w)
        var t = crop.top.coerceIn(0, h)
        var r = crop.right.coerceIn(0, w)
        var b = crop.bottom.coerceIn(0, h)
        if (r - l < 2 || b - t < 2) {
            l = 0
            t = 0
            r = w
            b = h
        }
        val dup = planes[0].buffer.duplicate()
        val dupB: Buffer = dup
        val offset = t * stride + l * 4
        if (offset < 0 || offset >= dupB.capacity()) return null
        dupB.clear()
        dupB.position(offset)
        return meanLumaRgba(dup, r - l, b - t, stride)
    }

    private fun fail(message: String, offline: Boolean, fatal: Boolean) {
        if (closed.get()) return
        phase = Phase.FAILED
        safe { listener.onFailed(message, offline, fatal) }
        close()
    }

    private fun setNote(text: String) {
        val cur = note
        note = if (cur.isEmpty()) text else if (cur.contains(text)) cur else "$cur; $text"
    }

    private inline fun safe(block: () -> Unit) {
        try {
            block()
        } catch (t: Throwable) {
            Log.w(TAG, "listener threw", t)
        }
    }

    private fun sleepQuietly(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (ignored: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    private fun namedThreads(name: String, priority: Int) = ThreadFactory { r ->
        Thread(
            {
                try {
                    Process.setThreadPriority(priority)
                } catch (ignored: Throwable) {
                }
                r.run()
            },
            name,
        ).apply { isDaemon = true }
    }

    private companion object {
        const val TAG = "FormPoseEngine"
        const val NS_PER_MS = 1_000_000L
        const val CLOCK_TOLERANCE_NS = 1_000_000_000L
        const val LUMA_EVERY_MS = 500L
        const val LITE_PROGRESS_EVERY_MS = 400L
        const val RING_SIZE = 8
        const val STAT_RING = 30
        const val MIN_GOVERNOR_SAMPLES = 8
        const val LANDMARK_COUNT = 33
        const val MASK_GRID_EDGE = 96

        const val WARM_DISCARD = 3
        const val WARM_TOTAL = 15
        const val BLANK_FRAMES = 10
        const val BLANK_SESSION_FRAMES = 90
        const val BLANK_VISIBILITY = 0.8f
        const val STARTUP_CAP_MS = 8_000L
        const val STARTUP_TOTAL_CAP_MS = 20_000L
        const val EMPTY_SCENE_MS = 3_000L
        const val STAY_SLEEP_MS = 50L
        const val TICK_MS = 1_000L
        const val FIRST_RESULT_WAIT_MS = 3_000L
        const val GPU_CREATE_TIMEOUT_MS = 10_000L
        const val CPU_CREATE_TIMEOUT_MS = 30_000L
        const val MAX_ERROR_STREAK = 30
        const val EXPECTED_FULL_BYTES = 9_000_000L
        const val EXPECTED_LITE_BYTES = 5_500_000L
    }
}
