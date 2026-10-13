package app.form.posecamera.core

import kotlin.math.roundToInt

enum class Delegate { GPU, CPU }

/**
 * What the engine should do next.
 * - [Stay]: keep measuring (no decision yet).
 * - [Switch]: recreate the landmarker at the given rung and delegate.
 * - [UseCpu]: recreate the CURRENT rung on the CPU delegate (blank mask, or the one CPU trial).
 * - [Accept]: start-up is finished; report ready with the current rung and delegate.
 */
sealed interface LadderAction {
    object Stay : LadderAction
    class Switch(val rung: Rung, val delegate: Delegate) : LadderAction
    class UseCpu : LadderAction
    class Accept : LadderAction
}

/** [budgetMs] is the JS model budget (32); the per-rung budgets are derived from it. */
class LadderConfig(val budgetMs: Int) {
    /** Rungs A and B (mask): round(budget x 1.4). */
    val maskBudgetMs: Int = (budgetMs * 1.4).roundToInt()

    /** Rung C (capsule): round(budget x 1.9). */
    val plainBudgetMs: Int = (budgetMs * 1.9).roundToInt()

    /** Median-inference budget of [rung]; rung D has none (infinite). */
    fun budgetFor(rung: Rung): Float = when (rung) {
        Rung.FULL_MASK, Rung.LITE_MASK -> maskBudgetMs.toFloat()
        Rung.LITE_CAPSULE -> plainBudgetMs.toFloat()
        Rung.LITE_JOINTS -> Float.POSITIVE_INFINITY
    }
}

/**
 * Pure decision logic for the quality ladder (the engine drives it; this class touches nothing).
 *
 * Start-up: after each warm-up sample at (rung, delegate) call [startupAction]. In-session: call
 * [onSecond] once per second. The ladder assumes every Switch/UseCpu it returns is carried out, so
 * [rung] and [delegate] always describe the state it expects the engine to be in. The caller may
 * overwrite them (they are plain properties) if a recreate failed.
 */
class Ladder(private val cfg: LadderConfig, gpuAllowed: Boolean) {
    var rung: Rung = Rung.FULL_MASK
    var delegate: Delegate = if (gpuAllowed) Delegate.GPU else Delegate.CPU

    // Start-up CPU trial: the GPU median that was over budget at the rung being retried on CPU.
    private var trialPending = false
    private var trialGpuMedian = 0f

    // In-session governor state.
    private var overSecs = 0
    private var lowFpsSecs = 0
    private var fastSecs = 0
    private var lastSwitchMs = UNSET
    private var lastUpMs = UNSET
    private var upSteps = 0

    private fun move(r: Rung, d: Delegate): LadderAction {
        rung = r
        delegate = d
        return LadderAction.Switch(r, d)
    }

    /**
     * Decision for one start-up sample: [medianMs] is the median inference time of the 12 results
     * measured at [current] / [delegate] (NaN = not enough data), [maskBlank] the blank-mask check,
     * [elapsedMs] the time since the model file became ready.
     */
    fun startupAction(
        medianMs: Float,
        maskBlank: Boolean,
        current: Rung,
        delegate: Delegate,
        elapsedMs: Long,
    ): LadderAction {
        this.rung = current
        this.delegate = delegate

        // A blank mask is a hard failure, so it is handled even past the start-up cap: first retry
        // the rung on CPU, and if the CPU mask is blank too, drop the mask rungs.
        if (current.hasMask && maskBlank) {
            trialPending = false
            return if (delegate == Delegate.GPU) {
                this.delegate = Delegate.CPU
                LadderAction.UseCpu()
            } else {
                move(Rung.LITE_CAPSULE, Delegate.CPU)
            }
        }

        // Result of the CPU trial: keep CPU only when it is clearly faster, else GPU stays and (it
        // was over budget at this rung) the next rung down is tried on GPU.
        if (trialPending && delegate == Delegate.CPU) {
            trialPending = false
            val cpuBetter = !medianMs.isNaN() && medianMs < CPU_WIN_RATIO * trialGpuMedian
            if (!cpuBetter) {
                val next = if (elapsedMs >= STARTUP_CAP_MS) current else (current.worse() ?: current)
                return move(next, Delegate.GPU)
            }
        }

        if (elapsedMs >= STARTUP_CAP_MS) return LadderAction.Accept()
        if (medianMs.isNaN()) return LadderAction.Stay
        if (medianMs <= cfg.budgetFor(current)) return LadderAction.Accept()

        // Over budget.
        if (delegate == Delegate.GPU) {
            trialPending = true
            trialGpuMedian = medianMs
            this.delegate = Delegate.CPU
            return LadderAction.UseCpu()
        }
        val next = current.worse() ?: return LadderAction.Accept()
        return move(next, delegate)
    }

