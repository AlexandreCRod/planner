package com.alex.planner.web.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

class AlarmSchedulerTest {
    private val mon = LocalDate.of(2026, 10, 12)
    private val daily = Item(id = 1, type = ItemType.TASK, title = "Gym", startDay = mon.toEpochDay(), startMin = 9 * 60, freq = Freq.DAILY)
    private val alarm = Reminder(id = 5, itemId = 1, offsetMin = 0, type = AlertType.ALARM)
    private fun millis(d: LocalDate, h: Int, m: Int = 0) = d.atTime(h, m).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

    @Test fun nextAlarmWithoutChanges() {
        val f = AlarmScheduler.nextFire(daily, alarm, LocalDateTime.of(mon, java.time.LocalTime.of(8, 0)), 540, { false })!!
        assertEquals(millis(mon, 9), f.atMillis)
        assertEquals(f.atMillis, f.originalMillis)
    }

    @Test fun stoppedEarlyRingsNextDayInstead() {
        val stopped = millis(mon, 9)
        val f = AlarmScheduler.nextFire(daily, alarm, LocalDateTime.of(mon, java.time.LocalTime.of(8, 0)), 540, { false }) {
            if (it == stopped) null else it
        }!!
        assertEquals(millis(mon.plusDays(1), 9), f.atMillis)
    }

    @Test fun snoozedEarlyStillRingsAfterItsOriginalTime() {
        val original = millis(mon, 9)
        val later = millis(mon, 9, 10)
        val adjust = { t: Long -> if (t == original) later else t }
        // At 9:05 the original time has passed, but the snoozed one hasn't: it must not be skipped.
        val f = AlarmScheduler.nextFire(daily, alarm, LocalDateTime.of(mon, java.time.LocalTime.of(9, 5)), 540, { false }, adjust)!!
        assertEquals(later, f.atMillis)
        assertEquals(original, f.originalMillis)
    }

    @Test fun oneOffStoppedNeverRings() {
        val once = daily.copy(freq = Freq.NONE)
        assertNull(AlarmScheduler.nextFire(once, alarm, LocalDateTime.of(mon, java.time.LocalTime.of(8, 0)), 540, { false }) { null })
    }

    /** Snoozing ahead of time stops 15 minutes before it rings. */
    @Test fun noEarlySnoozeInTheLast15Minutes() {
        val now = 1_000_000_000L
        assertEquals(true, AlarmScheduler.canSnoozeEarly(now + 16 * 60_000L, now))
        assertEquals(false, AlarmScheduler.canSnoozeEarly(now + 15 * 60_000L, now))
        assertEquals(false, AlarmScheduler.canSnoozeEarly(now + 5 * 60_000L, now))
    }
}
