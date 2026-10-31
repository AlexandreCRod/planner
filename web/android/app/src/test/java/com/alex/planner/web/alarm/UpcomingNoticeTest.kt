package com.alex.planner.web.alarm

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlarmManager
import java.time.LocalDateTime

/**
 * The upcoming-alarm notice (219), on the real scheduler: clock alarms get one, event and task alarms keep
 * theirs, both are set exactly (the inexact one could arrive after the ring), and its buttons work.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class UpcomingNoticeTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val am get() = ctx.getSystemService(AlarmManager::class.java)
    private val nm get() = ctx.getSystemService(NotificationManager::class.java)

    @Before fun setUp() {
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        Mirror.reload(); ClockAlarms.reload()
        Notifications.createChannels(ctx)
    }

    @After fun tearDown() { Mirror.reload(); ClockAlarms.reload() }

    /** A clock alarm ringing [fromNow] minutes from now (every day unless [days] is 0). */
    private fun clockIn(fromNow: Long, days: Int = 127, id: Long = 7L): ClockAlarm {
        val t = LocalDateTime.now().plusMinutes(fromNow)
        return ClockAlarm(id, t.hour, t.minute, label = "Wake up", days = days)
    }

    private fun set(action: String) = shadowOf(am).scheduledAlarms.filter { shadowOf(it.operation).savedIntent.action == action }

    /** The card's lines, without its summary. */
    private fun shown(): List<Notification> = shadowOf(nm).allNotifications.filter { it.flags and Notification.FLAG_GROUP_SUMMARY == 0 }
    private fun titles() = shown().map { it.extras.getString(Notification.EXTRA_TITLE) }

    @Test fun aClockAlarmQueuesItsNoticeTwoHoursBeforeExactly() {
        val a = clockIn(5 * 60)
        ClockAlarms.save(ctx, a)
        val notice = set(AlarmReceiver.ACTION_CLOCK_UPCOMING).single()
        assertEquals(ClockAlarms.nextRingAt(a)!! - 2 * 3_600_000L, notice.triggerAtMs)
        assertEquals(AlarmManager.RTC_WAKEUP, notice.type)
        assertTrue("allowed in Doze", notice.allowWhileIdle)
        assertEquals("exact: no window", 0L, notice.windowLengthMs)
    }

    @Test fun anEventAlarmsNoticeIsExactToo() {
        val t = LocalDateTime.now().plusHours(5)
        val item = Item(1, ItemType.EVENT, "Dentist", startDay = t.toLocalDate().toEpochDay(), startMin = t.hour * 60 + t.minute)
        Mirror.update(ctx) { MirrorData(items = listOf(item), reminders = listOf(Reminder(11, 1, 0, AlertType.ALARM))) }
        AlarmScheduler.rescheduleAll(ctx)
        val notice = set(AlarmReceiver.ACTION_UPCOMING).single()
        assertEquals(AlarmManager.RTC_WAKEUP, notice.type)
        assertEquals(0L, notice.windowLengthMs)
        assertTrue(notice.allowWhileIdle)
    }

    @Test fun inTheLastTwoHoursItComesRightAway() {
        ClockAlarms.save(ctx, clockIn(30))
        assertTrue(set(AlarmReceiver.ACTION_CLOCK_UPCOMING).single().triggerAtMs - System.currentTimeMillis() < 2_000)
    }

    @Test fun theNoticeShowsWithItsButtons() {
        val a = clockIn(30)
        ClockAlarms.save(ctx, a)
        ClockAlarms.notice(ctx, a.id, ClockAlarms.nextRingAt(a)!!)
        assertTrue(titles().single()!!.startsWith("Wake up · "))
        assertEquals(listOf("Skip", "Snooze 10m"), shown().single().actions.map { it.title.toString() })
    }

    @Test fun itShowsOnceAndOnlyWhileItsStillTrue() {
        val a = clockIn(30)
        ClockAlarms.save(ctx, a)
        val at = ClockAlarms.nextRingAt(a)!!
        ClockAlarms.notice(ctx, a.id, at + 60_000) // the alarm moved since this was set
        assertTrue(shown().isEmpty())
        ClockAlarms.notice(ctx, a.id, at)
        nm.cancelAll()
        ClockAlarms.notice(ctx, a.id, at) // swiped away: it doesn't come back
        assertTrue(shown().isEmpty())
    }

    @Test fun switchedOffTheNoticeGoes() {
        val a = clockIn(30)
        ClockAlarms.save(ctx, a)
        ClockAlarms.notice(ctx, a.id, ClockAlarms.nextRingAt(a)!!)
        assertEquals(1, shown().size)
        ClockAlarms.save(ctx, a.copy(enabled = false))
        assertTrue(shown().isEmpty())
        assertTrue(set(AlarmReceiver.ACTION_CLOCK_UPCOMING).isEmpty())
    }

    @Test fun movingTheAlarmTakesBackItsNotice() {
        val a = clockIn(30)
        ClockAlarms.save(ctx, a)
        ClockAlarms.notice(ctx, a.id, ClockAlarms.nextRingAt(a)!!)
        ClockAlarms.save(ctx, clockIn(50))
        assertTrue(shown().isEmpty())
        assertEquals(1, set(AlarmReceiver.ACTION_CLOCK_UPCOMING).size)
    }

    @Test fun theSettingTurnsThemOffButNotTheAlarm() {
        Mirror.update(ctx) { it.copy(settings = AlarmSettings(upcomingAlarms = false)) }
        ClockAlarms.save(ctx, clockIn(5 * 60))
        assertTrue(set(AlarmReceiver.ACTION_CLOCK_UPCOMING).isEmpty())
        assertEquals(1, set(AlarmReceiver.ACTION_CLOCK).size)
    }

    @Test fun clockNoticesDontNeedTheEventRingSwitch() {
        RingDevice.set(ctx, false)
        ClockAlarms.save(ctx, clockIn(5 * 60))
        assertEquals(1, set(AlarmReceiver.ACTION_CLOCK_UPCOMING).size)
        RingDevice.set(ctx, true)
    }

    @Test fun stopSkipsARepeatingAlarmsDayAndItRingsTheNextDay() {
        val a = clockIn(30)
        ClockAlarms.save(ctx, a)
        val at = ClockAlarms.nextRingAt(a)!!
        ClockAlarms.notice(ctx, a.id, at)
        ClockAlarms.skip(ctx, a.id, at)
        val now = ClockAlarms.get(ctx, a.id)!!
        assertTrue(now.enabled)
        assertEquals(listOf(LocalDateTime.now().plusMinutes(30).toLocalDate().toEpochDay()), now.skip)
        assertTrue(ClockAlarms.nextRingAt(now)!! > at)
        assertTrue(shown().isEmpty())
    }

    @Test fun stopSwitchesOffOneThatRingsOnce() {
        val a = clockIn(30, days = 0)
        ClockAlarms.save(ctx, a)
        ClockAlarms.skip(ctx, a.id, ClockAlarms.nextRingAt(a)!!)
        assertFalse(ClockAlarms.get(ctx, a.id)!!.enabled)
    }

    @Test fun snoozingAheadRingsThatMuchLaterAndSkipsTheOriginal() {
        val a = clockIn(60)
        ClockAlarms.save(ctx, a)
        val at = ClockAlarms.nextRingAt(a)!!
        ClockAlarms.snoozeEarly(ctx, a.id, at, 10)
        assertEquals(at + 10 * 60_000L, ClockAlarms.snoozes(ctx)[a.id])
        assertTrue(ClockAlarms.nextRingAt(ClockAlarms.get(ctx, a.id)!!)!! > at)
        // One that rings once: off, and the snooze still rings.
        val once = clockIn(60, days = 0, id = 8)
        ClockAlarms.save(ctx, once)
        ClockAlarms.snoozeEarly(ctx, once.id, ClockAlarms.nextRingAt(once)!!, 10)
        assertFalse(ClockAlarms.get(ctx, 8)!!.enabled)
        assertNotNull(ClockAlarms.snoozes(ctx)[8])
    }

    @Test fun skippingAnOutOfDateTimeLeavesTheAlarmAlone() {
        val a = clockIn(30)
        ClockAlarms.save(ctx, a)
        ClockAlarms.skip(ctx, a.id, ClockAlarms.nextRingAt(a)!! - 86_400_000L)
        assertTrue(ClockAlarms.get(ctx, a.id)!!.skip.isEmpty())
    }
}
