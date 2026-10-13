package app.form.posecamera.core

import java.nio.ByteBuffer

private const val SAMPLES_X = 32
private const val SAMPLES_Y = 24

/**
 * Mean luma (0..255) of an RGBA_8888 frame, sampled on a 32 x 24 grid of pixel centres. Reads with
 * absolute indexing from the buffer's current position, honouring [rowStride] (bytes per row, which
 * can exceed w * 4). Returns 0 for empty or too-short input.
 */
fun meanLumaRgba(buf: ByteBuffer, w: Int, h: Int, rowStride: Int): Float {
    if (w <= 0 || h <= 0 || rowStride < w * 4) return 0f
    val base = buf.position()
    val limit = buf.limit()
    var sum = 0L
    var count = 0
    for (sy in 0 until SAMPLES_Y) {
        val y = ((2 * sy + 1).toLong() * h / (2 * SAMPLES_Y)).toInt()
        for (sx in 0 until SAMPLES_X) {
            val x = ((2 * sx + 1).toLong() * w / (2 * SAMPLES_X)).toInt()
            val i = base + y * rowStride + x * 4
            if (i + 2 >= limit) continue
            val r = buf.get(i).toInt() and 0xFF
            val g = buf.get(i + 1).toInt() and 0xFF
            val b = buf.get(i + 2).toInt() and 0xFF
            sum += (77 * r + 150 * g + 29 * b) shr 8
            count++
        }
    }
    return if (count == 0) 0f else sum.toFloat() / count
}
