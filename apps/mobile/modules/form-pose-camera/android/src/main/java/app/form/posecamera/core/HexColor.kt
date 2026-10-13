package app.form.posecamera.core

/** Fallback for unparseable colours: opaque magenta, so a bad palette is obvious on screen. */
private const val FALLBACK_COLOR: Int = (0xFF shl 24) or (0xFF shl 16) or 0xFF

private fun hexDigit(c: Char): Int = when (c) {
    in '0'..'9' -> c - '0'
    in 'a'..'f' -> c - 'a' + 10
    in 'A'..'F' -> c - 'A' + 10
    else -> -1
}

/** '#RRGGBB' to an opaque ARGB int. Anything else (including '#RGB' and '#AARRGGBB') gives magenta. */
fun parseHex(s: String): Int {
    if (s.length != 7 || s[0] != '#') return FALLBACK_COLOR
    var rgb = 0
    for (i in 1 until 7) {
        val d = hexDigit(s[i])
        if (d < 0) return FALLBACK_COLOR
        rgb = (rgb shl 4) or d
    }
    return (0xFF shl 24) or rgb
}
