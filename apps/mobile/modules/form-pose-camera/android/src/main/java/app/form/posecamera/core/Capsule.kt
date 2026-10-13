package app.form.posecamera.core

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val GRID_LONG_EDGE = 96
private const val TORSO_RADIUS = 0.30f
private const val LIMB_RADIUS = 0.16f
private const val HEAD_RADIUS = 0.22f

/** Limb capsules by landmark pair: shoulder-elbow-wrist and hip-knee-ankle, both sides. */
private val LIMBS: Array<IntArray> = arrayOf(
    intArrayOf(11, 13), intArrayOf(13, 15),
    intArrayOf(12, 14), intArrayOf(14, 16),
    intArrayOf(23, 25), intArrayOf(25, 27),
    intArrayOf(24, 26), intArrayOf(26, 28),
)

/** Distance from (px, py) to the segment (ax, ay)-(bx, by). */
private fun segDist(px: Float, py: Float, ax: Float, ay: Float, bx: Float, by: Float): Float {
    val dx = bx - ax
    val dy = by - ay
    val len2 = dx * dx + dy * dy
    var t = if (len2 > 1e-12f) ((px - ax) * dx + (py - ay) * dy) / len2 else 0f
    if (t < 0f) t = 0f else if (t > 1f) t = 1f
    return hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Degraded body outline for the rungs without a mask: the union of limb capsules, a torso quad
 * grown by 0.30 x the shoulder-to-hip distance, limbs of radius 0.16 x that distance, and a head
 * circle (0.22 x) at the nose. The union is rasterised on a coarse grid as a smooth distance field
 * and traced with [contours], so a body cut by the frame gives open lines like the mask outline.
 *
 * [lm] is 99 floats ([x, y, visibility] x 33, normalized to the region); [aspect] = region width /
 * height so that radii are round in pixels (the default 1 treats the region as square). Returns an
 * empty list when the shoulders or hips are not visible (below [minVis]) or the input is unusable.
 */
fun capsuleOutline(lm: FloatArray, minVis: Float, aspect: Float = 1f): List<Polyline> {
    if (lm.size < 99) return emptyList()
    val asp = if (aspect.isFinite() && aspect > 0f) aspect else 1f

    fun ok(i: Int): Boolean =
        lm[i * 3 + 2] >= minVis && lm[i * 3].isFinite() && lm[i * 3 + 1].isFinite()

    fun ax(i: Int): Float = lm[i * 3] * asp
    fun ay(i: Int): Float = lm[i * 3 + 1]

    if (!ok(11) || !ok(12) || !ok(23) || !ok(24)) return emptyList()
    val torsoLen = hypot(
        (ax(11) + ax(12)) / 2f - (ax(23) + ax(24)) / 2f,
        (ay(11) + ay(12)) / 2f - (ay(23) + ay(24)) / 2f,
    )
    if (!(torsoLen > 1e-4f)) return emptyList()

    // Capsules as (ax, ay, bx, by, radius); the torso quad is handled separately.
    val caps = ArrayList<FloatArray>()
    for (pair in LIMBS) {
        if (ok(pair[0]) && ok(pair[1])) {
            caps.add(floatArrayOf(ax(pair[0]), ay(pair[0]), ax(pair[1]), ay(pair[1]), LIMB_RADIUS * torsoLen))
        }
    }
    if (ok(0)) {
        caps.add(floatArrayOf(ax(0), ay(0), ax(0), ay(0), HEAD_RADIUS * torsoLen))
    }
    // Quad order around the torso: left shoulder, right shoulder, right hip, left hip.
    val qx = floatArrayOf(ax(11), ax(12), ax(24), ax(23))
    val qy = floatArrayOf(ay(11), ay(12), ay(24), ay(23))
    val torsoR = TORSO_RADIUS * torsoLen

    val gw: Int
    val gh: Int
    if (asp >= 1f) {
        gw = GRID_LONG_EDGE
        gh = max(2, (GRID_LONG_EDGE / asp).roundToInt())
    } else {
        gh = GRID_LONG_EDGE
        gw = max(2, (GRID_LONG_EDGE * asp).roundToInt())
    }
    // Width of the soft edge: the field crosses 0.5 exactly at the capsule boundary.
    val soft = max(asp / gw, 1f / gh)
    val field = FloatArray(gw * gh)
    for (gy in 0 until gh) {
        val py = (gy + 0.5f) / gh
        for (gx in 0 until gw) {
            val px = (gx + 0.5f) / gw * asp
            var best = Float.POSITIVE_INFINITY
            for (c in caps) {
                val d = segDist(px, py, c[0], c[1], c[2], c[3]) - c[4]
                if (d < best) best = d
            }
            val dq = quadDist(px, py, qx, qy) - torsoR
            if (dq < best) best = dq
            val value = 0.5f - best / (2f * soft)
            field[gy * gw + gx] = min(1f, max(0f, value))
        }
    }
    return contours(MaskGrid(gw, gh, field), 0.5f, 0.002f, 3)
}

/** Distance to a quad (0 inside), for a convex or slightly twisted quad given by 4 vertices. */
private fun quadDist(px: Float, py: Float, qx: FloatArray, qy: FloatArray): Float {
    var pos = 0
    var neg = 0
    var best = Float.POSITIVE_INFINITY
    for (i in 0 until 4) {
        val j = (i + 1) % 4
        val cross = (qx[j] - qx[i]) * (py - qy[i]) - (qy[j] - qy[i]) * (px - qx[i])
        if (cross > 0f) pos++ else if (cross < 0f) neg++
        val d = segDist(px, py, qx[i], qy[i], qx[j], qy[j])
        if (d < best) best = d
    }
    return if (pos == 0 || neg == 0) 0f else best
}
