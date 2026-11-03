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

    @Test fun aStopwatchFromBeforeTheListStaysTheFirstAndKeepsRunning() {
        // What an app before 327 saved: one stopwatch, no ids, no others.
        val old = """{"timers":[],"stopwatch":{"startedAt":$t0,"accumulatedMs":2000,"laps":[1000]},"zones":["Europe/Paris"]}"""
        val s = json.decodeFromString(ClockToolsState.serializer(), old)
        val all = ClockTools.stopwatches(s)
        assertEquals(1, all.size)
        assertEquals(0L, all[0].id)
        assertTrue(all[0].running)
        assertEquals(7_000L, all[0].elapsed(t0 + 5_000))
        assertEquals(listOf("Europe/Paris"), s.zones)
        assertEquals(listOf("Stopwatch" to t0 - 2_000), ClockTools.runningStopwatches(s, t0 + 5_000))
    }

    @Test fun stopwatchesRunSideBySide() {
        var s = ClockToolsState()
        s = ClockTools.stopwatchAction(s, "start", 0, "", t0)
        s = ClockTools.stopwatchAction(s, "add", 11, "", t0 + 1_000)
        s = ClockTools.stopwatchAction(s, "add", 12, "Intervals", t0 + 2_000)
        assertEquals(listOf(0L, 11L, 12L), ClockTools.stopwatches(s).map { it.id })
        // Each counts on its own; pausing one leaves the others running.
        s = ClockTools.stopwatchAction(s, "pause", 11, "", t0 + 4_000)
        s = ClockTools.stopwatchAction(s, "lap", 12, "", t0 + 5_000)
        val (main, second, third) = ClockTools.stopwatches(s)
        assertEquals(10_000L, main.elapsed(t0 + 10_000))
        assertEquals(3_000L, second.elapsed(t0 + 10_000))
        assertFalse(second.running)
        assertEquals(listOf(3_000L), third.laps)
        assertEquals(
            listOf("Stopwatch" to t0, "Intervals" to t0 + 2_000),
            ClockTools.runningStopwatches(s, t0 + 10_000),
        )
        // Renamed, reset, removed: only the one asked for; the first can't be removed.
        s = ClockTools.stopwatchAction(s, "rename", 11, "Rest", t0 + 11_000)
        assertEquals("Rest", ClockTools.stopwatches(s)[1].name)
        s = ClockTools.stopwatchAction(s, "reset", 12, "", t0 + 11_000)
        assertEquals(0L, ClockTools.stopwatches(s)[2].elapsed(t0 + 20_000))
        assertTrue(ClockTools.stopwatches(s)[0].running)
        s = ClockTools.stopwatchAction(s, "remove", 11, "", t0 + 12_000)
        s = ClockTools.stopwatchAction(s, "remove", 0, "", t0 + 12_000)
        assertEquals(listOf(0L, 12L), ClockTools.stopwatches(s).map { it.id })
        assertEquals("Intervals", ClockTools.stopwatchLabel(ClockTools.stopwatches(s)[1], 1))
        assertEquals("Stopwatch 2", ClockTools.stopwatchLabel(ClockTools.stopwatches(s)[1].copy(name = " "), 1))
    }

    @Test fun noMoreThanFiveStopwatchesAndNoTwoWithOneId() {
        var s = ClockToolsState()
        for (id in 1L..6L) s = ClockTools.stopwatchAction(s, "add", id, "", t0)
        assertEquals(5, ClockTools.stopwatches(s).size)
        s = ClockTools.stopwatchAction(s, "remove", 4, "", t0)
        s = ClockTools.stopwatchAction(s, "add", 2, "again", t0)
        assertEquals(listOf(0L, 1L, 2L, 3L), ClockTools.stopwatches(s).map { it.id })
        // A saved list reads back the same.
        assertEquals(s, json.decodeFromString(ClockToolsState.serializer(), json.encodeToString(ClockToolsState.serializer(), s)))
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

    @Test fun weatherAppNameFromItsPackage() {
        assertEquals("Deskclock", nameFromPackage("com.google.android.deskclock"))
        assertEquals("Accuweather", nameFromPackage("com.accuweather.android"))
        assertEquals("Weather", nameFromPackage("com.weather.Weather"))
        assertEquals("com.android", nameFromPackage("com.android"))
    }
}
