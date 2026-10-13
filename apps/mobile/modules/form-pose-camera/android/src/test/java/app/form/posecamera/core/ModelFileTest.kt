package app.form.posecamera.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelFileTest {
    private val zipHead = byteArrayOf(0x50, 0x4B, 0x03, 0x04)

    @Test
    fun aZipBundleOfRealisticSizeIsAccepted() {
        assertTrue(looksLikeTaskBundle(zipHead, 9_000_000L))
        assertTrue(looksLikeTaskBundle(zipHead, 1_000_001L))
    }

    @Test
    fun aSmallFileIsRejectedEvenWithTheRightHeader() {
        assertFalse(looksLikeTaskBundle(zipHead, 1_000_000L))
        assertFalse(looksLikeTaskBundle(zipHead, 500L))
        assertFalse(looksLikeTaskBundle(zipHead, 0L))
    }

    @Test
    fun anErrorPageIsRejected() {
        val html = "<html>".toByteArray(Charsets.US_ASCII)
        assertFalse(looksLikeTaskBundle(html, 9_000_000L))
        val json = "{\"error\"".toByteArray(Charsets.US_ASCII)
        assertFalse(looksLikeTaskBundle(json, 9_000_000L))
    }

    @Test
    fun shortOrEmptyHeadsAreRejected() {
        assertFalse(looksLikeTaskBundle(ByteArray(0), 9_000_000L))
        assertFalse(looksLikeTaskBundle(byteArrayOf(0x50), 9_000_000L))
    }

    @Test
    fun almostPkIsRejected() {
        assertFalse(looksLikeTaskBundle(byteArrayOf(0x50, 0x4C, 0x03, 0x04), 9_000_000L))
        assertFalse(looksLikeTaskBundle(byteArrayOf(0x4B, 0x50, 0x03, 0x04), 9_000_000L))
    }
}
