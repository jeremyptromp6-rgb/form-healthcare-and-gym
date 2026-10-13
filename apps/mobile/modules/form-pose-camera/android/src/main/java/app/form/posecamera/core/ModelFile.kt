package app.form.posecamera.core

private const val MIN_BUNDLE_BYTES = 1_000_000L

/**
 * A MediaPipe .task bundle is a zip archive: it starts with the 'PK' signature and is far larger
 * than an error page. [head] is the first bytes of the file (at least 2 are needed), [length] the
 * file size. Only the 'PK' pair is checked, not the full local-header signature, so a valid bundle is
 * never rejected for a variant header.
 */
fun looksLikeTaskBundle(head: ByteArray, length: Long): Boolean =
    head.size >= 2 && head[0] == 0x50.toByte() && head[1] == 0x4B.toByte() && length > MIN_BUNDLE_BYTES
