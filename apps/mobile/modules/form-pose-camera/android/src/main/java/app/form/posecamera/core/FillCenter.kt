package app.form.posecamera.core

import kotlin.math.max

/**
 * Maps normalized coordinates of an image region (0..1, top-left origin, un-mirrored) to view pixels
 * the way a FILL_CENTER preview does: scale to cover the view, centre, crop the overflow.
 * The same formula is mirrored in TypeScript (fill_center_vectors.csv is the shared test data).
 */
class FillCenter(
    val scale: Float,
    val ox: Float,
    val oy: Float,
    val dw: Float,
    val dh: Float,
    val viewW: Float,
    val mirrorX: Boolean,
) {
    /** ox + nx * dw; mirrored: viewW - (...). */
    fun x(nx: Float): Float {
        val px = ox + nx * dw
        return if (mirrorX) viewW - px else px
    }

    fun y(ny: Float): Float = oy + ny * dh

    companion object {
        fun of(imgW: Int, imgH: Int, viewW: Float, viewH: Float, mirrorX: Boolean): FillCenter {
            val vw = if (viewW.isFinite() && viewW > 0f) viewW else 0f
            val vh = if (viewH.isFinite() && viewH > 0f) viewH else 0f
            if (imgW <= 0 || imgH <= 0 || vw <= 0f || vh <= 0f) {
                // Degenerate input: map the unit square onto the view rectangle.
                return FillCenter(1f, 0f, 0f, vw, vh, vw, mirrorX)
            }
            val s = max(vw.toDouble() / imgW, vh.toDouble() / imgH)
            val dw = imgW * s
            val dh = imgH * s
            return FillCenter(
                s.toFloat(),
                ((vw - dw) / 2.0).toFloat(),
                ((vh - dh) / 2.0).toFloat(),
                dw.toFloat(),
                dh.toFloat(),
                vw,
                mirrorX,
            )
        }
    }
}
