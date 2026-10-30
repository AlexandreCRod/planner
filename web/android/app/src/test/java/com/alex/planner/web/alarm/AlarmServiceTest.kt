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
