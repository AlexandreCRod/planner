package com.alex.planner.web.alarm

import android.app.AlarmManager
import android.app.Application
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Looper
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config

/**
 * The preview of the ringing screen by real touches (311): each control only closes it, and it never reaches
 * the alarm engine. The engine's own state is what's looked at: services started, alarms armed, what's ringing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w411dp-h891dp")
class RingPreviewTest {
    @get:Rule val rule = createEmptyComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val app get() = shadowOf(ctx as Application)
    private val clock = ClockAlarm(77, 7, 0, label = "Wake up")
    private var preview: ActivityController<RingPreviewActivity>? = null
    private var service: ServiceController<AlarmService>? = null

    @Before fun setUp() {
        rule.mainClock.autoAdvance = false
        Mirror.reload(); ClockAlarms.reload(); ClockTools.reload()
        Notifications.createChannels(ctx)
    }

    @After fun tearDown() {
        shut()
        service?.destroy()
        Mirror.reload(); ClockAlarms.reload(); ClockTools.reload()
    }

    private fun open(layout: Int = 1, stop: Int = 1, coming: Boolean = true) {
        shut()
        preview = Robolectric.buildActivity(RingPreviewActivity::class.java, RingPreviewActivity.intent(ctx, layout, stop, coming, 1)).setup()
        tick()
    }

    private fun shut() {
        preview?.let { if (!it.get().isDestroyed) it.pause().stop().destroy() }
        preview = null
    }

    private fun tick(ms: Long = 100) {
        rule.mainClock.advanceTimeBy(ms)
        rule.waitForIdle()
        shadowOf(Looper.getMainLooper()).idle()
    }

    private val closed get() = preview!!.get().isFinishing

    private fun assertLeftAlone() {
        assertNull("something asked the alarm service to act", app.nextStartedService)
        assertNull(AlarmService.ringing)
        assertNull(RingState.load(ctx))
        assertNull(shadowOf(ctx.getSystemService(AlarmManager::class.java)).peekNextScheduledAlarm())
        assertTrue(shadowOf(ctx.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
    }

    private fun slide() {
        rule.onNodeWithTag("slide").performTouchInput {
            down(center.copy(x = left + 30f))
            for (i in 1..12) moveBy(Offset(width / 12f, 0f))
            up()
        }
        tick(500)
    }

    /** A real alarm ringing, as far as it can be got by the service's own door. */
    private fun ringing() {
        ClockAlarms.save(ctx, clock)
        val i = Intent(ctx, AlarmService::class.java).putExtra(ClockAlarms.EXTRA_CLOCK, clock.id).putExtra(AlarmService.EXTRA_TEXT, "")
        service = Robolectric.buildService(AlarmService::class.java, i).create()
        service!!.withIntent(i).startCommand(0, 1)
    }

    @Test fun snoozeOnlyClosesIt() {
        open()
        rule.onNodeWithText("Snooze · 10 min").performClick()
        tick()
        assertTrue(closed)
        assertLeftAlone()
    }

    @Test fun theSlideOnlyClosesIt() {
        open()
        slide()
        assertTrue(closed)
        assertLeftAlone()
    }

    @Test fun aHoldOnlyClosesIt() {
        open(stop = 2)
        rule.onNodeWithTag("hold").performTouchInput { down(center) }
        tick(1_400)
        assertTrue(closed)
        assertLeftAlone()
    }

    @Test fun layoutBsStopOnlyClosesIt() {
        open(layout = 2, stop = 3)
        rule.onNodeWithTag("stop").performClick()
        tick()
        assertTrue(closed)
        assertLeftAlone()
    }

    @Test fun stopTheRestOnlyClosesIt() {
        open()
        rule.onNodeWithTag("stopRest").performClick()
        tick()
        assertTrue(closed)
        assertLeftAlone()
    }

    @Test fun backClosesIt() {
        open()
        preview!!.get().onBackPressedDispatcher.onBackPressed()
        tick()
        assertTrue(closed)
        assertLeftAlone()
    }

    /** The one that matters: a real alarm goes on ringing whatever is pressed on a preview. */
    @Test fun aPreviewsStopAndSnoozeLeaveARealAlarmRinging() {
        ringing()
        val before = RingState.load(ctx)
        assertNotNull(before)
        app.clearStartedServices()

        open()
        rule.onNodeWithText("Snooze · 10 min").performClick()
        tick()
        open()
        slide()

        assertEquals(77L, AlarmService.ringing?.clockId)
        assertEquals(before, RingState.load(ctx))
        assertNull(app.nextStartedService)
    }

    @Test fun anAlarmFiringDuringAPreviewTakesTheScreen() {
        open()
        assertTrue(RingPreviewActivity.showing)
        while (app.nextStartedActivity != null) Unit // the preview's own start
        ringing()
        assertEquals(77L, AlarmService.ringing?.clockId)
        val shown = app.nextStartedActivity
        assertEquals(AlarmActivity::class.java.name, shown.component?.className)
        assertEquals(77L, shown.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0))
    }

    @Test fun anAlarmRingingOnItsOwnOpensNothingExtra() {
        assertFalse(RingPreviewActivity.showing)
        ringing()
        assertNull(app.nextStartedActivity)
    }

    @Test fun itShowsTheSampleInTheChosenLook() {
        open()
        rule.onNodeWithText("Alarm 2 of 4 · next ${formatTime(440)}").assertExists()
        rule.onNodeWithText("Today").assertExists()
        rule.onNodeWithText("Dentist").assertExists()
        rule.onNodeWithTag("slide").assertExists()
    }

    @Test fun theTodayCardFollowsTheSwitch() {
        open(coming = false)
        rule.onNodeWithText("Alarm 2 of 4 · next ${formatTime(440)}").assertExists()
        rule.onNodeWithText("Today").assertDoesNotExist()
    }

    @Test fun layoutBShowsItsOwnScreen() {
        open(layout = 2, stop = 3)
        rule.onNodeWithText("Alarm 2 of 4").assertExists()
        rule.onNodeWithText("Next at ${formatTime(440)}").assertExists()
    }
}
