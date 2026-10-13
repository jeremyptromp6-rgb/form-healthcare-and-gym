package app.form.posecamera.core

/**
 * A polyline in normalized region coordinates. For a closed line the first point is NOT repeated
 * at the end (the closing edge is implied).
 */
class Polyline(val xs: FloatArray, val ys: FloatArray, val closed: Boolean) {
    val size: Int
        get() = xs.size
}

private class Candidate(val area: Double, val order: Int, val line: Polyline)

/** Relative size below which a secondary contour is dropped (a quarter of the largest). */
private const val RELATIVE_AREA_KEEP = 0.25

/**
 * Marching squares on the unpadded grid. Samples sit at cell centres, so sample (gx, gy) is at
 * normalized ((gx + 0.5) / gw, (gy + 0.5) / gh). Crossings use linear interpolation along lattice
 * edges. A shape cut by the frame yields OPEN lines that end at the outermost sample row or column;
 * nothing is traced along the frame edge.
 *
 * Contours are ranked by enclosed area (open lines: the area between the line and its chord, as a
 * fraction of the whole region). A contour is kept when its area is at least [minAreaFrac] and, apart
 * from the largest, at least a quarter of the largest. At most [maxLines] lines are returned,
 * largest first.
 */
fun contours(g: MaskGrid, iso: Float, minAreaFrac: Float, maxLines: Int): List<Polyline> {
    val gw = g.gw
    val gh = g.gh
    if (gw < 2 || gh < 2 || maxLines <= 0 || g.v.size < gw * gh) return emptyList()
    val v = g.v
    val nEdges = 2 * gw * gh

    // Each crossed lattice edge links to at most two others (the other end of the segment in each of
    // the two cells that share it). Horizontal edge (x,y)-(x+1,y) = 2*(y*gw+x); vertical = that + 1.
    val n0 = IntArray(nEdges) { -1 }
    val n1 = IntArray(nEdges) { -1 }

    fun link(a: Int, b: Int) {
        if (n0[a] == -1) n0[a] = b else n1[a] = b
        if (n0[b] == -1) n0[b] = a else n1[b] = a
    }

    for (cy in 0 until gh - 1) {
        for (cx in 0 until gw - 1) {
            val iTl = cy * gw + cx
            val iTr = iTl + 1
            val iBl = iTl + gw
            val iBr = iBl + 1
            val a = v[iTl] >= iso
            val b = v[iTr] >= iso
            val c = v[iBr] >= iso
            val d = v[iBl] >= iso
            if (a == b && b == c && c == d) continue
            val top = 2 * iTl
            val bottom = 2 * iBl
            val left = 2 * iTl + 1
            val right = 2 * iTr + 1
            val tc = a != b
            val rc = b != c
            val bc = c != d
            val lc = d != a
            val count = (if (tc) 1 else 0) + (if (rc) 1 else 0) + (if (bc) 1 else 0) + (if (lc) 1 else 0)
            if (count == 2) {
                var first = -1
                if (tc) first = top
                if (rc) {
                    if (first == -1) first = right else link(first, right)
                }
                if (bc) {
                    if (first == -1) first = bottom else link(first, bottom)
                }
                if (lc) link(first, left)
            } else {
                // Saddle: a and c share a state, b and d the other. Resolve by the centre value.
                val centreInside = (v[iTl] + v[iTr] + v[iBr] + v[iBl]) / 4f >= iso
                val joinTopRight = if (a) centreInside else !centreInside
                if (joinTopRight) {
                    link(top, right)
                    link(bottom, left)
                } else {
                    link(top, left)
                    link(right, bottom)
                }
            }
        }
    }

    // Crossing position along an edge (0..1 from its first sample).
    fun crossT(e: Int): Float {
        val idx = e / 2
        val vertical = e % 2 == 1
        val va = v[idx]
        val vb = if (vertical) v[idx + gw] else v[idx + 1]
        var t = (iso - va) / (vb - va)
        if (!t.isFinite()) t = 0.5f
        if (t < 0f) t = 0f else if (t > 1f) t = 1f
        return t
    }

    fun px(e: Int): Float {
        val x = (e / 2) % gw
        val vertical = e % 2 == 1
        return (x + 0.5f + (if (vertical) 0f else crossT(e))) / gw
    }

    fun py(e: Int): Float {
        val y = (e / 2) / gw
        val vertical = e % 2 == 1
        return (y + 0.5f + (if (vertical) crossT(e) else 0f)) / gh
    }

    val visited = BooleanArray(nEdges)
    val found = ArrayList<Candidate>()
    val path = ArrayList<Int>()

    fun walk(start: Int, closed: Boolean) {
        path.clear()
        var prev = -1
        var cur = start
        while (true) {
            visited[cur] = true
            path.add(cur)
            val a = n0[cur]
            val b = n1[cur]
            val next = if (a != -1 && a != prev) a else if (b != -1 && b != prev) b else -1
            if (next == -1 || visited[next]) break
            prev = cur
            cur = next
        }
        val n = path.size
        if (n < 2 || (closed && n < 3)) return
        val xs = FloatArray(n)
        val ys = FloatArray(n)
        for (i in 0 until n) {
            xs[i] = px(path[i])
            ys[i] = py(path[i])
        }
        found.add(Candidate(polygonArea(xs, ys), found.size, Polyline(xs, ys, closed)))
    }

    // Open lines first (they start at a crossing with a single neighbour), then closed loops.
    for (e in 0 until nEdges) {
        if (!visited[e] && n0[e] != -1 && n1[e] == -1) walk(e, false)
    }
    for (e in 0 until nEdges) {
        if (!visited[e] && n0[e] != -1) walk(e, true)
    }
    if (found.isEmpty()) return emptyList()

    found.sortWith(compareByDescending<Candidate> { it.area }.thenBy { it.order })
    val largest = found[0].area
    val result = ArrayList<Polyline>()
    for (i in found.indices) {
        if (result.size >= maxLines) break
        val c = found[i]
        if (c.area < minAreaFrac) break
        if (i > 0 && c.area < RELATIVE_AREA_KEEP * largest) break
        result.add(c.line)
    }
    return result
}

/** Absolute shoelace area; open lines are closed by their chord. */
private fun polygonArea(xs: FloatArray, ys: FloatArray): Double {
    val n = xs.size
    var s = 0.0
    for (i in 0 until n) {
        val j = if (i + 1 == n) 0 else i + 1
        s += xs[i].toDouble() * ys[j] - xs[j].toDouble() * ys[i]
    }
    return Math.abs(s) / 2.0
}
