package app.form.posecamera.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ChaikinTest {
    private fun square(): Polyline =
        Polyline(floatArrayOf(0f, 1f, 1f, 0f), floatArrayOf(0f, 0f, 1f, 1f), true)

    private fun vee(): Polyline =
        Polyline(floatArrayOf(0f, 0.5f, 1f), floatArrayOf(0f, 1f, 0f), false)

    @Test
    fun closedLineDoublesPerIteration() {
        assertEquals(8, chaikin(square(), 1, 1200).size)
        assertEquals(16, chaikin(square(), 2, 1200).size)
        assertTrue(chaikin(square(), 2, 1200).closed)
    }

    @Test
    fun closedLineCutsCornersInsideTheHull() {
        val c = chaikin(square(), 2, 1200)
        for (i in 0 until c.size) {
            assertTrue(c.xs[i] in 0f..1f)
            assertTrue(c.ys[i] in 0f..1f)
        }
        // the original corners are gone
        for (i in 0 until c.size) {
            assertTrue(!(c.xs[i] == 0f && c.ys[i] == 0f))
        }
    }

    @Test
    fun openLineKeepsBothEndpoints() {
        val o = chaikin(vee(), 3, 1200)
        assertEquals(24, o.size)
        assertEquals(0f, o.xs[0], 0f)
        assertEquals(0f, o.ys[0], 0f)
        assertEquals(1f, o.xs[o.size - 1], 0f)
        assertEquals(0f, o.ys[o.size - 1], 0f)
        assertTrue(!o.closed)
    }

    @Test
    fun firstIterationOfAnOpenLineMatchesTheCorners() {
        val o = chaikin(vee(), 1, 1200)
        assertEquals(6, o.size)
        assertEquals(0.125f, o.xs[1], 1e-6f)
        assertEquals(0.25f, o.ys[1], 1e-6f)
        assertEquals(0.375f, o.xs[2], 1e-6f)
        assertEquals(0.75f, o.ys[2], 1e-6f)
    }

    @Test
    fun pointCapIsRespected() {
        assertEquals(50, chaikin(square(), 5, 50).size)
        val open = chaikin(vee(), 5, 17)
        assertEquals(17, open.size)
        assertEquals(0f, open.xs[0], 0f)
        assertEquals(1f, open.xs[16], 0f)
        assertEquals(0f, open.ys[16], 0f)
    }

    @Test
    fun capNeverDropsBelowAValidLine() {
        assertEquals(3, chaikin(square(), 2, 0).size)
        assertEquals(2, chaikin(vee(), 2, 1).size)
    }

    @Test
    fun zeroIterationsAndTinyInputPassThrough() {
        val s = square()
        assertEquals(4, chaikin(s, 0, 1200).size)
        val single = Polyline(floatArrayOf(0.5f), floatArrayOf(0.5f), false)
        assertSame(single, chaikin(single, 2, 1200))
        val twoClosed = Polyline(floatArrayOf(0f, 1f), floatArrayOf(0f, 1f), true)
        assertSame(twoClosed, chaikin(twoClosed, 2, 1200))
    }

    @Test
    fun iterationCountIsBounded() {
        // 3 points * 2^6 would be the largest sensible result
        assertTrue(chaikin(vee(), 50, 100_000).size <= 3 * 64 + 2)
    }
}
