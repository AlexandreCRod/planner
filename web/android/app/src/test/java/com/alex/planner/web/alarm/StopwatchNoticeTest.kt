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

    /** Review of 2.10.1, finding 6: a stopwatch deleted on the page stops showing at once; Undo brings it back. */
    @Test fun aDeletedStopwatchsLineGoesAtOnceAndComesBackOnUndo() {
        ClockTools.stopwatch(ctx, "start", 0, "")
        ClockTools.stopwatch(ctx, "add", 11, "Rest")
        val lines = { (0 until ClockTools.MAX_STOPWATCHES).mapNotNull { title(ClockTools.SW_NOTIFICATION + it) } }
        assertEquals(listOf("Stopwatch", "Rest"), lines())
        ClockTools.stopwatch(ctx, "hide", 11, "")
        assertEquals(listOf("Stopwatch"), lines())
        // Still kept (and counting) until the delete is committed, but not shown, even after a reboot's redraw.
        assertEquals(2, ClockTools.stopwatches(ClockTools.current(ctx)).size)
        ClockTools.rescheduleAll(ctx)
        assertEquals(listOf("Stopwatch"), lines())
        ClockTools.stopwatch(ctx, "show", 11, "")
        assertEquals(listOf("Stopwatch", "Rest"), lines())
        // Deleted for good.
        ClockTools.stopwatch(ctx, "hide", 11, "")
        ClockTools.stopwatch(ctx, "remove", 11, "")
        assertEquals(listOf("Stopwatch"), lines())
        assertEquals(1, ClockTools.stopwatches(ClockTools.current(ctx)).size)
    }

    /**
     * 350: the stopwatch didn't show on the user's Xiaomi. Its line now stands on its own (not a child of the
     * card's group, whose summary is redrawn or taken down as the line comes), on its own channel at the default
     * importance (not among the silent ones), and in full on the lock screen.
     */
    @Test fun aRunningStopwatchStandsOnItsOwnLoudEnoughToShowButSilent() {
        ClockTools.stopwatch(ctx, "start", 0, "")
        val n = nm.getNotification(ClockTools.SW_NOTIFICATION)
        assertNotNull(n)
        assertEquals(null, n.group)
        assertEquals(Notifications.CH_STOPWATCH, n.channelId)
        assertEquals(android.app.Notification.VISIBILITY_PUBLIC, n.visibility)
        val ch = ctx.getSystemService(NotificationManager::class.java).getNotificationChannel(Notifications.CH_STOPWATCH)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, ch.importance)
        assertEquals(null, ch.sound)
        assertEquals(android.app.Notification.VISIBILITY_PUBLIC, ch.lockscreenVisibility)
    }

    /** 350: a reset (a long press on the count) hides the line while its Undo stands; reset for good, a new start shows again. */
    @Test fun aResetsHiddenLineShowsAgainOnceItStartsAfresh() {
        ClockTools.stopwatch(ctx, "start", 0, "")
        ClockTools.stopwatch(ctx, "hide", 0, "")
        assertEquals(null, nm.getNotification(ClockTools.SW_NOTIFICATION))
        ClockTools.stopwatch(ctx, "reset", 0, "")
        ClockTools.stopwatch(ctx, "start", 0, "")
        assertEquals("Stopwatch", title(ClockTools.SW_NOTIFICATION))
    }
}
