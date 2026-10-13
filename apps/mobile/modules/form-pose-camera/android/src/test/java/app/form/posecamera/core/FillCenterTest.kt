package app.form.posecamera.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FillCenterTest {
    private val tol = 1e-3f

    /** Rows of fill_center_vectors.csv (shared with the JS test): imgW,imgH,viewW,viewH,mirror,nx,ny,expX,expY. */
    private fun vectors(): List<DoubleArray> {
        val stream = FillCenterTest::class.java.getResourceAsStream("/fill_center_vectors.csv")
        assertNotNull("fill_center_vectors.csv must be on the test classpath", stream)
        return stream!!.bufferedReader().use { reader ->
            reader.readLines()
                .drop(1)
                .filter { it.isNotBlank() }
                .map { line -> line.trim().split(',').map { it.toDouble() }.toDoubleArray() }
        }
    }

    @Test
    fun sharedVectorsMatch() {
        val rows = vectors()
        assertTrue("expected at least the 6 anchor rows plus the table", rows.size >= 100)
        for (r in rows) {
            val fc = FillCenter.of(r[0].toInt(), r[1].toInt(), r[2].toFloat(), r[3].toFloat(), r[4] == 1.0)
            val nx = r[5].toFloat()
            val ny = r[6].toFloat()
            val label = "img ${r[0]}x${r[1]} view ${r[2]}x${r[3]} mirror ${r[4]} at ($nx, $ny)"
            assertEquals("x for $label", r[7].toFloat(), fc.x(nx), tol)
            assertEquals("y for $label", r[8].toFloat(), fc.y(ny), tol)
        }
    }

    @Test
    fun anchorRowsFromTheDesign() {
        val a = FillCenter.of(480, 640, 360f, 800f, true)
        assertEquals(180f, a.x(0.5f), tol)
        assertEquals(400f, a.y(0.5f), tol)
        assertEquals(330f, a.x(0.25f), tol)
        assertEquals(200f, a.y(0.25f), tol)

        val b = FillCenter.of(288, 640, 360f, 800f, true)
        assertEquals(324f, b.x(0.1f), tol)
        assertEquals(720f, b.y(0.9f), tol)

        val c = FillCenter.of(480, 640, 320f, 568f, true)
        assertEquals(373f, c.x(0f), tol)
        assertEquals(0f, c.y(0f), tol)
        assertEquals(-53f, c.x(1f), tol)
        assertEquals(568f, c.y(1f), tol)

        val d = FillCenter.of(640, 480, 360f, 640f, false)
        assertEquals(180f, d.x(0.5f), tol)
        assertEquals(320f, d.y(0.5f), tol)
    }

    @Test
    fun alwaysCoversTheView() {
        val views = listOf(360f to 640f, 412f to 465f, 390f to 844f, 320f to 568f)
        val images = listOf(480 to 640, 640 to 480, 720 to 1280)
        for ((vw, vh) in views) {
            for ((iw, ih) in images) {
                val fc = FillCenter.of(iw, ih, vw, vh, false)
                assertTrue(fc.dw >= vw - tol)
                assertTrue(fc.dh >= vh - tol)
                // centred: the overflow is split evenly
                assertEquals(fc.ox, vw - fc.dw - fc.ox, tol)
                assertEquals(fc.oy, vh - fc.dh - fc.oy, tol)
                // at least one axis fits exactly
                assertTrue(Math.abs(fc.dw - vw) < tol || Math.abs(fc.dh - vh) < tol)
            }
        }
    }

    @Test
    fun mirrorFlipsOnlyX() {
        val plain = FillCenter.of(480, 640, 360f, 800f, false)
        val mirrored = FillCenter.of(480, 640, 360f, 800f, true)
        for (n in listOf(0f, 0.3f, 1f)) {
            assertEquals(360f - plain.x(n), mirrored.x(n), tol)
            assertEquals(plain.y(n), mirrored.y(n), tol)
        }
    }

    @Test
    fun degenerateInputMapsTheUnitSquareToTheView() {
        val fc = FillCenter.of(0, 0, 360f, 640f, false)
        assertEquals(0f, fc.x(0f), tol)
        assertEquals(360f, fc.x(1f), tol)
        assertEquals(640f, fc.y(1f), tol)
        val nan = FillCenter.of(480, 640, Float.NaN, 640f, false)
        assertTrue(nan.x(0.5f).isFinite())
        assertTrue(nan.y(0.5f).isFinite())
    }
}
