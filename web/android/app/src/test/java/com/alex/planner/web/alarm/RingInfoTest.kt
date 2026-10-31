package com.alex.planner.web.alarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/** What the ringing screen says (246): which look, where the alarm sits in its bundle, the Today card. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RingInfoTest {
    private val zone = ZoneId.of("Europe/Lisbon")
    private val day = LocalDate.of(2026, 11, 4) // a Wednesday
    private val wed = 1 shl 2
    private fun at(h: Int, m: Int = 0) = day.atTime(h, m)
    private fun ms(t: LocalDateTime) = t.atZone(zone).toInstant().toEpochMilli()
    private fun clock(id: Long, h: Int, m: Int, days: Int = wed, enabled: Boolean = true, series: Long? = null, rang: LocalDateTime? = null) =
        ClockAlarm(id, h, m, days = days, enabled = enabled, series = series, rangAt = rang?.let(::ms))
    private fun bundle(all: List<ClockAlarm>, id: Long, now: LocalDateTime, window: Int = 19) = RingBundles.forClock(all, id, window, now, zone)

    // ---- The look ----

    @Test fun theLookComesFromTheSettings() {
        val l = RingLook.of(AlarmSettings(ringLayout = 2, ringStop = 2, ringComing = true, ringIcons = 3))
        assertEquals(RingLook(RingLayout.B, StopBy.HOLD, true, 3), l)
    }

    @Test fun anythingMissingOrOddIsThePlainLayout() {
        assertEquals(RingLook.PLAIN, RingLook.of(AlarmSettings())) // a page that hasn't said yet
        assertEquals(RingLook.PLAIN, RingLook.of(AlarmSettings(ringLayout = 9, ringStop = 1)))
        assertEquals(RingLook.PLAIN, RingLook.of(AlarmSettings(ringLayout = 1, ringStop = 0)))
        assertEquals(RingLook.PLAIN, RingLook.of(AlarmSettings(ringLayout = 1, ringStop = 7)))
        assertEquals(RingLook.PLAIN, RingLook.of(AlarmSettings(ringLayout = 1, ringStop = 1, ringIcons = 0)))
    }

    @Test fun aStoredMirrorWithoutTheLookReadsAsPlain() {
        val old = json.decodeFromString(MirrorData.serializer(), """{"settings":{"snoozeMinutes":5}}""")
        assertEquals(RingLook.PLAIN, RingLook.of(old.settings))
        assertTrue(old.agenda.isEmpty())
    }

    // ---- The backup ----

    @Test fun thePlainStopComesAfterAFailedTryOrAWhile() {
        assertFalse(StopBackup.shows(0, 0))
        assertTrue(StopBackup.shows(0, 1))
        assertFalse(StopBackup.shows(StopBackup.AFTER_MS - 1, 0))
        assertTrue(StopBackup.shows(StopBackup.AFTER_MS, 0))
    }

    @Test fun aSlideOnATrackWithNoWidthNeverCounts() {
        assertFalse(StopBackup.slideDone(0f, 0f))
        assertFalse(StopBackup.slideDone(80f, 100f))
        assertTrue(StopBackup.slideDone(95f, 100f))
    }

    // ---- Clock bundles ----

    @Test fun theMockupsLine() {
        val all = listOf(clock(1, 7, 0), clock(2, 7, 10), clock(3, 7, 20), clock(4, 7, 30))
        val b = bundle(all, 2, at(7, 10))!!
        assertEquals("Alarm 2 of 4 · next 07:20", b.line)
        assertEquals("07:20, 07:30", b.restTimes)
        assertEquals(listOf(3L, 4L), b.rest.map { it.clockId })
    }

    @Test fun theLastOfABundleHasNoNext() {
        val b = bundle(listOf(clock(1, 7, 0), clock(2, 7, 10)), 2, at(7, 10))!!
        assertEquals("Alarm 2 of 2", b.line)
        assertTrue(b.rest.isEmpty())
    }

    @Test fun anAlarmOnItsOwnHasNoBundle() {
        assertNull(bundle(listOf(clock(1, 7, 0), clock(2, 9, 0)), 1, at(7)))
        assertNull(bundle(listOf(clock(1, 7, 0)), 1, at(7)))
    }

    @Test fun onlyTheSameDaysAndTheWindowBundle() {
        val all = listOf(clock(1, 7, 0), clock(2, 7, 10, days = 1), clock(3, 7, 15), clock(4, 8, 0))
        assertEquals("Alarm 1 of 2 · next 07:15", bundle(all, 1, at(7))!!.line)
        assertNull(bundle(all, 1, at(7), window = 0))
    }

    @Test fun oneOffsThatRangThisMorningCountAndThoseSwitchedOffDont() {
        val all = listOf(
            clock(1, 7, 0, days = 0, enabled = false, rang = at(7)),
            clock(2, 7, 5, days = 0, enabled = false), // switched off by hand
            clock(3, 7, 10, days = 0, enabled = false, rang = at(7, 10)), // the one ringing: it has just turned itself off
            clock(4, 7, 20, days = 0),
        )
        assertEquals("Alarm 2 of 3 · next 07:20", bundle(all, 3, at(7, 10))!!.line)
    }

    @Test fun aOneOffStillOnWhoseTimePassedIsTomorrows() {
        val all = listOf(clock(1, 6, 50, days = 0), clock(2, 7, 0, days = 0), clock(3, 7, 10, days = 0))
        assertEquals("Alarm 1 of 2 · next 07:10", bundle(all, 2, at(7))!!.line)
    }

    @Test fun aSkippedAlarmIsNotCounted() {
        val all = listOf(clock(1, 7, 0), clock(2, 7, 10).copy(skip = listOf(day.toEpochDay())), clock(3, 7, 15))
        assertEquals("Alarm 1 of 2 · next 07:15", bundle(all, 1, at(7))!!.line)
    }

    @Test fun aSeriesIsOneBundleHoweverFarApart() {
        val all = listOf(clock(1, 7, 0, series = 9), clock(2, 7, 45, series = 9), clock(3, 7, 30))
        val b = bundle(all, 1, at(7), window = 0)!!
        assertEquals("Alarm 1 of 2 · next 07:45", b.line)
        assertEquals("s9", b.key)
    }

    @Test fun aSnoozedAlarmKeepsItsPlaceAndThePassedOnesArentNext() {
        val all = listOf(clock(1, 7, 0), clock(2, 7, 10), clock(3, 7, 20), clock(4, 7, 30))
        assertEquals("Alarm 1 of 4 · next 07:20", bundle(all, 1, at(7, 15))!!.line)
    }

    // ---- Wake-up alarms ----

    private val flight = Item(1, ItemType.EVENT, "Flight", startDay = day.toEpochDay(), startMin = 9 * 60)
    private val wakes = listOf(Reminder(11, 1, 120, AlertType.ALARM, wake = true), Reminder(12, 1, 110, AlertType.ALARM, wake = true), Reminder(13, 1, 100, AlertType.ALARM, wake = true))
    private val plain = Reminder(14, 1, 30, AlertType.ALARM)

    @Test fun wakeUpAlarmsAreABundle() {
        val b = RingBundles.forWakeUp(flight, wakes + plain, 12, day.toEpochDay(), 540, ms(at(7, 10)), { _, a -> a }, zone)!!
        assertEquals("Alarm 2 of 3 · next 07:20", b.line)
        assertEquals(listOf(13L), b.rest.map { it.reminderId })
        assertEquals(ms(at(7, 20)), b.rest[0].original)
    }

    @Test fun aSkippedWakeUpAlarmIsNotCounted() {
        val b = RingBundles.forWakeUp(flight, wakes, 11, day.toEpochDay(), 540, ms(at(7)), { r, a -> if (r == 12L) null else a }, zone)!!
        assertEquals("Alarm 1 of 2 · next 07:20", b.line)
    }

    @Test fun aPlainAlarmOfTheEventIsNoBundle() {
        assertNull(RingBundles.forWakeUp(flight, wakes + plain, 14, day.toEpochDay(), 540, ms(at(8, 30)), { _, a -> a }, zone))
    }

    // ---- The Today card ----

    @Test fun theMorningsFirstIsTheFirstBundleBeforeNoon() {
        val d = day.toEpochDay()
        assertTrue(Morning.isFirst(-1, null, d, "s1", 7))
        assertTrue(Morning.isFirst(d - 1, "s1", d, "s2", 7))  // yesterday's doesn't count
        assertTrue(Morning.isFirst(d, "s1", d, "s1", 7))      // its next alarm, or its snooze
        assertFalse(Morning.isFirst(d, "s1", d, "c9", 8))     // a later alarm
        assertFalse(Morning.isFirst(-1, null, d, "s1", 14))   // the afternoon
        assertFalse(Morning.isFirst(-1, null, d, "s1", 1))    // the night
    }

    @Test fun theCardShowsWhatsStillToCome() {
        val agenda = listOf(AgendaDay(100, listOf(AgendaEvent(420, "Gone"), AgendaEvent(600, "Dentist"), AgendaEvent(700, "Lunch")), routines = 2, tasks = 3))
        val c = Morning.card(agenda, 100, 430, listOf(630 to "Tese"))!!
        assertEquals(listOf(TodayRow("10:00", "Dentist", false), TodayRow("10:30", "Tese", true)), c.rows)
        assertEquals("2 routines, 3 tasks", c.summary)
    }

    @Test fun theRingComesFirstWhenItDoes() {
        val c = Morning.card(listOf(AgendaDay(100, listOf(AgendaEvent(600, "Dentist")))), 100, 430, listOf(570 to "Dentist alarm"))!!
        assertEquals(listOf("Dentist alarm", "Dentist"), c.rows.map { it.title })
        assertNull(c.summary)
    }

    @Test fun oneOfEachIsSingular() {
        assertEquals("1 routine, 1 task", Morning.card(listOf(AgendaDay(100, routines = 1, tasks = 1)), 100, 430, emptyList())!!.summary)
    }

    @Test fun nothingToSayIsNoCard() {
        assertNull(Morning.card(emptyList(), 100, 430, emptyList()))
        assertNull(Morning.card(listOf(AgendaDay(99, routines = 2)), 100, 430, emptyList())) // another day's
        assertNull(Morning.card(listOf(AgendaDay(100, listOf(AgendaEvent(300, "Over")))), 100, 430, emptyList()))
    }

    // ---- The line under an event ----

    @Test fun theLineUnderAnEvent() {
        val dentist = Item(1, ItemType.EVENT, "Dentist", startDay = day.toEpochDay(), endDay = day.toEpochDay(), startMin = 600, endMin = 645)
        assertEquals("10:00 – 10:45 · starts in 30 min", RingInfo.whenLine(dentist, day.toEpochDay(), ms(at(9, 30)), zone))
        assertEquals("10:00 – 10:45", RingInfo.whenLine(dentist, day.toEpochDay(), ms(at(10, 5)), zone))
        assertNull(RingInfo.whenLine(dentist.copy(allDay = true), day.toEpochDay(), ms(at(9)), zone))
        assertNull(RingInfo.whenLine(dentist, day.toEpochDay(), ms(at(9).minusDays(1)), zone)) // the evening before: the old text says the day
    }
}
