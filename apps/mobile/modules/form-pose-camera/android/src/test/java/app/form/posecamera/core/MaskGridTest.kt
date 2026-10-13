package app.form.posecamera.core

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class MaskGridTest {
    private fun buffer(w: Int, h: Int, f: (Int, Int) -> Float): FloatBuffer {
        val fb = FloatBuffer.allocate(w * h)
        for (y in 0 until h) for (x in 0 until w) fb.put(f(x, y))
        fb.rewind()
        return fb
    }

    @Test
    fun smallMaskIsNotUpscaled() {
        val g = downsampleMask(buffer(4, 3) { x, y -> (x + y) / 10f }, 4, 3, 96, null)
        assertEquals(4, g.gw)
        assertEquals(3, g.gh)
        assertEquals(0.3f, g.v[1 * 4 + 2], 1e-6f)
    }

    @Test
    fun downsampleKeepsAspectAndAveragesBoxes() {
        // 192 x 96 all ones except the left half of the first rows
        val g = downsampleMask(buffer(192, 96) { x, _ -> if (x < 96) 0f else 1f }, 192, 96, 96, null)
        assertEquals(96, g.gw)
        assertEquals(48, g.gh)
        assertEquals(0f, g.v[10 * 96 + 5], 1e-6f)
        assertEquals(1f, g.v[10 * 96 + 90], 1e-6f)
    }

    @Test
    fun boxAverageOfMixedBlock() {
        // 4 x 4 downsampled to long edge 2: each 2 x 2 block averaged
        val src = buffer(4, 4) { x, y -> if (x < 2 && y < 2) 1f else if (x == 0 && y == 2) 1f else 0f }
        val g = downsampleMask(src, 4, 4, 2, null)
        assertEquals(2, g.gw)
        assertEquals(2, g.gh)
        assertEquals(1f, g.v[0], 1e-6f)
        assertEquals(0f, g.v[1], 1e-6f)
        assertEquals(0.25f, g.v[2], 1e-6f)
        assertEquals(0f, g.v[3], 1e-6f)
    }

    @Test
    fun reusesTheOutGridWhenTheSizeMatches() {
        val first = downsampleMask(buffer(8, 8) { _, _ -> 1f }, 8, 8, 4, null)
        val second = downsampleMask(buffer(8, 8) { _, _ -> 0.5f }, 8, 8, 4, first)
        assertSame(first, second)
        assertEquals(0.5f, second.v[3], 1e-6f)
        val other = downsampleMask(buffer(8, 8) { _, _ -> 0.5f }, 8, 8, 2, first)
        assertNotSame(first, other)
        assertEquals(2, other.gw)
    }

    @Test
    fun readsFromTheBufferPositionAndSurvivesNanAndRange() {
        val fb = FloatBuffer.allocate(2 + 4)
        fb.put(9f).put(9f)
        fb.put(Float.NaN).put(2f).put(-1f).put(0.5f)
        fb.position(2)
        val g = downsampleMask(fb, 2, 2, 0, null)
        assertEquals(0f, g.v[0], 0f)
        assertEquals(1f, g.v[1], 0f)
        assertEquals(0f, g.v[2], 0f)
        assertEquals(0.5f, g.v[3], 0f)
        assertEquals(2, fb.position())
    }

    @Test
    fun floatBufferViewOfBytesWorks() {
        val bytes = ByteBuffer.allocateDirect(4 * 4).order(ByteOrder.nativeOrder())
        val fb = bytes.asFloatBuffer()
        fb.put(floatArrayOf(0f, 1f, 1f, 0f))
        fb.rewind()
        val g = downsampleMask(fb, 2, 2, 96, null)
        assertEquals(1f, g.v[1], 0f)
    }

    @Test
    fun shortBufferAndBadSizesGiveZeroGrids() {
        val g = downsampleMask(FloatBuffer.allocate(3), 2, 2, 96, null)
        assertEquals(4, g.v.size)
        assertEquals(0f, g.v.max(), 0f)
        val bad = downsampleMask(FloatBuffer.allocate(3), 0, 5, 96, null)
        assertEquals(1, bad.gw)
        assertEquals(1, bad.gh)
    }

    @Test
    fun emaBlendsAndResetsOnSizeChange() {
        val prev = MaskGrid(2, 1, floatArrayOf(0f, 1f))
        val cur = MaskGrid(2, 1, floatArrayOf(1f, 0f))
        val out = ema(prev, cur, 0.6f)
        assertEquals(0.6f, out.v[0], 1e-6f)
        assertEquals(0.4f, out.v[1], 1e-6f)
        // inputs untouched
        assertEquals(0f, prev.v[0], 0f)
        assertEquals(1f, cur.v[0], 0f)

        val resized = ema(prev, MaskGrid(1, 2, floatArrayOf(1f, 1f)), 0.6f)
        assertEquals(1f, resized.v[0], 0f)
        assertSame(cur, ema(null, cur, 0.6f))
    }

    @Test
    fun emaAlphaIsClamped() {
        val prev = MaskGrid(1, 1, floatArrayOf(0.2f))
        val cur = MaskGrid(1, 1, floatArrayOf(0.8f))
        assertEquals(0.2f, ema(prev, cur, -3f).v[0], 1e-6f)
        assertEquals(0.8f, ema(prev, cur, 7f).v[0], 1e-6f)
    }

    @Test
    fun blankDetection() {
        val blank = MaskGrid(2, 2, floatArrayOf(0f, 0.01f, 0.04f, 0f))
        val live = MaskGrid(2, 2, floatArrayOf(0f, 0.01f, 0.06f, 0f))
        assertTrue(maskLooksBlank(blank, true))
        assertFalse(maskLooksBlank(blank, false))
        assertFalse(maskLooksBlank(live, true))
        assertTrue(maskLooksBlank(MaskGrid(1, 1, floatArrayOf(Float.NaN)), true))
    }
}
