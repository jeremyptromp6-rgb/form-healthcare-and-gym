package app.form.posecamera.core

import java.nio.FloatBuffer
import kotlin.math.max
import kotlin.math.roundToInt

/** A grid of the given size (all zeros), used for invalid input so callers never see a zero-size grid. */
private fun emptyGrid(gw: Int, gh: Int, out: MaskGrid?): MaskGrid {
    val g = if (out != null && out.gw == gw && out.gh == gh && out.v.size == gw * gh) out else MaskGrid(gw, gh, FloatArray(gw * gh))
    java.util.Arrays.fill(g.v, 0f)
    return g
}

/**
 * Box-averages a w x h float mask (row-major, starting at the buffer's position) down to a grid whose
 * long edge is at most [longEdge] (never up-scaled). Reuses [out] when its size matches.
 * NaN samples count as 0; results are clamped to 0..1. A short buffer gives an all-zero grid.
 */
fun downsampleMask(src: FloatBuffer, w: Int, h: Int, longEdge: Int, out: MaskGrid?): MaskGrid {
    if (w <= 0 || h <= 0) return emptyGrid(1, 1, out)
    val long = max(w, h)
    val gw: Int
    val gh: Int
    if (longEdge <= 0 || long <= longEdge) {
        gw = w
        gh = h
    } else {
        val s = longEdge.toDouble() / long
        gw = max(1, (w * s).roundToInt())
        gh = max(1, (h * s).roundToInt())
    }
    if (src.remaining().toLong() < w.toLong() * h) return emptyGrid(gw, gh, out)
    val grid = if (out != null && out.gw == gw && out.gh == gh && out.v.size == gw * gh) out else MaskGrid(gw, gh, FloatArray(gw * gh))
    val base = src.position()
    for (gy in 0 until gh) {
        val y0 = (gy.toLong() * h / gh).toInt()
        val y1 = max(y0 + 1, ((gy + 1).toLong() * h / gh).toInt())
        for (gx in 0 until gw) {
            val x0 = (gx.toLong() * w / gw).toInt()
            val x1 = max(x0 + 1, ((gx + 1).toLong() * w / gw).toInt())
            var sum = 0f
            var n = 0
            for (y in y0 until y1) {
                val row = base + y * w
                for (x in x0 until x1) {
                    val s = src.get(row + x)
                    if (!s.isNaN()) sum += s
                    n++
                }
            }
            val avg = if (n > 0) sum / n else 0f
            grid.v[gy * gw + gx] = if (avg < 0f) 0f else if (avg > 1f) 1f else avg
        }
    }
    return grid
}

/**
 * Temporal smoothing: result = prev + alpha * (cur - prev), where [alpha] is the weight of the new
 * sample. Resets to [cur] (returned as is) when [prev] is null or the grid size changed.
 * Always returns a grid that is safe to keep (the inputs are not modified).
 */
fun ema(prev: MaskGrid?, cur: MaskGrid, alpha: Float): MaskGrid {
    if (prev == null || prev.gw != cur.gw || prev.gh != cur.gh || prev.v.size != cur.v.size) return cur
    val a = if (alpha.isNaN()) 1f else if (alpha < 0f) 0f else if (alpha > 1f) 1f else alpha
    val out = FloatArray(cur.v.size)
    for (i in out.indices) {
        val p = prev.v[i]
        val c = cur.v[i]
        out[i] = if (p.isNaN()) c else p + a * (c - p)
    }
    return MaskGrid(cur.gw, cur.gh, out)
}

/**
 * The web-GPU symptom: a person is clearly visible (landmarks) yet the mask is empty
 * (grid maximum below 0.05). The caller counts consecutive frames before acting on it.
 */
fun maskLooksBlank(g: MaskGrid, personVisible: Boolean): Boolean {
    if (!personVisible) return false
    var mx = 0f
    for (x in g.v) {
        if (x > mx) mx = x
    }
    return mx < 0.05f
}