    /**
     * In-session governor, called once per second with the rolling median inference time (NaN = no
     * data), the frame rate over the last second, and a monotonic clock. Step down after 3
     * consecutive seconds with the median above 1.25 x the current rung's budget, or fps in (0, 14)
     * together with a median above 0.7 x the current rung's budget (a slow camera is not a slow model).
     * Step up (at most 2 per session, 60 s after any switch, 2 min after the previous up-step) after
     * 20 consecutive seconds with the median below half of the base budget.
     */
    fun onSecond(medianMs: Float, fps: Float, nowMs: Long): LadderAction {
        if (lastSwitchMs == UNSET) lastSwitchMs = nowMs
        val over = !medianMs.isNaN() && medianMs > cfg.budgetFor(rung) * OVER_FACTOR
        // A low frame rate only counts when inference is also close to the budget: in dim light the
        // camera itself delivers fewer frames, and a cheaper rung would not help.
        val lowFps = fps > 0f && fps < MIN_FPS &&
            !medianMs.isNaN() && medianMs > cfg.budgetFor(rung) * LOW_FPS_COST_FACTOR
        val fast = !medianMs.isNaN() && medianMs < FAST_FACTOR * cfg.budgetMs
        overSecs = if (over) overSecs + 1 else 0
        lowFpsSecs = if (lowFps) lowFpsSecs + 1 else 0
        fastSecs = if (fast) fastSecs + 1 else 0

        val worse = rung.worse()
        if (worse != null && (overSecs >= DOWN_SECS || lowFpsSecs >= DOWN_SECS)) {
            return governorSwitch(worse, nowMs, up = false)
        }
        val better = rung.better()
        if (better != null &&
            fastSecs >= UP_SECS &&
            nowMs - lastSwitchMs >= MIN_SWITCH_GAP_MS &&
            upSteps < MAX_UP_STEPS &&
            (lastUpMs == UNSET || nowMs - lastUpMs >= MIN_UP_GAP_MS)
        ) {
            return governorSwitch(better, nowMs, up = true)
        }
        return LadderAction.Stay
    }

    private fun governorSwitch(target: Rung, nowMs: Long, up: Boolean): LadderAction {
        overSecs = 0
        lowFpsSecs = 0
        fastSecs = 0
        lastSwitchMs = nowMs
        if (up) {
            upSteps++
            lastUpMs = nowMs
        }
        return move(target, delegate)
    }

    private companion object {
        const val UNSET = Long.MIN_VALUE
        const val STARTUP_CAP_MS = 8_000L
        const val CPU_WIN_RATIO = 0.8f
        const val OVER_FACTOR = 1.25f
        const val FAST_FACTOR = 0.5f
        const val MIN_FPS = 14f
        const val LOW_FPS_COST_FACTOR = 0.7f
        const val DOWN_SECS = 3
        const val UP_SECS = 20
        const val MIN_SWITCH_GAP_MS = 60_000L
        const val MIN_UP_GAP_MS = 120_000L
        const val MAX_UP_STEPS = 2
    }
}
