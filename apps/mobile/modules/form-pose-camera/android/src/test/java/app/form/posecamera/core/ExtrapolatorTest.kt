package app.form.posecamera.core

import kotlin.math.hypot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ExtrapolatorTest {
    private fun make() = Extrapolator(maxLeadMs = 120f, maxDisp = 0.06f, maxSpeed = 2.5f, velTauMs = 60f)

    /** All 33 landmarks at (x, y). */
    private fun all(x: Float, y: Float, vis: Float = 1f): FloatArray {
        val a = FloatArray(99)
        for (i in 0 until 33) {
            a[i * 3] = x
            a[i * 3 + 1] = y
            a[i * 3 + 2] = vis
        }
        return a
    }

    @Test
    fun noDataLeavesOutUntouchedAndReturnsZero() {
        val e = make()
        val out = FloatArray(99) { -7f }
        assertEquals(0f, e.at(100f, 60f, out), 0f)
        assertEquals(-7f, out[0], 0f)
    }

    @Test
    fun firstUpdateGivesTheRawPosition() {
        val e = make()
        e.update(0f, all(0.5f, 0.4f, 0.9f))
        val out = FloatArray(99)
        assertEquals(0f, e.at(500f, 60f, out), 0f)
        assertEquals(0.5f, out[11 * 3], 0f)
        assertEquals(0.4f, out[11 * 3 + 1], 0f)
        assertEquals(0.9f, out[11 * 3 + 2], 0f)
    }

    @Test
    fun zeroHorizonGivesTheRawPosition() {
        val e = make()
        e.update(0f, all(0.5f, 0.5f))
        e.update(100f, all(0.52f, 0.5f))
        val out = FloatArray(99)
        // display time equals capture time with no lead
        e.at(100f, 0f, out)
        assertEquals(0.52f, out[0], 1e-6f)
        // display earlier than capture + lead: the horizon is clamped at 0, never negative
        e.at(150f, 60f, out)
        assertEquals(0.52f, out[0], 1e-6f)
    }

    @Test
    fun movingLandmarksProjectForwardByTheHorizon() {
        val e = make()
        e.update(0f, all(0.5f, 0.5f))
        e.update(100f, all(0.52f, 0.5f))
        val out = FloatArray(99)
        val torso = e.at(200f, 60f, out)
        // raw 0.2 /s smoothed with tau 60 ms over 100 ms: v = 0.2 * (1 - exp(-100/60)) = 0.16222 /s
        // horizon = (200 - 100) - 60 = 40 ms, so the displacement is 0.006489
        assertEquals(0.52f + 0.006489f, out[0], 1e-4f)
        assertEquals(0.5f, out[1], 1e-6f)
        assertEquals(0.006489f, torso, 1e-4f)
        assertEquals(torso, hypot(e.torsoDx, e.torsoDy), 1e-6f)
        assertTrue(e.torsoDx > 0f)
    }

    @Test
    fun leadHorizonIsCappedAtMaxLead() {
        val e = make()
        e.update(0f, all(0.5f, 0.5f))
        e.update(100f, all(0.52f, 0.5f))
        val out = FloatArray(99)
        e.at(10_000f, 60f, out)
        assertEquals(0.52f + 0.162217f * 0.12f, out[0], 1e-4f)
    }

    @Test
    fun displacementNeverExceedsMaxDisp() {
        val e = make()
        e.update(0f, all(0.2f, 0.5f))
        e.update(33f, all(0.7f, 0.5f))
        val out = FloatArray(99)
        val torso = e.at(533f, 0f, out)
        // speed is clamped to 2.5 /s, 2.5 * 0.12 s = 0.3, clamped again to 0.06
        assertEquals(0.76f, out[0], 1e-5f)
        assertEquals(0.06f, torso, 1e-5f)
        for (i in 0 until 33) {
            assertTrue(Math.abs(out[i * 3] - 0.7f) <= 0.06f + 1e-5f)
        }
    }

    @Test
    fun staleAndNonIncreasingTimestampsAreIgnored() {
        val e = make()
        e.update(100f, all(0.5f, 0.5f))
        e.update(100f, all(0.9f, 0.9f))
        e.update(50f, all(0.1f, 0.1f))
        val out = FloatArray(99)
        e.at(100f, 0f, out)
        assertEquals(0.5f, out[0], 1e-6f)
    }

    @Test
    fun aLongGapRestartsVelocityEstimation() {
        val e = make()
        e.update(0f, all(0.5f, 0.5f))
        e.update(100f, all(0.52f, 0.5f))
        e.update(2000f, all(0.6f, 0.5f))
        val out = FloatArray(99)
        e.at(2200f, 0f, out)
        assertEquals(0.6f, out[0], 1e-6f)
    }

    @Test
    fun nonFiniteLandmarksKeepTheirPreviousPosition() {
        val e = make()
        e.update(0f, all(0.5f, 0.5f))
        val next = all(0.52f, 0.5f)
        next[5 * 3] = Float.NaN
        e.update(100f, next)
        val out = FloatArray(99)
        e.at(200f, 0f, out)
        assertEquals(0.5f, out[5 * 3], 1e-6f)
        for (v in out) assertTrue(v.isFinite())
    }

    @Test
    fun shortInputIsIgnored() {
        val e = make()
        e.update(0f, FloatArray(10))
        val out = FloatArray(99) { -1f }
        assertEquals(0f, e.at(10f, 0f, out), 0f)
        assertEquals(-1f, out[0], 0f)
    }
}
