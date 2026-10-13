package app.form.posecamera.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CapsuleTest {
    /** A person facing the camera, upright, landmarks normalized to a 3:4 region. */
    private fun standing(vis: Float = 1f): FloatArray {
        val lm = FloatArray(99)
        fun set(i: Int, x: Float, y: Float) {
            lm[i * 3] = x
            lm[i * 3 + 1] = y
            lm[i * 3 + 2] = vis
        }
        set(0, 0.5f, 0.18f)
        set(11, 0.4f, 0.3f)
        set(12, 0.6f, 0.3f)
        set(13, 0.35f, 0.45f)
        set(14, 0.65f, 0.45f)
        set(15, 0.33f, 0.58f)
        set(16, 0.67f, 0.58f)
        set(23, 0.45f, 0.55f)
        set(24, 0.55f, 0.55f)
        set(25, 0.45f, 0.75f)
        set(26, 0.55f, 0.75f)
        set(27, 0.45f, 0.9f)
        set(28, 0.55f, 0.9f)
        return lm
    }

    @Test
    fun visibleBodyGivesOneClosedOutlineAroundTheJoints() {
        val lines = capsuleOutline(standing(), 0.5f, 0.75f)
        assertEquals(1, lines.size)
        val line = lines[0]
        assertTrue(line.closed)
        assertTrue(line.size >= 20)
        var minX = 1f
        var maxX = 0f
        var minY = 1f
        var maxY = 0f
        for (i in 0 until line.size) {
            assertTrue(line.xs[i] in 0f..1f)
            assertTrue(line.ys[i] in 0f..1f)
            minX = minOf(minX, line.xs[i])
            maxX = maxOf(maxX, line.xs[i])
            minY = minOf(minY, line.ys[i])
            maxY = maxOf(maxY, line.ys[i])
        }
        // the outline encloses the wrists, the head and the ankles
        assertTrue(minX < 0.33f)
        assertTrue(maxX > 0.67f)
        assertTrue(minY < 0.18f)
        assertTrue(maxY > 0.9f)
    }

    @Test
    fun lowVisibilityOfAShoulderOrHipGivesNothing() {
        val lm = standing()
        lm[11 * 3 + 2] = 0.2f
        assertTrue(capsuleOutline(lm, 0.5f).isEmpty())
        val hip = standing()
        hip[24 * 3 + 2] = 0f
        assertTrue(capsuleOutline(hip, 0.5f).isEmpty())
        assertTrue(capsuleOutline(standing(0.1f), 0.5f).isEmpty())
    }

    @Test
    fun unusableInputGivesNothing() {
        assertTrue(capsuleOutline(FloatArray(10), 0.5f).isEmpty())
        assertTrue(capsuleOutline(FloatArray(99), 0.5f).isEmpty())
        val nan = standing()
        nan[12 * 3] = Float.NaN
        assertTrue(capsuleOutline(nan, 0.5f).isEmpty())
    }

    @Test
    fun hiddenLimbsAreSimplyLeftOut() {
        val full = capsuleOutline(standing(), 0.5f, 0.75f)
        val lm = standing()
        for (i in intArrayOf(15, 16, 27, 28)) lm[i * 3 + 2] = 0f
        val partial = capsuleOutline(lm, 0.5f, 0.75f)
        assertEquals(1, partial.size)
        var maxFull = 0f
        var maxPartial = 0f
        for (i in 0 until full[0].size) maxFull = maxOf(maxFull, full[0].ys[i])
        for (i in 0 until partial[0].size) maxPartial = maxOf(maxPartial, partial[0].ys[i])
        assertTrue(maxPartial < maxFull)
    }

    @Test
    fun bodyCutByTheFrameGivesAnOpenLine() {
        val lm = standing()
        // legs run off the bottom of the frame
        lm[25 * 3 + 1] = 1.1f
        lm[26 * 3 + 1] = 1.1f
        lm[27 * 3 + 1] = 1.4f
        lm[28 * 3 + 1] = 1.4f
        val lines = capsuleOutline(lm, 0.5f, 0.75f)
        assertTrue(lines.isNotEmpty())
        assertFalse(lines[0].closed)
    }

    @Test
    fun defaultAspectIsSquare() {
        val a = capsuleOutline(standing(), 0.5f)
        val b = capsuleOutline(standing(), 0.5f, 1f)
        assertEquals(a.size, b.size)
        assertEquals(a[0].size, b[0].size)
        assertTrue(a[0].xs.contentEquals(b[0].xs))
    }
}
