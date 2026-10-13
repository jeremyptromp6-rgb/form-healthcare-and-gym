package app.form.posecamera.core

import org.junit.Assert.assertEquals
import org.junit.Test

class RegionTest {
    @Test
    fun uprightSizeSwapsForQuarterTurns() {
        assertEquals(Pair(640, 480), uprightSize(640, 480, 0))
        assertEquals(Pair(480, 640), uprightSize(640, 480, 90))
        assertEquals(Pair(640, 480), uprightSize(640, 480, 180))
        assertEquals(Pair(480, 640), uprightSize(640, 480, 270))
    }

    @Test
    fun uprightSizeNormalisesTheAngle() {
        assertEquals(Pair(480, 640), uprightSize(640, 480, 450))
        assertEquals(Pair(480, 640), uprightSize(640, 480, -90))
        assertEquals(Pair(640, 480), uprightSize(640, 480, 360))
    }

    @Test
    fun inferSizeDownscalesToTheLongEdge() {
        assertEquals(Pair(360, 480), inferSize(720, 960, 480))
        assertEquals(Pair(480, 270), inferSize(1280, 720, 480))
        assertEquals(Pair(480, 360), inferSize(640, 480, 480))
    }

    @Test
    fun inferSizeNeverScalesUp() {
        assertEquals(Pair(300, 400), inferSize(300, 400, 480))
        assertEquals(Pair(480, 480), inferSize(480, 480, 480))
    }

    @Test
    fun inferSizeKeepsSizesPositive() {
        assertEquals(Pair(1, 480), inferSize(1, 5000, 480))
        assertEquals(Pair(1, 1), inferSize(0, 0, 480))
        assertEquals(Pair(640, 480), inferSize(640, 480, 0))
    }
}
