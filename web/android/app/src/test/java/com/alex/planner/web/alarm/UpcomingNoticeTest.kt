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

    /** The snooze queued for clock alarm [id], if any, as AlarmManager holds it. */
    private fun snoozeSet(id: Long) = set(AlarmReceiver.ACTION_CLOCK).firstOrNull {
        val i = shadowOf(it.operation).savedIntent
        i.getBooleanExtra(AlarmReceiver.EXTRA_SNOOZE, false) && i.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0) == id
    }

    /** What a restart does: AlarmManager forgets everything, then the boot receiver sets it all again. */
    private fun restart() {
        shadowOf(am).scheduledAlarms.toList().forEach { am.cancel(it.operation!!) }
        ClockAlarms.reload()
        ClockAlarms.rescheduleAll(ctx)
    }

    @Test fun aOneOffSnoozedFromTheNoticeStillRingsAfterARestart() {
        val once = clockIn(60, days = 0)
        ClockAlarms.save(ctx, once)
        val at = ClockAlarms.nextRingAt(once)!!
        ClockAlarms.snoozeEarly(ctx, once.id, at, 10)
        restart()
        assertEquals(at + 10 * 60_000L, snoozeSet(once.id)?.triggerAtMs)
        assertEquals(at + 10 * 60_000L, ClockAlarms.snoozes(ctx)[once.id])
        // Its next ring stays off: only the snooze comes back.
        assertEquals(1, set(AlarmReceiver.ACTION_CLOCK).size)
    }

    @Test fun aOneOffSnoozedWhileRingingStillRingsAfterARestart() {
        val once = clockIn(60, days = 0)
        ClockAlarms.save(ctx, once)
        ClockAlarms.afterRing(ctx, once.id)
        ClockAlarms.snooze(ctx, once.id, 10)
        val until = ClockAlarms.snoozes(ctx).getValue(once.id)
        restart()
        assertEquals(until, snoozeSet(once.id)?.triggerAtMs)
    }

    @Test fun theSnoozeSurvivesSettingTheAlarmsAgainWithoutARestart() {
        // A time change, an update, or the notice setting changing: AlarmManager still holds the snooze.
        val once = clockIn(60, days = 0)
        ClockAlarms.save(ctx, once)
        val at = ClockAlarms.nextRingAt(once)!!
        ClockAlarms.snoozeEarly(ctx, once.id, at, 10)
        ClockAlarms.rescheduleAll(ctx)
        assertEquals(at + 10 * 60_000L, snoozeSet(once.id)?.triggerAtMs)
    }

    @Test fun anAlarmWhoseDatesHaveAllComeKeepsItsSnoozeToo() {
        val today = LocalDateTime.now().toLocalDate().toEpochDay()
        val t = LocalDateTime.now().minusHours(1)
        val dated = ClockAlarm(9, t.hour, t.minute, dates = listOf(today - 1))
        ClockAlarms.save(ctx, dated)
        ClockAlarms.snooze(ctx, 9, 10)
        restart()
        assertNotNull(snoozeSet(9))
    }

    @Test fun editingASnoozedOneOffThatsOffKeepsTheSnooze() {
        val once = clockIn(60, days = 0)
        ClockAlarms.save(ctx, once)
        ClockAlarms.snoozeEarly(ctx, once.id, ClockAlarms.nextRingAt(once)!!, 10)
        ClockAlarms.save(ctx, ClockAlarms.get(ctx, once.id)!!.copy(label = "Other"))
        assertNotNull(snoozeSet(once.id))
    }

    @Test fun switchingAnAlarmOffStillDropsItsSnooze() {
        val a = clockIn(60)
        ClockAlarms.save(ctx, a)
        ClockAlarms.snooze(ctx, a.id, 10)
        ClockAlarms.save(ctx, a.copy(enabled = false))
        assertEquals(null, snoozeSet(a.id))
        assertTrue(ClockAlarms.snoozes(ctx).isEmpty())
        restart()
        assertEquals(null, snoozeSet(a.id))
    }

    @Test fun deletingAnAlarmDropsItsSnooze() {
        val once = clockIn(60, days = 0)
        ClockAlarms.save(ctx, once)
        ClockAlarms.snoozeEarly(ctx, once.id, ClockAlarms.nextRingAt(once)!!, 10)
        ClockAlarms.delete(ctx, once.id)
        assertEquals(null, snoozeSet(once.id))
        assertTrue(ClockAlarms.snoozes(ctx).isEmpty())
    }

    @Test fun stopTheRestAlsoQuietsTheBundlesSnooze() {
        // A series: the first rang and was snoozed; Stop the rest comes from the second, while it rings.
        val rang = clockIn(-5, id = 1).copy(series = 5)
        val ringing = clockIn(-1, id = 2).copy(series = 5)
        val last = clockIn(10, id = 3).copy(series = 5)
        listOf(rang, ringing, last).forEach { ClockAlarms.save(ctx, it) }
        ClockAlarms.snooze(ctx, 1, 15)
        RingInfo.stopRest(ctx, RingInfo.bundle(ctx, 2, 0, 0, 0))
        assertEquals("the snooze doesn't ring", null, snoozeSet(1))
        assertTrue(ClockAlarms.snoozes(ctx).isEmpty())
        restart()
        assertEquals("nor after a restart", null, snoozeSet(1))
        assertEquals("the last one skips the day", 1, ClockAlarms.get(ctx, 3)!!.skip.size)
    }

    @Test fun stopTheRestQuietsAOneOffSnoozedAheadOfItsTime() {
        val first = clockIn(5, days = 0, id = 1).copy(series = 5)
        val ringing = clockIn(-1, id = 2).copy(series = 5)
        val last = clockIn(10, id = 3).copy(series = 5)
        listOf(first, ringing, last).forEach { ClockAlarms.save(ctx, it) }
        ClockAlarms.snoozeEarly(ctx, 1, ClockAlarms.nextRingAt(first)!!, 10)
        RingInfo.stopRest(ctx, RingInfo.bundle(ctx, 2, 0, 0, 0))
        assertEquals(null, snoozeSet(1))
    }

    @Test fun stopTheRestLeavesAnotherBundlesSnoozeAlone() {
        val a = clockIn(-1, id = 1).copy(series = 5)
        val b = clockIn(10, id = 2).copy(series = 5)
        val other = clockIn(-3, id = 3)
        listOf(a, b, other).forEach { ClockAlarms.save(ctx, it) }
        ClockAlarms.snooze(ctx, 3, 15)
        RingInfo.stopRest(ctx, RingInfo.bundle(ctx, 1, 0, 0, 0))
        assertNotNull(snoozeSet(3))
    }

    @Test fun stopTheRestQuietsASnoozedWakeUpAlarm() {
        val t = LocalDateTime.now().plusHours(1)
        val day = t.toLocalDate().toEpochDay()
        val item = Item(1, ItemType.EVENT, "Flight", startDay = day, startMin = t.hour * 60 + t.minute)
        val (rang, ringing, last) = listOf(70L to 70, 71L to 62, 72L to 50).map { (id, off) -> Reminder(id, 1, off, AlertType.ALARM, wake = true) }
        Mirror.update(ctx) { MirrorData(items = listOf(item), reminders = listOf(rang, ringing, last)) }
        AlarmScheduler.snooze(ctx, item, rang, day, 15, AlarmScheduler.originalAt(item, t.toLocalDate(), 70, 540))
        assertNotNull(AlarmOverrides.ringSnooze(ctx, 70))
        RingInfo.stopRest(ctx, RingInfo.bundle(ctx, 0, 71, 1, day))
        assertEquals(null, AlarmOverrides.ringSnooze(ctx, 70))
    }

    @Test fun skippingAnOutOfDateTimeLeavesTheAlarmAlone() {
        val a = clockIn(30)
        ClockAlarms.save(ctx, a)
        ClockAlarms.skip(ctx, a.id, ClockAlarms.nextRingAt(a)!! - 86_400_000L)
        assertTrue(ClockAlarms.get(ctx, a.id)!!.skip.isEmpty())
    }
}
