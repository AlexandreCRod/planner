package com.alex.planner.web.alarm

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import java.time.Duration
import java.time.LocalDate

/**
 * Every way to stop a ringing alarm, on the real service (195): Stop, swiping its notification away,
 * the timeout with a missed notice, a volume button, and a snooze that's saved, for an event alarm and a
 * clock alarm; plus a second alarm taking over (194) and the restart after the app was killed.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AlarmServiceTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val today = LocalDate.now().toEpochDay()
    private val event = Item(1, ItemType.EVENT, "Dentist", startDay = today, startMin = 23 * 60 + 59)
    private val task = Item(2, ItemType.TASK, "Bins", startDay = today, startMin = 23 * 60 + 59)
    private val clock = ClockAlarm(77, 7, 0, label = "Wake up")
    private var controller: ServiceController<AlarmService>? = null

    @Before fun setUp() {
        Mirror.reload(); ClockAlarms.reload(); ClockTools.reload()
        Mirror.update(ctx) {
            MirrorData(items = listOf(event, task), reminders = listOf(Reminder(11, 1, 10, AlertType.ALARM), Reminder(12, 2, 0, AlertType.ALARM)))
        }
        ClockAlarms.save(ctx, clock)
        Notifications.createChannels(ctx)
    }

    @After fun tearDown() {
        controller?.destroy()
        Mirror.reload(); ClockAlarms.reload(); ClockTools.reload()
    }

    private fun eventIntent(item: Item = event, reminderId: Long = 11) = Intent(ctx, AlarmService::class.java)
        .putExtra(AlarmReceiver.EXTRA_ITEM, item.id).putExtra(AlarmReceiver.EXTRA_REMINDER, reminderId)
        .putExtra(AlarmReceiver.EXTRA_DAY, today).putExtra(AlarmService.EXTRA_TEXT, "Today at 23:59")

    private fun clockIntent() = Intent(ctx, AlarmService::class.java).putExtra(ClockAlarms.EXTRA_CLOCK, clock.id).putExtra(AlarmService.EXTRA_TEXT, "")

    private fun ring(intent: Intent): AlarmService {
        val c = controller ?: Robolectric.buildService(AlarmService::class.java, intent).create().also { controller = it }
        c.withIntent(intent).startCommand(0, 1)
        return c.get()
    }

    private fun action(a: String, extra: (Intent) -> Intent = { it }) {
        controller!!.withIntent(extra(Intent(ctx, AlarmService::class.java).setAction(a))).startCommand(0, 2)
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun notices(): List<Notification> = shadowOf(ctx.getSystemService(NotificationManager::class.java)).allNotifications
    private fun missed(title: String) = notices().any { it.extras.getString(Notification.EXTRA_TITLE) == "Missed alarm: $title" }

    private fun waitFor(what: String, check: () -> Boolean) {
        val until = System.currentTimeMillis() + 3_000
        while (!check()) {
            if (System.currentTimeMillis() > until) throw AssertionError("timed out: $what")
            Thread.sleep(20)
        }
    }

    @Test fun eventAlarmRingsAndStopStopsIt() {
        val svc = ring(eventIntent())
        assertEquals(1L, AlarmService.ringing?.itemId)
        assertNotNull(shadowOf(svc).lastForegroundNotification)
        assertNotNull(RingState.load(ctx))
        action(AlarmService.ACTION_DISMISS)
        assertNull(AlarmService.ringing)
        assertTrue(shadowOf(svc).isStoppedBySelf)
        assertNull(RingState.load(ctx))
        assertTrue(!missed("Dentist"))
    }

    @Test fun clockAlarmRingsAndStopStopsIt() {
        ring(clockIntent())
        assertEquals(77L, AlarmService.ringing?.clockId)
        action(AlarmService.ACTION_DISMISS)
        assertNull(AlarmService.ringing)
    }

    @Test fun swipingTheNotificationAwayStopsIt() {
        val svc = ring(eventIntent())
        val n = shadowOf(svc).lastForegroundNotification
        assertEquals(AlarmService.ACTION_DISMISS, shadowOf(n.deleteIntent).savedIntent.action)
        controller!!.withIntent(shadowOf(n.deleteIntent).savedIntent).startCommand(0, 3)
        assertNull(AlarmService.ringing)
    }

    /** 295: Android or a phone's shade may refuse a swipe on an ongoing notification. */
    @Test fun theRingingNotificationIsntMarkedOngoing() {
        val n = shadowOf(ring(eventIntent())).lastForegroundNotification
        assertEquals(0, n.flags and Notification.FLAG_ONGOING_EVENT)
        assertNotNull(n.fullScreenIntent)
    }

    /** 295: a swipe whose delete intent never arrived. */
    @Test fun theNotificationGoingStopsItEvenIfTheSwipeWasntDelivered() {
        ring(clockIntent())
        val nm = shadowOf(ctx.getSystemService(NotificationManager::class.java))
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
        assertEquals(77L, AlarmService.ringing?.clockId) // showing: it rings on
        ctx.getSystemService(NotificationManager::class.java).cancelAll()
        assertTrue(nm.allNotifications.isEmpty())
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
        assertEquals(77L, AlarmService.ringing?.clockId) // missing once isn't enough
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
        assertNull(AlarmService.ringing)
        assertTrue(!missed("Wake up"))
    }

    /** With notifications blocked the alarm has no card at all, and must ring all the same. */
    @Test fun aNotificationThatNeverShowedDoesntStopIt() {
        ring(clockIntent())
        ctx.getSystemService(NotificationManager::class.java).cancelAll()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(5))
        assertEquals(77L, AlarmService.ringing?.clockId)
    }

    @Test fun timeoutLeavesAMissedNoticeForAnEventAlarm() {
        ring(eventIntent())
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(1).plusSeconds(1))
        assertNull(AlarmService.ringing)
        assertTrue(missed("Dentist"))
    }

    @Test fun timeoutLeavesAMissedNoticeForAClockAlarm() {
        ring(clockIntent())
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(5))
        assertEquals(77L, AlarmService.ringing?.clockId) // clock alarms ring for 10 minutes
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(5).plusSeconds(1))
        assertNull(AlarmService.ringing)
        assertTrue(missed("Wake up"))
    }

    private fun volumeChange(value: Int, prev: Int) = Intent("android.media.VOLUME_CHANGED_ACTION").setPackage(ctx.packageName)
        .putExtra("android.media.EXTRA_VOLUME_STREAM_TYPE", AudioManager.STREAM_ALARM)
        .putExtra("android.media.EXTRA_VOLUME_STREAM_VALUE", value)
        .putExtra("android.media.EXTRA_PREV_VOLUME_STREAM_VALUE", prev)

    @Test fun aVolumeButtonStopsIt() {
        ring(eventIntent())
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
        ctx.sendBroadcast(volumeChange(4, 5))
        shadowOf(Looper.getMainLooper()).idle()
        assertNull(AlarmService.ringing)
    }

    @Test fun aVolumeChangeInTheFirstMomentsDoesnt() {
        ring(clockIntent())
        ctx.sendBroadcast(volumeChange(4, 5))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(77L, AlarmService.ringing?.clockId)
    }

    @Test fun snoozeIsSavedForAnEventAlarm() {
        ring(eventIntent())
        action(AlarmService.ACTION_SNOOZE)
        assertNull(AlarmService.ringing)
        waitFor("ring snooze saved") { AlarmOverrides.ringSnooze(ctx, 11) != null }
        assertNotNull(Shown.get(ctx, Shown.SNOOZE, 11))
    }

    @Test fun snoozeIsSavedForAClockAlarm() {
        ring(clockIntent())
        action(AlarmService.ACTION_SNOOZE)
        assertNull(AlarmService.ringing)
        waitFor("clock snooze saved") { ClockAlarms.snoozes(ctx)[77] != null }
    }

    @Test fun markDoneTicksATaskButNotAPlainEvent() {
        ring(eventIntent())
        action(AlarmService.ACTION_COMPLETE) { it.putExtra(AlarmReceiver.EXTRA_ITEM, 1L) }
        ring(eventIntent(task, 12))
        action(AlarmService.ACTION_COMPLETE) { it.putExtra(AlarmReceiver.EXTRA_ITEM, 2L) }
        waitFor("task ticked") { Completion(2, today) in Mirror.current(ctx).completions }
        assertTrue(Mirror.current(ctx).completions.none { it.itemId == 1L })
    }

    @Test fun aSecondAlarmTakesOverAndTheFirstIsMissed() {
        ring(eventIntent())
        ring(clockIntent())
        assertEquals(77L, AlarmService.ringing?.clockId)
        assertTrue(missed("Dentist"))
        // A complete from a screen that still showed the event ticks nothing.
        action(AlarmService.ACTION_COMPLETE) { it.putExtra(AlarmReceiver.EXTRA_ITEM, 1L) }
        assertEquals(77L, AlarmService.ringing?.clockId)
    }

    private fun clockIntent(id: Long) = clockIntent().putExtra(ClockAlarms.EXTRA_CLOCK, id)

    /** 244: a series set to ring only as long as a calendar alarm stops after that 1 minute; by default it's 10. */
    @Test fun aSeriesRingsLikeAClockAlarmUnlessToldOtherwise() {
        ClockAlarms.save(ctx, ClockAlarm(78, 7, 10, label = "Long", series = 5))
        ClockAlarms.save(ctx, ClockAlarm(79, 7, 20, label = "Short", series = 6, shortRing = true))
        ring(clockIntent(78))
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(5))
        assertEquals(78L, AlarmService.ringing?.clockId)
        action(AlarmService.ACTION_DISMISS)
        ring(clockIntent(79))
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(1).plusSeconds(1))
        assertNull(AlarmService.ringing)
    }

    /** 244: 07:00 still ringing when 07:05 of the same series comes is one wake-up, not a missed alarm. */
    @Test fun theNextAlarmOfASeriesTakesOverWithoutAMissedNotice() {
        ClockAlarms.save(ctx, ClockAlarm(78, 7, 0, label = "Series", series = 5))
        ClockAlarms.save(ctx, ClockAlarm(79, 7, 5, label = "Series", series = 5))
        ring(clockIntent(78))
        ring(clockIntent(79))
        assertEquals(79L, AlarmService.ringing?.clockId)
        assertTrue(!missed("Series"))
    }

    private fun withWakeUps() = Mirror.update(ctx) { m ->
        m.copy(reminders = m.reminders + listOf(Reminder(13, 1, 120, AlertType.ALARM, wake = true), Reminder(14, 1, 110, AlertType.ALARM, wake = true)))
    }

    /** 245: a plain event alarm stops after 1 minute (timeoutLeavesAMissedNotice...); a wake-up alarm rings on. */
    @Test fun aWakeUpAlarmRingsLikeAClockAlarm() {
        withWakeUps()
        ring(eventIntent(reminderId = 13))
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(5))
        assertEquals(13L, AlarmService.ringing?.reminderId)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(5).plusSeconds(1))
        assertNull(AlarmService.ringing)
        assertTrue(missed("Dentist"))
    }

    @Test fun theNextWakeUpAlarmTakesOverWithoutAMissedNotice() {
        withWakeUps()
        ring(eventIntent(reminderId = 13))
        ring(eventIntent(reminderId = 14))
        assertEquals(14L, AlarmService.ringing?.reminderId)
        assertTrue(!missed("Dentist"))
    }

    @Test fun aPlainAlarmOfTheSameEventTakingOverStillLeavesAMissedNotice() {
        withWakeUps()
        ring(eventIntent(reminderId = 13))
        ring(eventIntent(reminderId = 11))
        assertTrue(missed("Dentist"))
    }

    private fun series(vararg minutes: Int) = minutes.mapIndexed { i, m -> ClockAlarm(200L + i, m / 60, m % 60, label = "Series", days = 127, series = 8) }.onEach { ClockAlarms.save(ctx, it) }
    private val nowMinute get() = java.time.LocalTime.now().let { it.hour * 60 + it.minute }.coerceIn(30, 1400)

    /** 246: the pop-up keeps plain buttons, and says where it sits in the bundle. */
    @Test fun theRingingNotificationHasTheBundleLine() {
        val m = nowMinute
        series(m - 10, m, m + 10)
        val n = shadowOf(ring(clockIntent(201))).lastForegroundNotification
        val text = n.extras.getCharSequence(Notification.EXTRA_TEXT).toString()
        assertTrue(text, text.startsWith("Alarm 2 of 3 · next "))
        assertEquals(listOf("Stop", "Snooze"), n.actions.map { it.title.toString() })
    }

    /** Found on the emulator: the screen wasn't told which wake-up alarm rang, so it showed no bundle. */
    @Test fun theScreenIsToldWhichAlarmAndDay() {
        val n = shadowOf(ring(eventIntent(reminderId = 11))).lastForegroundNotification
        val i = shadowOf(n.fullScreenIntent).savedIntent
        assertEquals(11L, i.getLongExtra(AlarmReceiver.EXTRA_REMINDER, 0))
        assertEquals(today, i.getLongExtra(AlarmReceiver.EXTRA_DAY, 0))
    }

    @Test fun anAlarmOnItsOwnHasNoBundleLine() {
        val n = shadowOf(ring(eventIntent())).lastForegroundNotification
        assertEquals("Today at 23:59", n.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
    }

    /** 246: Stop the rest stops this one, and the rest of the series skip that day, and only that day. */
    @Test fun stopTheRestStopsThisOneAndSkipsTheRest() {
        val m = nowMinute
        val (first, ringing, next, last) = series(m - 20, m, m + 5, m + 10)
        ring(clockIntent(ringing.id))
        action(AlarmService.ACTION_DISMISS_REST)
        assertNull(AlarmService.ringing)
        val today = LocalDate.now().toEpochDay()
        waitFor("the rest skipped") { listOf(next, last).all { today in ClockAlarms.get(ctx, it.id)!!.skip } }
        assertTrue(ClockAlarms.get(ctx, first.id)!!.skip.isEmpty())
        assertTrue(ClockAlarms.get(ctx, next.id)!!.enabled)
    }

    @Test fun stopTheRestSkipsTheOthersOfAnEventsWakeUpAlarms() {
        val soon = LocalDate.now().toEpochDay()
        val m = java.time.LocalTime.now().let { it.hour * 60 + it.minute }
        Mirror.update(ctx) { d ->
            d.copy(items = d.items + Item(5, ItemType.EVENT, "Flight", startDay = soon, startMin = (m + 60).coerceAtMost(1439)),
                reminders = listOf(Reminder(21, 5, 60, AlertType.ALARM, wake = true), Reminder(22, 5, 30, AlertType.ALARM, wake = true), Reminder(23, 5, 15, AlertType.ALARM, wake = true)))
        }
        ring(eventIntent(Mirror.item(ctx, 5)!!, 21))
        action(AlarmService.ACTION_DISMISS_REST)
        val flight = Mirror.item(ctx, 5)!!
        val at = AlarmScheduler.originalAt(flight, LocalDate.now(), 30, 540)
        waitFor("the others stay quiet") { AlarmOverrides.adjusted(ctx, 22, at) == null }
    }

    /** 246: the count needs to tell a one-off that rang from one switched off. */
    @Test fun anAlarmThatRangRemembersIt() {
        val once = ClockAlarm(90, 7, 0)
        ClockAlarms.save(ctx, once)
        ClockAlarms.afterRing(ctx, 90)
        val a = ClockAlarms.get(ctx, 90)!!
        assertTrue(!a.enabled)
        assertTrue(a.rangAt != null)
    }

    @Test fun afterTheAppIsKilledItRingsOnFromWhatWasSaved() {
        ring(eventIntent())
        val saved = RingState.load(ctx)!!
        controller!!.destroy()
        controller = null
        // A new service, as Android restarts a sticky one: no intent.
        val c = Robolectric.buildService(AlarmService::class.java).create().also { controller = it }
        RingState.save(ctx, saved)
        c.get().onStartCommand(null, 0, 1)
        assertEquals(1L, AlarmService.ringing?.itemId)
    }

    @Test fun afterTheAppIsKilledPastItsTimeItsMissed() {
        RingState.save(ctx, RingState.Saved(1, 11, today, 0, 0, 0, "Today", null, System.currentTimeMillis() - 2 * 60_000))
        val c = Robolectric.buildService(AlarmService::class.java).create().also { controller = it }
        c.get().onStartCommand(null, 0, 1)
        assertNull(AlarmService.ringing)
        assertTrue(missed("Dentist"))
        assertNull(RingState.load(ctx))
    }
}
