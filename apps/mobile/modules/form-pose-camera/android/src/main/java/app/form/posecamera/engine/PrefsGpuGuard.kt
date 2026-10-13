package app.form.posecamera.engine

import android.content.Context
import androidx.core.content.pm.PackageInfoCompat
import app.form.posecamera.core.Prefs

/**
 * SharedPreferences-backed [Prefs] for the GPU crash guard. The "attempt in progress" flag must
 * survive a native crash, so every write is synchronous (commit(), never apply()). Same preference
 * file as the view's own ViewPrefs, so either can be used.
 */
class PrefsGpuGuard(context: Context) : Prefs {
    private val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    override fun getBool(key: String): Boolean = prefs.getBoolean(key, false)

    override fun putBool(key: String, v: Boolean) {
        prefs.edit().putBoolean(key, v).commit()
    }

    private companion object {
        const val FILE = "form_pose_camera"
    }
}

/** The GpuGuard build key: app version name and code, so an app update gets one fresh GPU attempt. */
@Suppress("DEPRECATION")
internal fun gpuBuildKey(context: Context): String = try {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    "${info.versionName}_${PackageInfoCompat.getLongVersionCode(info)}"
} catch (ignored: Throwable) {
    "unknown"
}
