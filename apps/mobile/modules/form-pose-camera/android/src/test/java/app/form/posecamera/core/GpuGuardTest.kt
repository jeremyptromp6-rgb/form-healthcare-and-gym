package app.form.posecamera.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GpuGuardTest {
    private class MemoryPrefs : Prefs {
        val values = HashMap<String, Boolean>()
        override fun getBool(key: String): Boolean = values[key] ?: false
        override fun putBool(key: String, v: Boolean) {
            values[key] = v
        }
    }

    @Test
    fun freshInstallAllowsGpu() {
        assertTrue(GpuGuard(MemoryPrefs(), "1.0").gpuAllowed())
    }

    @Test
    fun anAttemptInFlightInTheSameProcessIsNotACrash() {
        val prefs = MemoryPrefs()
        val g = GpuGuard(prefs, "1.0")
        g.beginAttempt()
        assertTrue(g.gpuAllowed())
        assertTrue(g.gpuAllowed())
    }

    @Test
    fun aSuccessfulAttemptClearsTheFlag() {
        val prefs = MemoryPrefs()
        val g = GpuGuard(prefs, "1.0")
        g.beginAttempt()
        g.endAttemptOk()
        assertTrue(GpuGuard(prefs, "1.0").gpuAllowed())
        assertTrue(g.gpuAllowed())
    }

    @Test
    fun aLeftoverAttemptFlagMeansTheLastRunCrashedSoGpuIsOffForThisBuild() {
        val prefs = MemoryPrefs()
        GpuGuard(prefs, "1.0").beginAttempt()
        // the process "died" here; a new process starts with the same prefs
        val next = GpuGuard(prefs, "1.0")
        assertFalse(next.gpuAllowed())
        // and it stays off, even for later processes
        assertFalse(GpuGuard(prefs, "1.0").gpuAllowed())
        assertFalse(next.gpuAllowed())
    }

    @Test
    fun aNewBuildGetsAFreshAttempt() {
        val prefs = MemoryPrefs()
        GpuGuard(prefs, "1.0").beginAttempt()
        assertFalse(GpuGuard(prefs, "1.0").gpuAllowed())
        assertTrue(GpuGuard(prefs, "1.1").gpuAllowed())
        // a crash flag left by the old build does not block the new one
        val crashedOld = MemoryPrefs()
        GpuGuard(crashedOld, "1.0").beginAttempt()
        assertTrue(GpuGuard(crashedOld, "2.0").gpuAllowed())
    }

    @Test
    fun markBadPersistsAndClearsTheAttempt() {
        val prefs = MemoryPrefs()
        val g = GpuGuard(prefs, "1.0")
        g.beginAttempt()
        g.markBad()
        assertFalse(g.gpuAllowed())
        assertFalse(GpuGuard(prefs, "1.0").gpuAllowed())
        assertFalse(prefs.values["gpu_attempt_1.0"] ?: false)
    }

    @Test
    fun theAttemptFlagIsWrittenBeforeAnythingElse() {
        val prefs = MemoryPrefs()
        val g = GpuGuard(prefs, "1.0")
        g.beginAttempt()
        assertEquals(1, prefs.values.count { it.value })
        g.endAttemptOk()
        assertEquals(0, prefs.values.count { it.value })
    }
}
