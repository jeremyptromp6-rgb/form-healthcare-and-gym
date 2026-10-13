package app.form.posecamera.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import androidx.camera.core.ImageProxy
import app.form.posecamera.core.inferSize
import app.form.posecamera.core.uprightSize
import java.nio.Buffer
import java.nio.ByteBuffer
import kotlin.math.min

/**
 * Turns an RGBA_8888 [ImageProxy] into the bitmap the landmarker sees: the crop region, rotated
 * upright (NOT mirrored), scaled so its long edge is at most the infer size. Two bitmaps and one
 * scratch buffer are reused for every frame (no per-frame allocation once sizes are stable).
 *
 * The returned bitmap is only valid until the next [convert] call. MediaPipe copies the pixels
 * synchronously inside detectAsync, so that is enough. All calls come from the analyzer thread;
 * [release] may come from any thread.
 */
internal class FrameConverter {
    private var src: Bitmap? = null
    private var dest: Bitmap? = null
    private var destCanvas: Canvas? = null
    private var scratch: ByteBuffer? = null
    private var released = false
    private val matrix = Matrix()
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)

    /** Size of the visible region (crop, upright) of the last converted frame, before downscaling. */
    @Volatile
    var regionW: Int = 0
        private set

    @Volatile
    var regionH: Int = 0
        private set

    /** Size of the bitmap returned by the last [convert]. */
    @Volatile
    var destW: Int = 0
        private set

    @Volatile
    var destH: Int = 0
        private set

    /** Returns the converted frame, or null when the frame is unusable. */
    @Synchronized
    fun convert(image: ImageProxy, crop: Rect, rotationDegrees: Int, longEdge: Int): Bitmap? {
        if (released) return null
        val w = image.width
        val h = image.height
        if (w <= 0 || h <= 0) return null
        val planes = image.planes
        if (planes.isEmpty()) return null
        val plane = planes[0]
        val stride = plane.rowStride
        val buf = plane.buffer
        if (stride < w * 4) return null

        // The crop in buffer coordinates, clamped; an empty or degenerate crop means the whole frame.
        var l = crop.left.coerceIn(0, w)
        var t = crop.top.coerceIn(0, h)
        var r = crop.right.coerceIn(0, w)
        var b = crop.bottom.coerceIn(0, h)
        if (r - l < 2 || b - t < 2) {
            l = 0
            t = 0
            r = w
            b = h
        }
        val cw = r - l
        val ch = b - t
        val rot = ((rotationDegrees % 360) + 360) % 360
        val (uw, uh) = uprightSize(cw, ch, rot)
        val (dw, dh) = inferSize(uw, uh, longEdge)

        // Source: the whole frame in one reused bitmap (row stride kept, so no row copying is needed
        // for the common stride == width * 4 case).
        val srcW = if (stride % 4 == 0) stride / 4 else w
        val oldSrc = src
        val s: Bitmap = if (oldSrc != null && oldSrc.width == srcW && oldSrc.height == h) {
            oldSrc
        } else {
            oldSrc?.recycle()
            Bitmap.createBitmap(srcW, h, Bitmap.Config.ARGB_8888).also { src = it }
        }
        fillSource(s, buf, w, h, stride, srcW)

        val oldDest = dest
        val d: Bitmap = if (oldDest != null && oldDest.width == dw && oldDest.height == dh) {
            oldDest
        } else {
            // The previous frame's pixels were copied by MediaPipe before this call, so recycling is safe.
            oldDest?.recycle()
            Bitmap.createBitmap(dw, dh, Bitmap.Config.ARGB_8888).also {
                dest = it
                destCanvas = Canvas(it)
            }
        }
        val canvas = destCanvas ?: return null

        // crop centre -> origin, rotate clockwise to upright, scale to dest, origin -> dest centre.
        matrix.reset()
        matrix.postTranslate(-(l + cw / 2f), -(t + ch / 2f))
        matrix.postRotate(rot.toFloat())
        matrix.postScale(dw.toFloat() / uw, dh.toFloat() / uh)
        matrix.postTranslate(dw / 2f, dh / 2f)
        canvas.drawColor(Color.BLACK)
        canvas.drawBitmap(s, matrix, paint)

        regionW = uw
        regionH = uh
        destW = dw
        destH = dh
        return d
    }

    private fun fillSource(bmp: Bitmap, buf: ByteBuffer, w: Int, h: Int, stride: Int, srcW: Int) {
        // Buffer-typed calls on purpose: ByteBuffer.position(int) and friends return ByteBuffer only
        // from newer JDKs/Android versions, and that covariant overload is missing on older devices.
        val bufB: Buffer = buf
        bufB.rewind()
        val need = srcW * 4 * h
        if (stride == srcW * 4 && bufB.remaining() >= need) {
            bmp.copyPixelsFromBuffer(buf)
            return
        }
        // Odd stride, or the last row has no padding: pack the rows into a scratch buffer.
        val existing = scratch
        val sc: ByteBuffer = if (existing != null && existing.capacity() >= need) {
            existing
        } else {
            ByteBuffer.allocateDirect(need).also { scratch = it }
        }
        val scB: Buffer = sc
        scB.clear()
        val dup = buf.duplicate()
        val dupB: Buffer = dup
        val rowBytes = w * 4
        for (row in 0 until h) {
            val start = row * stride
            if (start >= dupB.capacity()) break
            val len = min(rowBytes, dupB.capacity() - start)
            dupB.limit(start + len)
            dupB.position(start)
            scB.position(row * srcW * 4)
            sc.put(dup)
        }
        scB.position(0)
        scB.limit(need)
        bmp.copyPixelsFromBuffer(sc)
    }

    /** Frees the source bitmap. The dest bitmap is left to the GC (it may be mid-handoff to MediaPipe). */
    @Synchronized
    fun release() {
        released = true
        src?.recycle()
        src = null
        scratch = null
    }
}
