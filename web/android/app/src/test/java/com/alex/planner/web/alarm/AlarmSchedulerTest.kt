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

    /** What's out for an occurrence goes once it's ticked, moved, taken out of the series or deleted. */
    @Test fun shownRemindersNoLongerApplyOnceTickedOrMoved() {
        val before = Reminder(id = 6, itemId = 1, offsetMin = 30, type = AlertType.REMINDER)
        val day = mon.toEpochDay()
        val original = millis(mon, 8, 30)
        val zone = ZoneId.systemDefault()
        assertEquals(false, AlarmScheduler.noLongerApplies(daily, before, day, original, emptySet(), 540, zone))
        assertEquals(true, AlarmScheduler.noLongerApplies(daily, before, day, original, setOf(day), 540, zone))          // ticked that day
        assertEquals(false, AlarmScheduler.noLongerApplies(daily, before, day, original, setOf(day + 1), 540, zone))    // another day ticked
        assertEquals(true, AlarmScheduler.noLongerApplies(daily.copy(startMin = 10 * 60), before, day, original, emptySet(), 540, zone)) // moved
        assertEquals(true, AlarmScheduler.noLongerApplies(daily.copy(excludedDays = "$day"), before, day, original, emptySet(), 540, zone))
        assertEquals(true, AlarmScheduler.noLongerApplies(daily.copy(deletedAt = 1L), before, day, original, emptySet(), 540, zone))
        assertEquals(true, AlarmScheduler.noLongerApplies(null, before, day, original, emptySet(), 540, zone))
        // An event isn't ticked; a time not known isn't checked.
        val event = daily.copy(type = ItemType.EVENT)
        assertEquals(false, AlarmScheduler.noLongerApplies(event, before, day, original, setOf(day), 540, zone))
        // An event that's a routine is ticked like a task.
        assertEquals(true, AlarmScheduler.noLongerApplies(event.copy(routine = true), before, day, original, setOf(day), 540, zone))
        assertEquals(false, AlarmScheduler.noLongerApplies(daily.copy(startMin = 10 * 60), before, day, 0L, emptySet(), 540, zone))
    }

    /** At the start, "Starting now" only for a timed, unticked item with nothing of its own ringing then. */
    @Test fun startingNowOnlyWhenNothingRingsAtTheStart() {
        val day = mon.toEpochDay()
        val early = Reminder(id = 6, itemId = 1, offsetMin = 30, type = AlertType.REMINDER)
        assertEquals(true, AlarmScheduler.startingNow(daily, listOf(early), day, emptySet()))
        assertEquals(false, AlarmScheduler.startingNow(daily, listOf(early, alarm), day, emptySet()))   // the alarm rings at the start
        assertEquals(false, AlarmScheduler.startingNow(daily, listOf(early), day, setOf(day)))          // ticked
        assertEquals(false, AlarmScheduler.startingNow(daily.copy(startMin = null), listOf(early), day, emptySet()))
        assertEquals(false, AlarmScheduler.startingNow(daily.copy(allDay = true), listOf(early), day, emptySet()))
        assertEquals(true, AlarmScheduler.startingNow(daily.copy(type = ItemType.EVENT), listOf(early), day, setOf(day)))
        assertEquals(false, AlarmScheduler.startingNow(daily.copy(type = ItemType.EVENT, routine = true), listOf(early), day, setOf(day)))
    }

    /** "10 min after": rings after the start, also for an occurrence that has already begun. */
    @Test fun reminderAfterTheStart() {
        val after = Reminder(id = 7, itemId = 1, offsetMin = -10, type = AlertType.ALARM)
        val f = AlarmScheduler.nextFire(daily, after, LocalDateTime.of(mon, java.time.LocalTime.of(9, 5)), 540, { false })!!
        assertEquals(millis(mon, 9, 10), f.atMillis)
        assertEquals(mon, f.day)
    }

    /** A reminder after the start doesn't stand in for "Starting now"; one right at the start does. */
    @Test fun startingNowWithAReminderAfterTheStart() {
        val day = mon.toEpochDay()
        val before = Reminder(id = 6, itemId = 1, offsetMin = 30, type = AlertType.REMINDER)
        val after = Reminder(id = 7, itemId = 1, offsetMin = -10, type = AlertType.REMINDER)
        assertEquals(true, AlarmScheduler.startingNow(daily, listOf(before, after), day, emptySet()))
        assertEquals(false, AlarmScheduler.startingNow(daily, listOf(before, alarm), day, emptySet()))
    }
}
