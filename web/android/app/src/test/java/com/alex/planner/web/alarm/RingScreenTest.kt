package com.alex.planner.web.alarm

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The ringing screen's layouts by real touches (246): each way to stop works, stops once, and one that fails
 * leaves a plain Stop button. The time runs by hand: the screen's slow animations never let it go idle.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w411dp-h891dp")
class RingScreenTest {
    @get:Rule val rule = createComposeRule()

    private var stops = 0
    private var snoozes = 0
    private var rests = 0

    private val bundle = RingBundle(listOf(420, 430, 440, 450), 1, 440, listOf(StillToRing(440, clockId = 3), StillToRing(450, clockId = 4)), "s1")

    @Before fun setUp() { rule.mainClock.autoAdvance = false }

    private fun show(layout: RingLayout, stop: StopBy, bundle: RingBundle? = null, today: TodayCard? = null) {
        val c = RingContent(RingLook(layout, stop, true, 1), "Wake up", "Sat, 31 Oct", null, "Snooze · 10 min", bundle, today, null)
        val a = RingActions({ stops++ }, { snoozes++ }, null, { rests++ })
        rule.setContent { MaterialTheme(colorScheme = ringColours) { RingScreen(c, a) } }
        tick()
    }

    private fun tick(ms: Long = 100) { rule.mainClock.advanceTimeBy(ms); rule.waitForIdle() }

    private fun slide(tag: String, fraction: Float) {
        rule.onNodeWithTag(tag).performTouchInput {
            down(center.copy(x = left + 30f))
            val steps = 12
            for (i in 1..steps) moveBy(androidx.compose.ui.geometry.Offset(width * fraction / steps, 0f))
            up()
        }
        tick(500)
    }

    @Test fun slidingAllTheWayStopsItOnce() {
        show(RingLayout.A, StopBy.SLIDE)
        slide("slide", 1f)
        assertEquals(1, stops)
    }

    @Test fun aSlideLetGoHalfwayDoesntStopItAndLeavesAPlainStop() {
        show(RingLayout.A, StopBy.SLIDE)
        rule.onNodeWithTag("backupStop").assertDoesNotExist()
        slide("slide", 0.4f)
        assertEquals(0, stops)
        rule.onNodeWithTag("backupStop").assertIsDisplayed().performClick()
        tick()
        assertEquals(1, stops)
    }

    /** Found on the emulator: the backup coming up moved the track, and the next slide missed it. */
    @Test fun theTrackStaysWhereItIsWhenThePlainStopComesUp() {
        show(RingLayout.A, StopBy.SLIDE)
        val before = rule.onNodeWithTag("slide").fetchSemanticsNode().boundsInRoot
        slide("slide", 0.4f)
        rule.onNodeWithTag("backupStop").assertIsDisplayed()
        assertEquals(before, rule.onNodeWithTag("slide").fetchSemanticsNode().boundsInRoot)
        slide("slide", 1f)
        assertEquals(1, stops)
    }

    /** No touch ever arrives on the track: the backup still comes. */
    @Test fun aPlainStopComesUpByItselfAfterAWhile() {
        show(RingLayout.A, StopBy.SLIDE)
        tick(StopBackup.AFTER_MS - 1_000)
        rule.onNodeWithTag("backupStop").assertDoesNotExist()
        tick(1_500)
        rule.onNodeWithTag("backupStop").assertIsDisplayed()
    }

    @Test fun holdingStopsItOnce() {
        show(RingLayout.A, StopBy.HOLD)
        rule.onNodeWithTag("hold").performTouchInput { down(center) }
        tick(1_000)
        assertEquals(0, stops)
        tick(400)
        assertEquals(1, stops)
        rule.onNodeWithTag("hold").performTouchInput { up() }
        tick()
        assertEquals(1, stops)
    }

    @Test fun aShortPressOnHoldDoesntStopItAndLeavesAPlainStop() {
        show(RingLayout.A, StopBy.HOLD)
        rule.onNodeWithTag("hold").performTouchInput { down(center) }
        tick(300)
        rule.onNodeWithTag("hold").performTouchInput { up() }
        tick(2_000)
        assertEquals(0, stops)
        rule.onNodeWithTag("backupStop").performClick()
        tick()
        assertEquals(1, stops)
    }

    @Test fun aTapStopsItInBothLayouts() {
        show(RingLayout.A, StopBy.TAP)
        rule.onNodeWithTag("stop").performClick()
        tick()
        assertEquals(1, stops)
    }

    @Test fun layoutBStopsByATapAndSnoozesByATap() {
        show(RingLayout.B, StopBy.TAP, bundle)
        rule.onNodeWithText("Snooze").performClick()
        tick()
        assertEquals(1, snoozes)
        rule.onNodeWithTag("stop").performClick()
        tick()
        assertEquals(1, stops)
    }

    @Test fun layoutBCanStopBySlideOrHoldToo() {
        show(RingLayout.B, StopBy.SLIDE, bundle)
        slide("slide", 1f)
        assertEquals(1, stops)
    }

    @Test fun layoutBsHoldStops() {
        show(RingLayout.B, StopBy.HOLD, bundle)
        rule.onNodeWithTag("hold").performTouchInput { down(center) }
        tick(1_400)
        assertEquals(1, stops)
    }

    @Test fun layoutBOffersToStopTheRestOfABundle() {
        show(RingLayout.B, StopBy.TAP, bundle)
        rule.onNodeWithText("Stop the rest · 07:20, 07:30").performClick()
        tick()
        assertEquals(1, rests)
        assertEquals(0, stops)
    }

    @Test fun layoutASaysWhereItSitsInTheBundle() {
        show(RingLayout.A, StopBy.SLIDE, bundle)
        rule.onNodeWithText("Alarm 2 of 4 · next 07:20").assertIsDisplayed()
    }

    @Test fun theTodayCardShowsWhenItsGiven() {
        show(RingLayout.A, StopBy.SLIDE, today = TodayCard(listOf(TodayRow("10:00", "Dentist", false), TodayRow("10:30", "Tese", true)), "2 routines, 3 tasks"))
        rule.onNodeWithText("Today").assertIsDisplayed()
        rule.onNodeWithText("Dentist").assertIsDisplayed()
        rule.onNodeWithText("2 routines, 3 tasks").assertIsDisplayed()
    }

    @Test fun thePlainLayoutHasPlainButtons() {
        val c = RingContent(RingLook.PLAIN, "Wake up", "", null, "Snooze", null, null, null)
        rule.setContent { MaterialTheme(colorScheme = ringColours) { RingScreen(c, RingActions({ stops++ }, { snoozes++ }, null, {})) } }
        tick()
        rule.onNodeWithTag("stop").performClick()
        tick()
        assertEquals(1, stops)
    }
}
