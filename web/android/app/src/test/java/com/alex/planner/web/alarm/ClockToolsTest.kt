package com.alex.planner.web.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class ClockToolsTest {
    private val t0 = 1_800_000_000_000L

    @Test fun timerCountsDownPausesAndResumes() {
        val t = ClockTimer(id = 1, durationMs = 5 * 60_000).start(t0)
        assertTrue(t.running)
        assertEquals(t0 + 5 * 60_000, t.endAt)
        assertEquals(3 * 60_000L, t.remaining(t0 + 2 * 60_000))
        val paused = t.pause(t0 + 2 * 60_000)
        assertFalse(paused.running)
        // Paused, time doesn't pass.
        assertEquals(3 * 60_000L, paused.remaining(t0 + 60 * 60_000))
        val resumed = paused.start(t0 + 10 * 60_000)
        assertEquals(t0 + 13 * 60_000, resumed.endAt)
        assertEquals(0L, resumed.remaining(t0 + 20 * 60_000))
        assertEquals(5 * 60_000L, resumed.reset().remaining(t0))
        assertEquals(t0 + 14 * 60_000, resumed.plusMinute().endAt)
    }

    @Test fun stopwatchWorksFromTimestamps() {
        var sw = Stopwatch().start(t0)
        assertEquals(1_500L, sw.elapsed(t0 + 1_500))
        sw = sw.lap(t0 + 1_500)
        sw = sw.pause(t0 + 4_000)
        assertNull(sw.startedAt)
        assertEquals(4_000L, sw.elapsed(t0 + 99_000)) // paused: stays put
        sw = sw.start(t0 + 10_000).lap(t0 + 11_000)
        assertEquals(listOf(1_500L, 5_000L), sw.laps)
        assertEquals(listOf(1_500L, 3_500L), sw.lapLengths())
        // Starting twice doesn't restart it.
        assertEquals(sw, sw.start(t0 + 12_000))
    }

    @Test fun durationsRead() {
        assertEquals("0:05", ClockTools.formatDuration(5_400))
        assertEquals("4:05", ClockTools.formatDuration(245_000))
        assertEquals("1:02:03", ClockTools.formatDuration(3_723_000))
        assertEquals("0:01.27", ClockTools.formatDuration(1_270, hundredths = true))
        assertEquals("0:00", ClockTools.formatDuration(-50))
    }

    @Test fun worldClockOffsets() {
        val winter = Instant.parse("2026-01-15T12:00:00Z")
        val lisbon = ZoneId.of("Europe/Lisbon")
        assertEquals("Same time", ClockTools.offsetLabel(ZoneId.of("Europe/London"), winter, lisbon))
        assertEquals("+1 h", ClockTools.offsetLabel(ZoneId.of("Europe/Paris"), winter, lisbon))
        assertEquals("−5 h", ClockTools.offsetLabel(ZoneId.of("America/New_York"), winter, lisbon))
        assertEquals("+5 h 30 min", ClockTools.offsetLabel(ZoneId.of("Asia/Kolkata"), winter, lisbon))
        val lateEvening = Instant.parse("2026-01-15T22:00:00Z")
        assertEquals("Tomorrow", ClockTools.dayLabel(ZoneId.of("Asia/Tokyo"), lateEvening, lisbon))
        assertNull(ClockTools.dayLabel(ZoneId.of("Europe/Paris"), winter, lisbon))
        assertEquals("New York", ClockTools.cityName("America/New_York"))
    }
}
