package app.form.posecamera.core

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max

/**
 * One-Euro filter (Casiez et al.): a low-pass filter whose cutoff rises with the signal's speed,
 * so slow motion is smooth and fast motion keeps up. Time is in seconds; non-finite input is
 * ignored (the last output is returned) and a non-increasing timestamp returns the last output.
 */
class OneEuro(
    private val minCutoffHz: Float,
    private val beta: Float,
    private val dCutoffHz: Float,
) {
    private var has = false
    private var xPrev = 0f
    private var dxPrev = 0f
    private var tPrev = 0f

    fun filter(x: Float, tSec: Float): Float {
        if (!x.isFinite() || !tSec.isFinite()) return if (has) xPrev else 0f
        if (!has) {
            has = true
            xPrev = x
            dxPrev = 0f
            tPrev = tSec
            return x
        }
        val dt = tSec - tPrev
        if (dt <= 0f) return xPrev
        val dx = (x - xPrev) / dt
        val dxHat = dxPrev + alpha(dCutoffHz, dt) * (dx - dxPrev)
        val cutoff = minCutoffHz + beta * abs(dxHat)
        val xHat = xPrev + alpha(cutoff, dt) * (x - xPrev)
        xPrev = xHat
        dxPrev = dxHat
        tPrev = tSec
        return xHat
    }

    fun reset() {
        has = false
        xPrev = 0f
        dxPrev = 0f
        tPrev = 0f
    }

    private fun alpha(cutoffHz: Float, dt: Float): Float {
        val tau = 1f / (2f * PI.toFloat() * max(cutoffHz, 1e-3f))
        return 1f / (1f + tau / dt)
    }
}
