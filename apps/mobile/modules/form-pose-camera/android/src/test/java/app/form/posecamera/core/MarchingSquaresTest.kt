package app.form.posecamera.core

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MarchingSquaresTest {
    /** Binary grid from a predicate on the normalized sample position. */
    private fun grid(gw: Int, gh: Int, inside: (Float, Float) -> Boolean): MaskGrid {
        val v = FloatArray(gw * gh)
        for (y in 0 until gh) for (x in 0 until gw) {
            if (inside((x + 0.5f) / gw, (y + 0.5f) / gh)) v[y * gw + x] = 1f
        }
        return MaskGrid(gw, gh, v)
    }

    private fun area(p: Polyline): Double {
        var s = 0.0
        for (i in 0 until p.size) {
            val j = if (i + 1 == p.size) 0 else i + 1
            s += p.xs[i].toDouble() * p.ys[j] - p.xs[j].toDouble() * p.ys[i]
        }
        return abs(s) / 2.0
    }

    private fun ellipseValue(nx: Float, ny: Float, cx: Float, cy: Float, a: Float, b: Float): Float {
        val dx = (nx - cx) / a
        val dy = (ny - cy) / b
        return sqrt(dx * dx + dy * dy)
    }

    private fun disc(gw: Int, gh: Int, discs: List<Triple<Float, Float, Float>>): MaskGrid {
        // discs in sample units: (centre x, centre y, radius)
        val v = FloatArray(gw * gh)
        for (y in 0 until gh) for (x in 0 until gw) {
            for ((cx, cy, r) in discs) {
                val dx = x + 0.5f - cx
                val dy = y + 0.5f - cy
                if (dx * dx + dy * dy <= r * r) v[y * gw + x] = 1f
            }
        }
        return MaskGrid(gw, gh, v)
    }

    @Test
    fun ellipseGivesOneClosedContourNearTheTrueBoundary() {
        val gw = 60
        val gh = 80
        val g = grid(gw, gh) { nx, ny -> ellipseValue(nx, ny, 0.5f, 0.5f, 0.3f, 0.35f) <= 1f }
        val lines = contours(g, 0.5f, 0f, 3)
        assertEquals(1, lines.size)
        val line = lines[0]
        assertTrue(line.closed)
        val cell = max(1f / gw, 1f / gh)
        var worst = 0f
        for (i in 0 until line.size) {
            val d = abs(ellipseValue(line.xs[i], line.ys[i], 0.5f, 0.5f, 0.3f, 0.35f) - 1f) * 0.3f
            if (d > worst) worst = d
        }
        assertTrue("worst distance $worst exceeds one cell $cell", worst <= cell)
        // enclosed area close to pi * a * b
        assertEquals(Math.PI * 0.3 * 0.35, area(line), 0.01)
    }

    @Test
    fun bodyLikePolygonGivesOneClosedContour() {
        // head, torso and two legs
        val g = grid(48, 96) { nx, ny ->
            val head = (nx - 0.5f) * (nx - 0.5f) + (ny - 0.15f) * (ny - 0.15f) <= 0.08f * 0.08f
            val torso = nx in 0.3f..0.7f && ny in 0.2f..0.6f
            val legs = (nx in 0.33f..0.47f || nx in 0.53f..0.67f) && ny in 0.6f..0.92f
            head || torso || legs
        }
        val lines = contours(g, 0.5f, 0.0005f, 3)
        assertEquals(1, lines.size)
        assertTrue(lines[0].closed)
        var minY = 1f
        for (i in 0 until lines[0].size) {
            assertTrue(lines[0].xs[i] in 0.2f..0.8f)
            assertTrue(lines[0].ys[i] in 0.05f..0.95f)
            minY = minOf(minY, lines[0].ys[i])
        }
        // the head is part of the same contour
        assertTrue(minY < 0.1f)
    }

    @Test
    fun shapeCutByTheFrameGivesAnOpenLineNotAlongTheEdge() {
        val gw = 40
        val gh = 60
        val v = FloatArray(gw * gh)
        for (y in 30 until gh) for (x in 10 until 30) v[y * gw + x] = 1f
        val lines = contours(MaskGrid(gw, gh, v), 0.5f, 0f, 3)
        assertEquals(1, lines.size)
        val line = lines[0]
        assertFalse(line.closed)
        val bottomRow = (gh - 0.5f) / gh
        var onBottomRow = 0
        for (i in 0 until line.size) {
            assertTrue(line.xs[i] > 0f && line.xs[i] < 1f)
            assertTrue(line.ys[i] > 0f && line.ys[i] < 1f)
            if (line.ys[i] >= bottomRow - 1e-6f) onBottomRow++
        }
        // only the two ends reach the last sample row; nothing runs along it
        assertEquals(2, onBottomRow)
        assertTrue(line.ys[0] >= bottomRow - 1e-6f)
        assertTrue(line.ys[line.size - 1] >= bottomRow - 1e-6f)
    }

    @Test
    fun emptyAndFullGridsGiveNothing() {
        assertTrue(contours(MaskGrid(10, 10, FloatArray(100)), 0.5f, 0f, 3).isEmpty())
        assertTrue(contours(MaskGrid(10, 10, FloatArray(100) { 1f }), 0.5f, 0f, 3).isEmpty())
    }

    @Test
    fun degenerateInputGivesNothing() {
        assertTrue(contours(MaskGrid(1, 5, FloatArray(5) { 1f }), 0.5f, 0f, 3).isEmpty())
        assertTrue(contours(MaskGrid(4, 4, FloatArray(3)), 0.5f, 0f, 3).isEmpty())
        assertTrue(contours(MaskGrid(4, 4, FloatArray(16) { Float.NaN }), 0.5f, 0f, 3).isEmpty())
        val g = disc(20, 20, listOf(Triple(10f, 10f, 5f)))
        assertTrue(contours(g, 0.5f, 0f, 0).isEmpty())
    }

    @Test
    fun smallRegionsBelowTheAreaFractionAreDropped() {
        // two discs: areas about 0.043 and 0.023 of the region
        val g = disc(60, 80, listOf(Triple(15f, 20f, 8f), Triple(42f, 55f, 6f)))
        assertEquals(2, contours(g, 0.5f, 0.01f, 3).size)
        val kept = contours(g, 0.5f, 0.03f, 3)
        assertEquals(1, kept.size)
        assertTrue(area(kept[0]) > 0.03)
    }

    @Test
    fun smallHolesAreDroppedAndLargeOnesKept() {
        val ring = { inner: Float ->
            val v = FloatArray(60 * 80)
            for (y in 0 until 80) for (x in 0 until 60) {
                val d2 = (x + 0.5f - 30f) * (x + 0.5f - 30f) + (y + 0.5f - 40f) * (y + 0.5f - 40f)
                if (d2 <= 22f * 22f && d2 > inner * inner) v[y * 60 + x] = 1f
            }
            MaskGrid(60, 80, v)
        }
        // hole radius 3: about 0.6% of the region, a tiny fraction of the body
        val tiny = contours(ring(3f), 0.5f, 0.015f, 3)
        assertEquals(1, tiny.size)
        // hole radius 14: about 12.8% of the region, 40% of the body
        val big = contours(ring(14f), 0.5f, 0.015f, 3)
        assertEquals(2, big.size)
        assertTrue(area(big[0]) > area(big[1]))
        // but not when it is below minAreaFrac
        assertEquals(1, contours(ring(14f), 0.5f, 0.2f, 3).size)
    }

    @Test
    fun maxLinesCapsTheResultLargestFirst() {
        val g = disc(
            80, 80,
            listOf(Triple(14f, 14f, 8f), Triple(66f, 14f, 8f), Triple(14f, 66f, 8f), Triple(66f, 66f, 9f)),
        )
        val three = contours(g, 0.5f, 0f, 3)
        assertEquals(3, three.size)
        assertTrue(area(three[0]) >= area(three[1]))
        assertTrue(area(three[1]) >= area(three[2]))
        assertEquals(1, contours(g, 0.5f, 0f, 1).size)
    }

    @Test
    fun saddleCellsStayConsistent() {
        // diagonal pair of samples: two separate lines, never a crossing
        val two = contours(MaskGrid(2, 2, floatArrayOf(1f, 0f, 0f, 1f)), 0.5f, 0f, 9)
        assertEquals(2, two.size)
        // corners of a 3 x 3 grid: four small open lines
        val corners = contours(MaskGrid(3, 3, floatArrayOf(1f, 0f, 1f, 0f, 0f, 0f, 1f, 0f, 1f)), 0.5f, 0f, 9)
        assertEquals(4, corners.size)
    }

    @Test
    fun interpolatesTheCrossingAlongTheEdge() {
        // a vertical step between sample 1 (0.2) and 2 (0.8) across a tall grid crosses at t = 0.5
        val gw = 4
        val gh = 4
        val v = FloatArray(gw * gh)
        for (y in 0 until gh) {
            v[y * gw + 2] = 0.8f
            v[y * gw + 3] = 0.8f
            v[y * gw + 1] = 0.2f
        }
        val lines = contours(MaskGrid(gw, gh, v), 0.5f, 0f, 3)
        assertEquals(1, lines.size)
        for (i in 0 until lines[0].size) {
            assertEquals((1.5f + 0.5f) / gw, lines[0].xs[i], 1e-5f)
        }
        // an asymmetric value moves the crossing: 0.3 -> 0.9 crosses at t = 1/3
        for (y in 0 until gh) {
            v[y * gw + 1] = 0.3f
            v[y * gw + 2] = 0.9f
        }
        val skew = contours(MaskGrid(gw, gh, v), 0.5f, 0f, 3)
        assertEquals((1f + 0.5f + 1f / 3f) / gw, skew[0].xs[0], 1e-5f)
    }

    @Test
    fun resultIsDeterministic() {
        val g = disc(60, 80, listOf(Triple(15f, 20f, 8f), Triple(42f, 55f, 6f)))
        val a = contours(g, 0.5f, 0f, 3)
        val b = contours(g, 0.5f, 0f, 3)
        assertEquals(a.size, b.size)
        for (i in a.indices) {
            assertTrue(a[i].xs.contentEquals(b[i].xs))
            assertTrue(a[i].ys.contentEquals(b[i].ys))
        }
    }
}
