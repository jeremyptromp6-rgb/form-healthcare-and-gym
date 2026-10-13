package app.form.posecamera.overlay

import android.graphics.Canvas
import android.graphics.Paint
import app.form.posecamera.core.FillCenter
import app.form.posecamera.core.OneEuro

private const val LANDMARKS = 33

/** A joint appears at this visibility and disappears below the lower one (hysteresis). */
private const val SHOW_VIS = 0.5f
private const val HIDE_VIS = 0.35f

private const val FADE_MS = 120f

private const val DOT_RADIUS_DP = 5f
private const val RING_WIDTH_DP = 1.5f
private const val GLOW_RADIUS_DP = 8f
private const val GLOW_ALPHA = 0.22f

/**
 * One-Euro parameters from the design (minCutoff 2 Hz, beta 0.6, dCutoff 1 Hz). The filter runs on
 * percent-of-region coordinates (normalized x 100) so that beta is meaningful: in 0..1 units the
 * speed term would be too small to ever open the cutoff and the dots would trail the body.
 */
private const val MIN_CUTOFF_HZ = 2f
private const val BETA = 0.6f
private const val D_CUTOFF_HZ = 1f
private const val PERCENT = 100f

/**
 * Small dots on the exercise's chain joints only. Per joint: One-Euro smoothing on the extrapolated
 * position, visibility hysteresis and a short fade. UI thread only. Allocates nothing per frame.
 */
internal class JointPainter(private val density: Float) {
    private val fx = Array(LANDMARKS) { OneEuro(MIN_CUTOFF_HZ, BETA, D_CUTOFF_HZ) }
    private val fy = Array(LANDMARKS) { OneEuro(MIN_CUTOFF_HZ, BETA, D_CUTOFF_HZ) }
    private val visible = BooleanArray(LANDMARKS)
    private val alpha = FloatArray(LANDMARKS)
    private val lastX = FloatArray(LANDMARKS)
    private val lastY = FloatArray(LANDMARKS)

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = RING_WIDTH_DP * density
    }

    fun reset() {
        for (j in 0 until LANDMARKS) {
            fx[j].reset()
            fy[j].reset()
            visible[j] = false
            alpha[j] = 0f
        }
    }

    /** Drops filter history only (fades and visibility stay). Needed when the time origin restarts. */
    fun resetFilters() {
        for (j in 0 until LANDMARKS) {
            fx[j].reset()
            fy[j].reset()
        }
    }

    /**
     * [ex] = extrapolated landmarks (99 floats, normalized region coords, visibility in the third
     * slot). [tSec] is the draw time on the same origin as the extrapolator. [presence] is the
     * overall fade (0..1). [simple] skips the soft glow (governor).
     */
    fun draw(
        canvas: Canvas,
        ex: FloatArray,
        chain: IntArray,
        fc: FillCenter,
        tSec: Float,
        dtMs: Float,
        color: Int,
        highlight: Int,
        presence: Float,
        reduceMotion: Boolean,
        simple: Boolean,
    ) {
        if (presence <= 0f || ex.size < LANDMARKS * 3) return
        val step = if (dtMs > 0f) dtMs / FADE_MS else 1f
        val radius = DOT_RADIUS_DP * density
        val ringRadius = radius + RING_WIDTH_DP * density * 0.5f
        val glowRadius = GLOW_RADIUS_DP * density
        for (k in chain.indices) {
            val j = chain[k]
            if (j < 0 || j >= LANDMARKS) continue
            val vis = ex[j * 3 + 2]
            if (!visible[j]) {
                if (vis >= SHOW_VIS) {
                    visible[j] = true
                    fx[j].reset()
                    fy[j].reset()
                }
            } else if (vis < HIDE_VIS) {
                visible[j] = false
            }
            val target = if (visible[j]) 1f else 0f
            alpha[j] = when {
                reduceMotion -> target
                alpha[j] < target -> minOf(target, alpha[j] + step)
                else -> maxOf(target, alpha[j] - step)
            }
            if (visible[j]) {
                val x = ex[j * 3]
                val y = ex[j * 3 + 1]
                if (x.isFinite() && y.isFinite()) {
                    lastX[j] = fx[j].filter(x * PERCENT, tSec)
                    lastY[j] = fy[j].filter(y * PERCENT, tSec)
                }
            }
            val a = presence * alpha[j]
            if (a <= 0.01f) continue
            val cx = fc.x(lastX[j] / PERCENT)
            val cy = fc.y(lastY[j] / PERCENT)
            if (!cx.isFinite() || !cy.isFinite()) continue
            if (!simple) {
                glow.color = color
                glow.alpha = toAlpha(GLOW_ALPHA * a)
                canvas.drawCircle(cx, cy, glowRadius, glow)
            }
            fill.color = color
            fill.alpha = toAlpha(a)
            canvas.drawCircle(cx, cy, radius, fill)
            ring.color = highlight
            ring.alpha = toAlpha(a)
            canvas.drawCircle(cx, cy, ringRadius, ring)
        }
    }

    private fun toAlpha(a: Float): Int = (a * 255f + 0.5f).toInt().coerceIn(0, 255)
}
