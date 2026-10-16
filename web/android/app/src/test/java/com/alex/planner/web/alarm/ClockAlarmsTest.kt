package com.alex.planner.web.alarm

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDateTime

class ClockAlarmsTest {
    private val thuMorning = LocalDateTime.of(2026, 10, 15, 8, 0) // a Thursday

    @Test fun onceRingsTodayOrTomorrow() {
        assertEquals(LocalDateTime.of(2026, 10, 15, 9, 30), ClockAlarms.nextRing(ClockAlarm(1, 9, 30), thuMorning))
        assertEquals(LocalDateTime.of(2026, 10, 16, 7, 0), ClockAlarms.nextRing(ClockAlarm(1, 7, 0), thuMorning))
    }

    @Test fun repeatingSkipsToTheNextChosenDay() {
        val weekdays = ClockAlarm(1, 7, 0, days = 0b0011111)
        assertEquals(LocalDateTime.of(2026, 10, 16, 7, 0), ClockAlarms.nextRing(weekdays, thuMorning)) // Friday
        val fridayEvening = LocalDateTime.of(2026, 10, 16, 20, 0)
        assertEquals(LocalDateTime.of(2026, 10, 19, 7, 0), ClockAlarms.nextRing(weekdays, fridayEvening)) // Monday
    }
}
