package app.form.posecamera.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class LadderTest {
    private fun ladder(gpu: Boolean = true): Ladder = Ladder(LadderConfig(32), gpu)

    private fun assertSwitch(a: LadderAction, rung: Rung, delegate: Delegate) {
        assertTrue("expected Switch but was $a", a is LadderAction.Switch)
        a as LadderAction.Switch
        assertEquals(rung, a.rung)
        assertEquals(delegate, a.delegate)
    }

    private fun assertAccept(a: LadderAction) = assertTrue("expected Accept but was $a", a is LadderAction.Accept)

    private fun assertUseCpu(a: LadderAction) = assertTrue("expected UseCpu but was $a", a is LadderAction.UseCpu)

    // --- config -------------------------------------------------------------------------------

    @Test
    fun budgetsAreDerivedFromTheBase() {
        val cfg = LadderConfig(32)
        assertEquals(45, cfg.maskBudgetMs)
        assertEquals(61, cfg.plainBudgetMs)
        assertEquals(45f, cfg.budgetFor(Rung.FULL_MASK), 0f)
        assertEquals(45f, cfg.budgetFor(Rung.LITE_MASK), 0f)
        assertEquals(61f, cfg.budgetFor(Rung.LITE_CAPSULE), 0f)
        assertTrue(cfg.budgetFor(Rung.LITE_JOINTS) == Float.POSITIVE_INFINITY)
    }

    @Test
    fun rungHelpers() {
        assertTrue(Rung.FULL_MASK.hasMask)
        assertTrue(Rung.LITE_MASK.hasMask)
        assertTrue(!Rung.LITE_CAPSULE.hasMask)
        assertEquals(Rung.LITE_MASK, Rung.FULL_MASK.worse())
        assertEquals(null, Rung.LITE_JOINTS.worse())
        assertEquals(null, Rung.FULL_MASK.better())
        assertEquals(Rung.LITE_CAPSULE, Rung.LITE_JOINTS.better())
    }

    @Test
    fun startsAtTheTopOnGpuWhenAllowed() {
        assertEquals(Rung.FULL_MASK, ladder().rung)
        assertEquals(Delegate.GPU, ladder().delegate)
        assertEquals(Delegate.CPU, ladder(gpu = false).delegate)
    }

    // --- start-up -----------------------------------------------------------------------------

    @Test
    fun withinBudgetIsAccepted() {
        val l = ladder()
        assertAccept(l.startupAction(40f, false, Rung.FULL_MASK, Delegate.GPU, 1_000))
        assertAccept(l.startupAction(45f, false, Rung.FULL_MASK, Delegate.GPU, 1_000))
    }

    @Test
    fun noSampleYetStays() {
        assertSame(LadderAction.Stay, ladder().startupAction(Float.NaN, false, Rung.FULL_MASK, Delegate.GPU, 1_000))
    }

    @Test
    fun overBudgetOnGpuTriesCpuOnceAndKeepsItWhenClearlyFaster() {
        val l = ladder()
        assertUseCpu(l.startupAction(70f, false, Rung.FULL_MASK, Delegate.GPU, 1_000))
        assertEquals(Delegate.CPU, l.delegate)
        // 40 < 0.8 * 70 and within the 45 ms budget
        assertAccept(l.startupAction(40f, false, Rung.FULL_MASK, Delegate.CPU, 2_000))
        assertEquals(Rung.FULL_MASK, l.rung)
        assertEquals(Delegate.CPU, l.delegate)
    }

    @Test
    fun cpuThatIsNotClearlyFasterGoesBackToGpuAndStepsDown() {
        val l = ladder()
        assertUseCpu(l.startupAction(70f, false, Rung.FULL_MASK, Delegate.GPU, 1_000))
        // 65 is not below 0.8 * 70 = 56
        assertSwitch(l.startupAction(65f, false, Rung.FULL_MASK, Delegate.CPU, 2_000), Rung.LITE_MASK, Delegate.GPU)
        assertEquals(Rung.LITE_MASK, l.rung)
        assertEquals(Delegate.GPU, l.delegate)
    }

    @Test
    fun cpuFasterButStillOverBudgetStepsDownOnCpu() {
        val l = ladder()
        assertUseCpu(l.startupAction(100f, false, Rung.FULL_MASK, Delegate.GPU, 1_000))
        assertSwitch(l.startupAction(70f, false, Rung.FULL_MASK, Delegate.CPU, 2_000), Rung.LITE_MASK, Delegate.CPU)
    }

    @Test
    fun theCpuTrialHappensOncePerRung() {
        val l = ladder()
        assertUseCpu(l.startupAction(70f, false, Rung.FULL_MASK, Delegate.GPU, 1_000))
        assertSwitch(l.startupAction(70f, false, Rung.FULL_MASK, Delegate.CPU, 2_000), Rung.LITE_MASK, Delegate.GPU)
        // the next rung gets its own trial
        assertUseCpu(l.startupAction(70f, false, Rung.LITE_MASK, Delegate.GPU, 3_000))
    }

    @Test
    fun withoutGpuOverBudgetStepsDownDirectly() {
        val l = ladder(gpu = false)
        assertSwitch(l.startupAction(70f, false, Rung.FULL_MASK, Delegate.CPU, 1_000), Rung.LITE_MASK, Delegate.CPU)
        assertSwitch(l.startupAction(70f, false, Rung.LITE_MASK, Delegate.CPU, 2_000), Rung.LITE_CAPSULE, Delegate.CPU)
        // capsule budget is 61 ms
        assertAccept(l.startupAction(55f, false, Rung.LITE_CAPSULE, Delegate.CPU, 3_000))
        assertSwitch(l.startupAction(62f, false, Rung.LITE_CAPSULE, Delegate.CPU, 3_000), Rung.LITE_JOINTS, Delegate.CPU)
    }

    @Test
    fun theBottomRungIsAlwaysAccepted() {
        assertAccept(ladder().startupAction(500f, false, Rung.LITE_JOINTS, Delegate.CPU, 1_000))
        assertAccept(ladder().startupAction(500f, false, Rung.LITE_JOINTS, Delegate.GPU, 1_000))
    }

    @Test
    fun blankMaskOnGpuRetriesTheSameRungOnCpu() {
        val l = ladder()
        assertUseCpu(l.startupAction(10f, true, Rung.FULL_MASK, Delegate.GPU, 1_000))
        assertEquals(Rung.FULL_MASK, l.rung)
        assertEquals(Delegate.CPU, l.delegate)
    }

    @Test
    fun blankMaskOnCpuDropsTheMaskRungs() {
        val l = ladder()
        assertSwitch(l.startupAction(10f, true, Rung.FULL_MASK, Delegate.CPU, 1_000), Rung.LITE_CAPSULE, Delegate.CPU)
        // a "blank" flag on a rung without a mask means nothing
        assertAccept(l.startupAction(10f, true, Rung.LITE_CAPSULE, Delegate.CPU, 2_000))
    }

    @Test
    fun theStartupCapAcceptsWhateverIsRunning() {
        assertAccept(ladder().startupAction(500f, false, Rung.FULL_MASK, Delegate.GPU, 8_000))
        assertAccept(ladder().startupAction(Float.NaN, false, Rung.LITE_MASK, Delegate.CPU, 9_000))
        // just under the cap still acts
        assertUseCpu(ladder().startupAction(500f, false, Rung.FULL_MASK, Delegate.GPU, 7_999))
    }

    @Test
    fun aBlankMaskIsStillHandledPastTheCap() {
        assertUseCpu(ladder().startupAction(10f, true, Rung.FULL_MASK, Delegate.GPU, 12_000))
    }

    @Test
    fun aCpuTrialResultPastTheCapRevertsToGpuWhenCpuIsNotBetter() {
        val l = ladder()
        assertUseCpu(l.startupAction(70f, false, Rung.FULL_MASK, Delegate.GPU, 7_900))
        assertSwitch(l.startupAction(75f, false, Rung.FULL_MASK, Delegate.CPU, 9_000), Rung.FULL_MASK, Delegate.GPU)
    }

    // --- in-session governor ------------------------------------------------------------------

    @Test
    fun stepsDownAfterThreeSecondsOverBudget() {
        val l = ladder()
        // 1.25 * 45 = 56.25; a median of 60 is over
        assertSame(LadderAction.Stay, l.onSecond(60f, 30f, 0))
        assertSame(LadderAction.Stay, l.onSecond(60f, 30f, 1_000))
        assertSwitch(l.onSecond(60f, 30f, 2_000), Rung.LITE_MASK, Delegate.GPU)
        assertEquals(Rung.LITE_MASK, l.rung)
        // the counter restarts after a switch
        assertSame(LadderAction.Stay, l.onSecond(60f, 30f, 3_000))
    }

    @Test
    fun aGoodSecondResetsTheOverBudgetCount() {
        val l = ladder()
        val sequence = floatArrayOf(60f, 60f, 40f, 60f, 60f)
        for ((i, m) in sequence.withIndex()) {
            assertSame(LadderAction.Stay, l.onSecond(m, 30f, i * 1_000L))
        }
        assertSwitch(l.onSecond(60f, 30f, 5_000), Rung.LITE_MASK, Delegate.GPU)
    }

    @Test
    fun withinTheGraceBandItStays() {
        val l = ladder()
        // 50 ms is over the 45 ms budget but under 1.25x
        for (s in 0 until 30) assertSame(LadderAction.Stay, l.onSecond(50f, 30f, s * 1_000L))
        assertEquals(Rung.FULL_MASK, l.rung)
    }

    @Test
    fun lowFrameRateAlsoStepsDown() {
        val l = ladder()
        assertSame(LadderAction.Stay, l.onSecond(20f, 10f, 0))
        assertSame(LadderAction.Stay, l.onSecond(20f, 10f, 1_000))
        assertSwitch(l.onSecond(20f, 10f, 2_000), Rung.LITE_MASK, Delegate.GPU)
    }

    @Test
    fun zeroFpsAndMissingMedianDoNotCountAsSlow() {
        val l = ladder()
        for (s in 0 until 10) {
            assertSame(LadderAction.Stay, l.onSecond(Float.NaN, 0f, s * 1_000L))
        }
        assertEquals(Rung.FULL_MASK, l.rung)
    }

    @Test
    fun theBottomRungNeverStepsDown() {
        val l = ladder()
        l.rung = Rung.LITE_JOINTS
        for (s in 0 until 20) assertSame(LadderAction.Stay, l.onSecond(500f, 5f, s * 1_000L))
    }

    @Test
    fun stepDownKeepsTheDelegate() {
        val l = ladder(gpu = false)
        l.onSecond(60f, 30f, 0)
        l.onSecond(60f, 30f, 1_000)
        assertSwitch(l.onSecond(60f, 30f, 2_000), Rung.LITE_MASK, Delegate.CPU)
    }

    @Test
    fun noStepUpBeforeSixtySecondsEvenWhenFast() {
        val l = ladder()
        l.rung = Rung.LITE_JOINTS
        for (s in 0 until 60) {
            assertSame("second $s", LadderAction.Stay, l.onSecond(10f, 30f, s * 1_000L))
        }
        assertSwitch(l.onSecond(10f, 30f, 60_000), Rung.LITE_CAPSULE, Delegate.GPU)
    }

    @Test
    fun noStepUpWithoutTwentyConsecutiveFastSeconds() {
        val l = ladder()
        l.rung = Rung.LITE_JOINTS
        // fast for 19 s, then one ordinary second, repeatedly: never 20 in a row
        for (s in 0..240) {
            val median = if (s % 20 == 19) 30f else 10f
            assertSame("second $s", LadderAction.Stay, l.onSecond(median, 30f, s * 1_000L))
        }
    }

    @Test
    fun medianBetweenHalfAndFullBudgetNeverStepsUp() {
        val l = ladder()
        l.rung = Rung.LITE_CAPSULE
        // 20 ms is not below 0.5 * 32 = 16 ms
        for (s in 0..300) assertSame(LadderAction.Stay, l.onSecond(20f, 30f, s * 1_000L))
    }

    @Test
    fun atMostTwoStepUpsAndTwoMinutesBetweenThem() {
        val l = ladder()
        l.rung = Rung.LITE_JOINTS
        val ups = ArrayList<Pair<Long, Rung>>()
        for (s in 0..600) {
            val a = l.onSecond(10f, 30f, s * 1_000L)
            if (a is LadderAction.Switch) ups.add(Pair(s * 1_000L, a.rung))
        }
        assertEquals(2, ups.size)
        assertEquals(60_000L, ups[0].first)
        assertEquals(Rung.LITE_CAPSULE, ups[0].second)
        assertEquals(180_000L, ups[1].first)
        assertEquals(Rung.LITE_MASK, ups[1].second)
        assertNotNull(l.rung)
        assertEquals(Rung.LITE_MASK, l.rung)
    }

    @Test
    fun aStepDownCountsAsASwitchForTheStepUpGap() {
        val l = ladder()
        // slow for 3 s at the top: step down at t = 2 s
        l.onSecond(60f, 30f, 0)
        l.onSecond(60f, 30f, 1_000)
        assertSwitch(l.onSecond(60f, 30f, 2_000), Rung.LITE_MASK, Delegate.GPU)
        // fast from then on: no step up until 60 s after the switch (t = 62 s)
        var upAt = -1L
        for (s in 3..200) {
            val a = l.onSecond(10f, 30f, s * 1_000L)
            if (a is LadderAction.Switch) {
                upAt = s * 1_000L
                assertEquals(Rung.FULL_MASK, a.rung)
                break
            }
        }
        assertEquals(62_000L, upAt)
    }
}
