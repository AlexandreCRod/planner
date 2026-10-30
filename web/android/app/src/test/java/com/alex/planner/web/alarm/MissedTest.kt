package com.alex.planner.web.alarm

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime

/** What a restart counts as missed (194): set for a time that passed while the phone was off. */
class MissedTest {
    private val now = 1_800_000_000_000L

    @Test fun passedRecentlyIsMissed() {
        assertTrue(Missed.isMissed(now - 60_000, now))
        assertTrue(Missed.isMissed(now, now))
        assertTrue(Missed.isMissed(now - Missed.MAX_AGE_MS, now))
    }

    @Test fun stillAheadOrLongAgoIsNot() {
        assertFalse(Missed.isMissed(now + 1, now))
        assertFalse(Missed.isMissed(now - Missed.MAX_AGE_MS - 1, now))
        assertFalse(Missed.isMissed(0, now))
    }

    @Test fun aMissedOneOffClockAlarmTurnsOffARepeatingOneCarriesOn() {
        val thu = LocalDateTime.of(2026, 10, 15, 8, 0)
        assertTrue(Missed.clockTurnsOff(ClockAlarm(1, 7, 0), thu))
        assertFalse(Missed.clockTurnsOff(ClockAlarm(1, 7, 0, days = 0b0011111), thu))
        // Chosen dates, all past: off too.
        assertTrue(Missed.clockTurnsOff(ClockAlarm(1, 7, 0, dates = listOf(thu.toLocalDate().minusDays(1).toEpochDay())), thu))
    }
}
