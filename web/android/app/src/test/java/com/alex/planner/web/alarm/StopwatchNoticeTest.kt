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
        // Reset: their lines go, the notice stays.
        for (id in listOf(0L, 11L, 12L, 13L)) ClockTools.stopwatch(ctx, "reset", id, "")
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

    /**
     * 358: no buttons; the time is its own tap target (pause, go on) in a layout of the app's, and the rest opens the
     * stopwatch. Paused, the line stays (not ongoing, so it can be swiped away) until it goes on or is reset.
     */
    @Test fun theTimePausesAndGoesOnAndThePausedLineStays() {
        ClockTools.stopwatch(ctx, "start", 0, "")
        val n = nm.getNotification(ClockTools.SW_NOTIFICATION)!!
        assertEquals(0, n.actions?.size ?: 0)
        assertEquals("android.app.Notification\$DecoratedCustomViewStyle", n.extras.getString("android.template"))
        assertNotNull(n.contentIntent)
        assertEquals(true, n.flags and android.app.Notification.FLAG_ONGOING_EVENT != 0)
        Thread.sleep(15)
        ClockTools.toggleStopwatch(ctx, 0)
        val sw = ClockTools.stopwatches(ClockTools.current(ctx)).first()
        assertEquals(false, sw.running)
        val paused = nm.getNotification(ClockTools.SW_NOTIFICATION)
        assertNotNull(paused)
        assertEquals(false, paused.flags and android.app.Notification.FLAG_ONGOING_EVENT != 0)
        assertEquals(true, paused.extras.getCharSequence("android.text").toString().startsWith("Paused"))
        ClockTools.toggleStopwatch(ctx, 0)
        assertEquals(true, ClockTools.stopwatches(ClockTools.current(ctx)).first().running)
        assertEquals("Running", nm.getNotification(ClockTools.SW_NOTIFICATION).extras.getCharSequence("android.text").toString())
        // Reset: the line goes.
        ClockTools.stopwatch(ctx, "reset", 0, "")
        assertEquals(null, nm.getNotification(ClockTools.SW_NOTIFICATION))
    }

    /** 358: after a restart nothing remembers a pause, so an old paused stopwatch doesn't come back as a line. */
    @Test fun aPausedStopwatchIsntShownByTheEnginesFirstDraw() {
        val s = ClockToolsState(stopwatch = Stopwatch(accumulatedMs = 65_000))
        assertEquals(emptyList<ClockTools.StopwatchLine>(), ClockTools.stopwatchLines(s, 1_000_000))
        assertEquals(listOf(ClockTools.StopwatchLine(0, "Stopwatch", false, 65_000)), ClockTools.stopwatchLines(s, 1_000_000, paused = setOf(0L)))
        assertEquals(emptyList<ClockTools.StopwatchLine>(), ClockTools.stopwatchLines(s, 1_000_000, hidden = setOf(0L), paused = setOf(0L)))
    }

    /**
     * 358: in the line's own layout, a tap on the count pauses the stopwatch (a second one goes on); the rest of
     * the line opens the stopwatch section without touching it. A paused line swiped away isn't drawn again.
     */
    @Test fun aTapOnTheCountPausesAndTheRestOpensTheStopwatch() {
        ClockTools.stopwatch(ctx, "start", 0, "")
        fun running() = ClockTools.stopwatches(ClockTools.current(ctx)).first().running
        fun tapTheCount() {
            val n = nm.getNotification(ClockTools.SW_NOTIFICATION)!!
            val root = n.contentView.apply(ctx, android.widget.FrameLayout(ctx))
            val time = root.findViewById<android.view.View>(com.alex.planner.web.R.id.sw_time)
            assertEquals(true, time.performClick())
            // The broadcast the tap sent, delivered to the app's receiver as Android does (it works off the main thread).
            val sent = shadowOf(ctx as android.app.Application).broadcastIntents.last()
            assertEquals(AlarmReceiver.ACTION_STOPWATCH_TOGGLE, sent.action)
            val was = running()
            AlarmReceiver().onReceive(ctx, sent)
            val until = System.currentTimeMillis() + 3_000
            while (running() == was && System.currentTimeMillis() < until) Thread.sleep(20)
            Thread.sleep(50)
        }
        tapTheCount()
        assertEquals(false, ClockTools.stopwatches(ClockTools.current(ctx)).first().running)
        tapTheCount()
        assertEquals(true, ClockTools.stopwatches(ClockTools.current(ctx)).first().running)
        // The rest of the line opens the stopwatch section, and the label isn't a target of its own.
        val n = nm.getNotification(ClockTools.SW_NOTIFICATION)!!
        val open = shadowOf(n.contentIntent).savedIntent
        assertEquals("stopwatch", open.getStringExtra(Notifications.EXTRA_OPEN_SECTION))
        val root = n.contentView.apply(ctx, android.widget.FrameLayout(ctx))
        assertEquals(false, root.findViewById<android.view.View>(com.alex.planner.web.R.id.sw_label).hasOnClickListeners())
        // Paused, then swiped away: another stopwatch's change doesn't bring the line back.
        tapTheCount()
        val swiped = shadowOf(nm.getNotification(ClockTools.SW_NOTIFICATION)!!.deleteIntent).savedIntent
        ClockTools.lineDismissed(swiped.getLongExtra(ClockTools.EXTRA_STOPWATCH, -1).also { assertEquals(0L, it) })
        assertEquals(AlarmReceiver.ACTION_STOPWATCH_DISMISS, swiped.action)
        ClockTools.stopwatch(ctx, "add", 11, "Intervals")
        assertEquals("Intervals", title(ClockTools.SW_NOTIFICATION))
        assertEquals(null, nm.getNotification(ClockTools.SW_NOTIFICATION + 1))
    }
}
