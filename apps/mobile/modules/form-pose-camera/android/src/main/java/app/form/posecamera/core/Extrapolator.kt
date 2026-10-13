package app.form.posecamera.core

import kotlin.math.exp
import kotlin.math.hypot

private const val LANDMARKS = 33
private const val STRIDE = 3

/** Shoulders and hips: the landmarks whose mean displacement shifts the outline rigidly. */
private val TORSO = intArrayOf(11, 12, 23, 24)

/** A gap this long between results restarts velocity estimation instead of smoothing across it. */
private const val GAP_RESET_MS = 500f

/**
 * Latency compensation: estimates landmark velocity from successive results and projects each
 * landmark forward to the display time.
 *
 * Velocity is (p_new - p_prev) / dt, smoothed with an EMA of time constant [velTauMs] and clamped
 * to [maxSpeed] (normalized units per second). At draw time the horizon is
 * clamp((tDisplay - tCapture) - lead, 0, [maxLeadMs]) ms and each landmark's displacement is
 * clamped to [maxDisp] (normalized units).
 *
 * Times are Float: pass milliseconds relative to a recent origin (for example the session start),
 * not raw sensor-clock values, which are too large for Float precision. [update] and [at] must use
 * the same origin. Not thread-safe: call both from one thread, or guard externally.
 */
class Extrapolator(
    val maxLeadMs: Float,
    val maxDisp: Float,
    val maxSpeed: Float,
    val velTauMs: Float,
) {
    private val pos = FloatArray(LANDMARKS * STRIDE)
    private val vx = FloatArray(LANDMARKS)
    private val vy = FloatArray(LANDMARKS)
    private var tCapture = 0f
    private var hasData = false
    private val scratch = FloatArray(2)

    /** Rigid torso displacement computed by the last [at] call (normalized units). */
    var torsoDx: Float = 0f
        private set
    var torsoDy: Float = 0f
        private set

    /** Feeds a result: [lm] is 99 floats ([x, y, visibility] x 33), captured at [tCaptureMs]. Non-finite landmarks keep their previous position. */
    fun update(tCaptureMs: Float, lm: FloatArray) {
        if (lm.size < LANDMARKS * STRIDE || !tCaptureMs.isFinite()) return
        if (!hasData) {
            for (i in 0 until LANDMARKS) {
                val x = lm[i * STRIDE]
                val y = lm[i * STRIDE + 1]
                pos[i * STRIDE] = if (x.isFinite()) x else 0f
                pos[i * STRIDE + 1] = if (y.isFinite()) y else 0f
                pos[i * STRIDE + 2] = lm[i * STRIDE + 2].let { if (it.isFinite()) it else 0f }
                vx[i] = 0f
                vy[i] = 0f
            }
            tCapture = tCaptureMs
            hasData = true
            return
        }
        val dt = tCaptureMs - tCapture
        if (dt <= 0f) return
        val gap = dt > GAP_RESET_MS
        val alpha = if (velTauMs > 0f) 1f - exp(-dt / velTauMs) else 1f
        for (i in 0 until LANDMARKS) {
            val x = lm[i * STRIDE]
            val y = lm[i * STRIDE + 1]
            if (!x.isFinite() || !y.isFinite()) {
                vx[i] = 0f
                vy[i] = 0f
                continue
            }
            if (gap) {
                vx[i] = 0f
                vy[i] = 0f
            } else {
                val rawX = (x - pos[i * STRIDE]) / dt * 1000f
                val rawY = (y - pos[i * STRIDE + 1]) / dt * 1000f
                var sx = vx[i] + alpha * (rawX - vx[i])
                var sy = vy[i] + alpha * (rawY - vy[i])
                val speed = hypot(sx, sy)
                if (speed > maxSpeed && speed > 0f) {
                    val k = maxSpeed / speed
                    sx *= k
                    sy *= k
                }
                vx[i] = sx
                vy[i] = sy
            }
            pos[i * STRIDE] = x
            pos[i * STRIDE + 1] = y
            pos[i * STRIDE + 2] = lm[i * STRIDE + 2].let { if (it.isFinite()) it else 0f }
        }
        tCapture = tCaptureMs
    }

    /**
     * Writes the projected landmarks (99 floats; visibility is copied through) into [out] and returns
     * the torso displacement magnitude. With no data yet, [out] is left untouched and 0 is returned.
     */
    fun at(tDisplayMs: Float, leadMs: Float, out: FloatArray): Float {
        torsoDx = 0f
        torsoDy = 0f
        if (!hasData || out.size < LANDMARKS * STRIDE) return 0f
        var horizon = (tDisplayMs - tCapture) - leadMs
        if (!horizon.isFinite() || horizon < 0f) horizon = 0f
        if (horizon > maxLeadMs) horizon = maxLeadMs
        val seconds = horizon / 1000f
        val disp = scratch
        for (i in 0 until LANDMARKS) {
            displacement(i, seconds, disp)
            out[i * STRIDE] = pos[i * STRIDE] + disp[0]
            out[i * STRIDE + 1] = pos[i * STRIDE + 1] + disp[1]
            out[i * STRIDE + 2] = pos[i * STRIDE + 2]
        }
        var sx = 0f
        var sy = 0f
        for (i in TORSO) {
            displacement(i, seconds, disp)
            sx += disp[0]
            sy += disp[1]
        }
        sx /= TORSO.size
        sy /= TORSO.size
        val mag = hypot(sx, sy)
        if (mag > maxDisp && mag > 0f) {
            val k = maxDisp / mag
            sx *= k
            sy *= k
        }
        torsoDx = sx
        torsoDy = sy
        return hypot(sx, sy)
    }

    /** Clamped displacement of landmark [i] after [seconds]. */
    private fun displacement(i: Int, seconds: Float, into: FloatArray) {
        var dx = vx[i] * seconds
        var dy = vy[i] * seconds
        val mag = hypot(dx, dy)
        if (mag > maxDisp && mag > 0f) {
            val k = maxDisp / mag
            dx *= k
            dy *= k
        }
        into[0] = dx
        into[1] = dy
    }
}
