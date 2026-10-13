package app.form.posecamera.core

/** Minimal persistent boolean store (the engine backs it with SharedPreferences.commit()). */
interface Prefs {
    fun getBool(key: String): Boolean
    fun putBool(key: String, v: Boolean)
}

/**
 * Crash guard for the native GPU delegate. A native crash cannot be caught, so an attempt flag is
 * written (and must be persisted synchronously) before any GPU landmarker is created and cleared once
 * its warm-up has succeeded. If a new process finds the flag still set, the previous attempt crashed:
 * the build is marked bad and CPU is used from then on. Flags are keyed by [buildKey] (the app
 * version), so an update gets one fresh GPU attempt.
 */
class GpuGuard(private val prefs: Prefs, private val buildKey: String) {
    private val attemptKey = "gpu_attempt_$buildKey"
    private val badKey = "gpu_bad_$buildKey"

    // An attempt begun by THIS process is in flight, not evidence of a crash.
    private var inFlight = false

    fun gpuAllowed(): Boolean {
        if (prefs.getBool(badKey)) return false
        if (prefs.getBool(attemptKey) && !inFlight) {
            markBad()
            return false
        }
        return true
    }

    fun beginAttempt() {
        inFlight = true
        prefs.putBool(attemptKey, true)
    }

    fun endAttemptOk() {
        inFlight = false
        prefs.putBool(attemptKey, false)
    }

    /** CPU only for this build from now on. */
    fun markBad() {
        inFlight = false
        prefs.putBool(badKey, true)
        prefs.putBool(attemptKey, false)
    }
}
