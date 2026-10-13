package app.form.posecamera.core

import java.nio.ByteBuffer
import org.junit.Assert.assertEquals
import org.junit.Test

class LumaTest {
    private fun frame(w: Int, h: Int, stride: Int, r: Int, g: Int, b: Int, pad: Int = 0): ByteBuffer {
        val buf = ByteBuffer.allocate(stride * h)
        for (y in 0 until h) {
            for (i in 0 until stride) {
                val x = i / 4
                val inPixels = x < w
                val channel = i % 4
                val v = when {
                    !inPixels -> pad
                    channel == 0 -> r
                    channel == 1 -> g
                    channel == 2 -> b
                    else -> 255
                }
                buf.put(y * stride + i, v.toByte())
            }
        }
        return buf
    }

    @Test
    fun whiteIsAboutFull() {
        // (77 + 150 + 29) * 255 >> 8 = 255
        assertEquals(255f, meanLumaRgba(frame(64, 48, 256, 255, 255, 255), 64, 48, 256), 0f)
    }

    @Test
    fun blackIsZero() {
        assertEquals(0f, meanLumaRgba(frame(64, 48, 256, 0, 0, 0), 64, 48, 256), 0f)
    }

    @Test
    fun usesIntegerLumaWeights() {
        // integer luma: red (77 * 255) >> 8 = 76, green (150 * 255) >> 8 = 149, blue (29 * 255) >> 8 = 28
        assertEquals(76f, meanLumaRgba(frame(64, 48, 256, 255, 0, 0), 64, 48, 256), 0f)
        assertEquals(149f, meanLumaRgba(frame(64, 48, 256, 0, 255, 0), 64, 48, 256), 0f)
        assertEquals(28f, meanLumaRgba(frame(64, 48, 256, 0, 0, 255), 64, 48, 256), 0f)
    }

    @Test
    fun rowPaddingIsSkipped() {
        // 40 x 30 pixels in rows of 176 bytes; the 16 padding bytes are 255 but pixels are black
        assertEquals(0f, meanLumaRgba(frame(40, 30, 176, 0, 0, 0, pad = 255), 40, 30, 176), 0f)
        // and the opposite
        assertEquals(255f, meanLumaRgba(frame(40, 30, 176, 255, 255, 255, pad = 0), 40, 30, 176), 0f)
    }

    @Test
    fun smallFramesStillSample() {
        assertEquals(255f, meanLumaRgba(frame(4, 3, 16, 255, 255, 255), 4, 3, 16), 0f)
    }

    @Test
    fun halfAndHalfAveragesBetween() {
        val w = 64
        val h = 48
        val buf = ByteBuffer.allocate(w * h * 4)
        for (y in 0 until h) {
            for (x in 0 until w) {
                val v = if (x < w / 2) 255 else 0
                val o = (y * w + x) * 4
                buf.put(o, v.toByte())
                buf.put(o + 1, v.toByte())
                buf.put(o + 2, v.toByte())
                buf.put(o + 3, 255.toByte())
            }
        }
        assertEquals(127.5f, meanLumaRgba(buf, w, h, w * 4), 1f)
    }

    @Test
    fun badInputGivesZero() {
        assertEquals(0f, meanLumaRgba(ByteBuffer.allocate(0), 64, 48, 256), 0f)
        assertEquals(0f, meanLumaRgba(ByteBuffer.allocate(100), 0, 48, 256), 0f)
        assertEquals(0f, meanLumaRgba(ByteBuffer.allocate(100), 64, 48, 10), 0f)
        // a buffer shorter than the frame uses only the samples it has
        assertEquals(0f, meanLumaRgba(ByteBuffer.allocate(64), 64, 48, 256), 0f)
    }

    @Test
    fun readsFromTheBufferPosition() {
        val buf = ByteBuffer.allocate(8 + 64 * 48 * 4)
        for (i in 8 until buf.capacity()) buf.put(i, 255.toByte())
        buf.position(8)
        assertEquals(255f, meanLumaRgba(buf, 64, 48, 256), 0f)
    }
}
