package app.form.posecamera.core

import kotlin.math.max
import kotlin.math.roundToInt

/** Iteration limit: each pass doubles the point count, so more than this is never useful. */
private const val MAX_ITERATIONS = 6

/**
 * Chaikin corner cutting (0.25 / 0.75). Closed lines wrap around; open lines keep both endpoints
 * fixed. If the result still has more than [maxPoints] points it is thinned to exactly [maxPoints]
 * evenly spaced points (open lines keep both endpoints). Input with fewer than 2 points (3 for a
 * closed line) is returned unchanged.
 */
fun chaikin(p: Polyline, iterations: Int, maxPoints: Int): Polyline {
    val minPoints = if (p.closed) 3 else 2
    if (p.xs.size < minPoints || p.xs.size != p.ys.size) return p
    var xs = p.xs
    var ys = p.ys
    val iters = iterations.coerceIn(0, MAX_ITERATIONS)
    for (iter in 0 until iters) {
        val n = xs.size
        if (p.closed) {
            val nx = FloatArray(2 * n)
            val ny = FloatArray(2 * n)
            for (i in 0 until n) {
                val j = if (i + 1 == n) 0 else i + 1
                nx[2 * i] = 0.75f * xs[i] + 0.25f * xs[j]
                ny[2 * i] = 0.75f * ys[i] + 0.25f * ys[j]
                nx[2 * i + 1] = 0.25f * xs[i] + 0.75f * xs[j]
                ny[2 * i + 1] = 0.25f * ys[i] + 0.75f * ys[j]
            }
            xs = nx
            ys = ny
        } else {
            // P0, then Q and R of every segment, then the last point: 2n points, endpoints fixed.
            val nx = FloatArray(2 * n)
            val ny = FloatArray(2 * n)
            nx[0] = xs[0]
            ny[0] = ys[0]
            var k = 1
            for (i in 0 until n - 1) {
                nx[k] = 0.75f * xs[i] + 0.25f * xs[i + 1]
                ny[k] = 0.75f * ys[i] + 0.25f * ys[i + 1]
                k++
                nx[k] = 0.25f * xs[i] + 0.75f * xs[i + 1]
                ny[k] = 0.25f * ys[i] + 0.75f * ys[i + 1]
                k++
            }
            nx[k] = xs[n - 1]
            ny[k] = ys[n - 1]
            xs = nx
            ys = ny
        }
    }
    val cap = max(maxPoints, minPoints)
    val n = xs.size
    if (n > cap) {
        val tx = FloatArray(cap)
        val ty = FloatArray(cap)
        for (k in 0 until cap) {
            val idx = if (p.closed) {
                ((k.toLong() * n) / cap).toInt()
            } else {
                (k.toDouble() * (n - 1) / (cap - 1)).roundToInt()
            }
            tx[k] = xs[idx]
            ty[k] = ys[idx]
        }
        xs = tx
        ys = ty
    }
    return Polyline(xs, ys, p.closed)
}
