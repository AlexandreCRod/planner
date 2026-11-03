package com.alex.planner.web.alarm

import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Review of 2.10.1, finding 1: the stopwatches' notification lines took 779000-779004, the numbers of the
 * "Missed alarm" notice of a clock alarm whose id ends in 000-004, so the notice went at boot or on opening the app.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class StopwatchNoticeTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val nm get() = shadowOf(ctx.getSystemService(NotificationManager::class.java))
    private val alarmId = 1_800_000_000_003L

    @Before fun setUp() {
        ClockTools.reload()
        Notifications.createChannels(ctx)
    }

    @After fun tearDown() { ClockTools.reload() }

    private fun missedNotice() {
        Missed.show(ctx, Missed.clockNoticeId(alarmId), "Wake up", "Today at 07:00", Notifications.openSectionIntent(ctx, "alarm", 4))
    }

    private fun title(id: Int) = nm.getNotification(id)?.extras?.getCharSequence("android.title")?.toString()

    @Test fun aMissedNoticeStaysWhenNoStopwatchRuns() {
        missedNotice()
        ClockTools.rescheduleAll(ctx)
        assertEquals("Missed alarm: Wake up", title(Missed.clockNoticeId(alarmId)))
    }

    @Test fun aMissedNoticeStaysBesideRunningStopwatches() {
        missedNotice()
        ClockTools.stopwatch(ctx, "start", 0, "")
        ClockTools.stopwatch(ctx, "add", 11, "Intervals")
        ClockTools.stopwatch(ctx, "add", 12, "")
        ClockTools.stopwatch(ctx, "add", 13, "")
        ClockTools.rescheduleAll(ctx)
        assertEquals("Missed alarm: Wake up", title(Missed.clockNoticeId(alarmId)))
        assertEquals("Stopwatch", title(ClockTools.SW_NOTIFICATION))
        assertEquals("Intervals", title(ClockTools.SW_NOTIFICATION + 1))
        assertNotNull(nm.getNotification(ClockTools.SW_NOTIFICATION + 3))
        // Stopped: their lines go, the notice stays.
        for (id in listOf(0L, 11L, 12L, 13L)) ClockTools.stopwatch(ctx, "pause", id, "")
        assertEquals(null, nm.getNotification(ClockTools.SW_NOTIFICATION))
        assertEquals("Missed alarm: Wake up", title(Missed.clockNoticeId(alarmId)))
    }
}
