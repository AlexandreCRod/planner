package com.alex.planner.web.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

/** Skips and early snoozes are keyed by local day and minute, so a time-zone change keeps them (194). */
class OverrideKeyTest {
    private val lisbon = ZoneId.of("Europe/Lisbon")
    private val newYork = ZoneId.of("America/New_York")
    private fun at(zone: ZoneId) = LocalDateTime.of(2026, 10, 15, 7, 30).atZone(zone).toInstant().toEpochMilli()

    @Test fun sameWallTimeSameKeyInAnyZone() {
        assertEquals(OverrideKey.of(12, at(lisbon), lisbon), OverrideKey.of(12, at(newYork), newYork))
        assertEquals("12@${java.time.LocalDate.of(2026, 10, 15).toEpochDay()}T450", OverrideKey.of(12, at(lisbon), lisbon))
    }

    @Test fun parsesBackToTheTimeInTheCurrentZone() {
        val key = OverrideKey.of(12, at(lisbon), lisbon)
        assertEquals(12L to at(newYork), OverrideKey.parse(key, newYork))
    }

    @Test fun oldKeysAreReadAndUpgraded() {
        val old = "12:${at(lisbon)}"
        assertEquals(12L to at(lisbon), OverrideKey.parse(old, lisbon))
        assertEquals(OverrideKey.of(12, at(lisbon), lisbon), OverrideKey.upgrade(old, lisbon))
        assertNull(OverrideKey.upgrade(OverrideKey.of(12, at(lisbon), lisbon), lisbon))
        assertNull(OverrideKey.parse("keysLocal", lisbon))
    }
}
