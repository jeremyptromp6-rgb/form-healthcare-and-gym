package app.form.posecamera.engine

import android.content.Context
import android.net.Uri
import android.util.Log
import app.form.posecamera.core.looksLikeTaskBundle
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.URL
import java.net.UnknownHostException

/** A model could not be obtained. [offline] is true when the network itself is unreachable. */
internal class ModelException(message: String, val offline: Boolean, cause: Throwable? = null) :
    IOException(message, cause)

/**
 * Model files on disk: filesDir/pose/<name>-<urlhash>.task. A download goes to a ".part" file, is
 * validated and renamed, so a half-written model is never used. Blocking: call from a worker thread.
 */
internal class ModelStore(context: Context) {
    private val dir = File(context.applicationContext.filesDir, "pose")

    /**
     * Returns a valid local copy of [url], downloading it when there is none. [expectedBytes] is
     * only used for progress when the server sends no Content-Length. [onProgress] gets 0..100.
     * [isCancelled] is polled while downloading.
     */
    @Synchronized
    fun ensure(
        url: String,
        expectedBytes: Long,
        isCancelled: () -> Boolean,
        onProgress: (Int) -> Unit,
    ): File {
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
            throw ModelException("Cannot create the model folder", false)
        }
        val target = File(dir, fileName(url))
        if (isValid(target)) {
            onProgress(100)
            return target
        }
        if (target.exists()) target.delete() // bad cache: delete and download once
        download(url, target, expectedBytes, isCancelled, onProgress)
        if (!isValid(target)) {
            target.delete()
            throw ModelException("The downloaded model file is not valid", false)
        }
        onProgress(100)
        return target
    }

    private fun isValid(f: File): Boolean {
        if (!f.isFile) return false
        return try {
            val head = ByteArray(4)
            val n = f.inputStream().use { it.read(head) }
            n >= 2 && looksLikeTaskBundle(head, f.length())
        } catch (ignored: IOException) {
            false
        }
    }

    private fun fileName(url: String): String {
        val last = try {
            Uri.parse(url).lastPathSegment
        } catch (ignored: Throwable) {
            null
        }
        val stem = (last ?: "model").removeSuffix(".task").replace(Regex("[^A-Za-z0-9._-]"), "_").take(48)
        return "$stem-${Integer.toHexString(url.hashCode())}.task"
    }

    /** Deletes part files of [target] that nobody has written to for [STALE_PART_MS] (a killed download). */
    private fun removeStaleParts(target: File) {
        val prefix = target.name + ".part"
        val files = dir.listFiles() ?: return
        val now = System.currentTimeMillis()
        for (f in files) {
            if (f.name.startsWith(prefix) && now - f.lastModified() > STALE_PART_MS) f.delete()
        }
    }

    private fun download(
        url: String,
        target: File,
        expectedBytes: Long,
        isCancelled: () -> Boolean,
        onProgress: (Int) -> Unit,
    ) {
        // A unique name per download: two engines (a quick close and reopen) never write the same file.
        removeStaleParts(target)
        val part = File(dir, target.name + ".part." + System.nanoTime())
        var conn: HttpURLConnection? = null
        var ok = false
        try {
            var current = url
            var redirects = 0
            while (true) {
                val c = URL(current).openConnection() as HttpURLConnection
                conn = c
                c.connectTimeout = CONNECT_TIMEOUT_MS
                c.readTimeout = READ_TIMEOUT_MS
                c.instanceFollowRedirects = false // followed by hand so http -> https works too
                c.setRequestProperty("Accept-Encoding", "identity") // keeps Content-Length truthful
                val code = c.responseCode
                if (code in 300..399 && code != 304) {
                    val loc = c.getHeaderField("Location") ?: throw ModelException("Redirect without a location", false)
                    c.disconnect()
                    if (++redirects > MAX_REDIRECTS) throw ModelException("Too many redirects", false)
                    current = URL(URL(current), loc).toString()
                    continue
                }
                if (code != HttpURLConnection.HTTP_OK) throw ModelException("Model download failed (HTTP $code)", false)
                break
            }
            val c = conn!!
            val declared = c.contentLengthLong
            val total = if (declared > 0) declared else expectedBytes
            var copied = 0L
            var lastPct = -1
            onProgress(0)
            c.inputStream.use { input ->
                FileOutputStream(part).use { out ->
                    val buf = ByteArray(BUFFER_BYTES)
                    while (true) {
                        if (isCancelled()) throw ModelException("Model download cancelled", false)
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        copied += n
                        val pct = if (total > 0) ((copied * 100) / total).toInt().coerceIn(0, 99) else 0
                        if (pct != lastPct) {
                            lastPct = pct
                            onProgress(pct)
                        }
                    }
                    out.flush()
                    out.fd.sync()
                }
            }
            if (declared > 0 && copied != declared) {
                throw ModelException("Model download was cut short ($copied of $declared bytes)", false)
            }
            if (target.exists()) target.delete()
            if (!part.renameTo(target)) throw ModelException("Could not save the model file", false)
            ok = true
        } catch (e: ModelException) {
            throw e
        } catch (e: UnknownHostException) {
            throw ModelException("No internet connection", true, e)
        } catch (e: ConnectException) {
            throw ModelException("No internet connection", true, e)
        } catch (e: NoRouteToHostException) {
            throw ModelException("No internet connection", true, e)
        } catch (e: IOException) {
            throw ModelException("Model download failed: ${e.message ?: e.javaClass.simpleName}", false, e)
        } catch (e: RuntimeException) {
            // e.g. a malformed URL
            throw ModelException("Model download failed: ${e.message ?: e.javaClass.simpleName}", false, e)
        } finally {
            try {
                conn?.disconnect()
            } catch (ignored: Throwable) {
            }
            if (!ok) {
                if (!part.delete() && part.exists()) Log.w(TAG, "could not remove ${part.name}")
            }
        }
    }

    private companion object {
        const val TAG = "FormPoseModel"
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 30_000
        const val MAX_REDIRECTS = 5
        const val BUFFER_BYTES = 64 * 1024
        const val STALE_PART_MS = 5 * 60 * 1000L
    }
}
