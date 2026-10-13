package app.form.posecamera.core

import kotlin.math.abs
import kotlin.math.sqrt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OneEuroTest {
    /** Deterministic noise of about +-0.01. */
    private fun noise(i: Int): Float = (((i * 7919) % 13) - 6) / 600f

    private fun sd(a: List<Float>): Float {
        val m = a.sum() / a.size
        return sqrt(a.sumOf { ((it - m) * (it - m)).toDouble() }.toFloat() / a.size)
    }

    @Test
    fun firstSampleIsPassedThrough() {
        val f = OneEuro(2f, 0.6f, 1f)
        assertEquals(0.37f, f.filter(0.37f, 5f), 0f)
    }

    @Test
    fun steadyInputHasLowerJitterThanRaw() {
        val f = OneEuro(2f, 0.6f, 1f)
        val raw = ArrayList<Float>()
        val filtered = ArrayList<Float>()
        for (i in 0 until 120) {
            val x = 0.5f + noise(i)
            val y = f.filter(x, i / 30f)
            if (i >= 30) {
                raw.add(x)
                filtered.add(y)
            }
        }
        assertTrue("filtered sd ${sd(filtered)} vs raw ${sd(raw)}", sd(filtered) < sd(raw) * 0.5f)
    }

    @Test
    fun followsAStep() {
        val f = OneEuro(2f, 0.6f, 1f)
        f.filter(0.5f, 0f)
        var y = 0f
        for (i in 1..30) y = f.filter(1f, i / 30f)
        assertEquals(1f, y, 0.02f)
    }

    @Test
    fun betaReducesLagOnFastMotion() {
        val adaptive = OneEuro(1f, 20f, 1f)
        val fixed = OneEuro(1f, 0f, 1f)
        var errAdaptive = 0f
        var errFixed = 0f
        for (i in 0 until 60) {
            val t = i / 30f
            val x = 0.5f * t
            val a = adaptive.filter(x, t)
            val b = fixed.filter(x, t)
            if (i == 59) {
                errAdaptive = abs(x - a)
                errFixed = abs(x - b)
            }
        }
        assertTrue("adaptive $errAdaptive vs fixed $errFixed", errAdaptive < errFixed * 0.5f)
    }

    @Test
    fun nonIncreasingTimeAndNonFiniteInputReturnTheLastOutput() {
        val f = OneEuro(2f, 0.6f, 1f)
        f.filter(0.5f, 1f)
        val y = f.filter(0.6f, 1.1f)
        assertEquals(y, f.filter(0.9f, 1.1f), 0f)
        assertEquals(y, f.filter(0.9f, 1.0f), 0f)
        assertEquals(y, f.filter(Float.NaN, 1.2f), 0f)
        assertEquals(y, f.filter(0.7f, Float.NaN), 0f)
    }

    @Test
    fun resetForgetsHistory() {
        val f = OneEuro(2f, 0.6f, 1f)
        f.filter(0.1f, 0f)
        f.filter(0.2f, 0.1f)
        f.reset()
        assertEquals(0.9f, f.filter(0.9f, 0.2f), 0f)
    }

    @Test
    fun nonFiniteInputBeforeAnySampleIsZero() {
        val f = OneEuro(2f, 0.6f, 1f)
        assertEquals(0f, f.filter(Float.NaN, 0f), 0f)
    }
}
