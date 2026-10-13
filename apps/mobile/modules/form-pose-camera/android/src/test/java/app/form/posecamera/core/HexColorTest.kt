package app.form.posecamera.core

import org.junit.Assert.assertEquals
import org.junit.Test

class HexColorTest {
    private val magenta = 0xFFFF00FF.toInt()

    @Test
    fun parsesOpaqueColours() {
        assertEquals(0xFF123456.toInt(), parseHex("#123456"))
        assertEquals(0xFFFFFFFF.toInt(), parseHex("#FFFFFF"))
        assertEquals(0xFF000000.toInt(), parseHex("#000000"))
    }

    @Test
    fun isCaseInsensitive() {
        assertEquals(0xFFABCDEF.toInt(), parseHex("#abcdef"))
        assertEquals(0xFFABCDEF.toInt(), parseHex("#AbCdEf"))
    }

    @Test
    fun fallsBackToMagentaOnAnythingElse() {
        assertEquals(magenta, parseHex(""))
        assertEquals(magenta, parseHex("#"))
        assertEquals(magenta, parseHex("123456"))
        assertEquals(magenta, parseHex("#12345"))
        assertEquals(magenta, parseHex("#1234567"))
        assertEquals(magenta, parseHex("#12345G"))
        assertEquals(magenta, parseHex("#+12345"))
        assertEquals(magenta, parseHex("#FFF"))
        assertEquals(magenta, parseHex("#80FF0000"))
        assertEquals(magenta, parseHex("red"))
    }

    @Test
    fun theFallbackIsOpaqueMagenta() {
        assertEquals(255, (magenta ushr 24) and 0xFF)
        assertEquals(255, (magenta shr 16) and 0xFF)
        assertEquals(0, (magenta shr 8) and 0xFF)
        assertEquals(255, magenta and 0xFF)
    }
}
