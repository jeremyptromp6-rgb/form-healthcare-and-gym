package app.form.posecamera.core

import kotlin.math.max
import kotlin.math.roundToInt

/** Size of the visible region after rotating the crop upright (swaps for 90/270). */
fun uprightSize(cropW: Int, cropH: Int, rotationDegrees: Int): Pair<Int, Int> {
    val r = ((rotationDegrees % 360) + 360) % 360
    return if (r == 90 || r == 270) Pair(cropH, cropW) else Pair(cropW, cropH)
}

/** Downscales so the long edge is at most [longEdge]; never scales up. Sizes stay at least 1. */
fun inferSize(regionW: Int, regionH: Int, longEdge: Int): Pair<Int, Int> {
    val w = max(1, regionW)
    val h = max(1, regionH)
    val long = max(w, h)
    if (longEdge <= 0 || long <= longEdge) return Pair(w, h)
    val s = longEdge.toDouble() / long
    return Pair(max(1, (w * s).roundToInt()), max(1, (h * s).roundToInt()))
}
