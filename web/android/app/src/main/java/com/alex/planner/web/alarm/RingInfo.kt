package com.alex.planner.web.alarm

import android.content.Context
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

// What the ringing screen (AlarmActivity, RingLayouts.kt) and the ringing notification say, apart from
// drawing it: the look chosen, where this alarm sits in its bundle, and the Today card. Nothing here may
// get in the way of stopping an alarm: everything that reads stored data goes through [RingInfo], which
// answers null on any failure, and the screen then shows less.

enum class RingLayout { PLAIN, A, B }
enum class StopBy { SLIDE, HOLD, TAP }

/** The look chosen in Looks to try (254; ringChoices in domain/alarms.ts). */
data class RingLook(val layout: RingLayout, val stop: StopBy, val coming: Boolean, val icons: Int) {
    companion object {
        /** Today's screen with two plain buttons: what anything missing or odd falls back on. */
        val PLAIN = RingLook(RingLayout.PLAIN, StopBy.TAP, coming = false, icons = 1)

        fun of(s: AlarmSettings): RingLook {
            val layout = when (s.ringLayout) { 1 -> RingLayout.A; 2 -> RingLayout.B; else -> return PLAIN }
            val stop = when (s.ringStop) { 1 -> StopBy.SLIDE; 2 -> StopBy.HOLD; 3 -> StopBy.TAP; else -> return PLAIN }
            if (s.ringIcons !in 1..3) return PLAIN
            return RingLook(layout, stop, s.ringComing, s.ringIcons)
        }
    }
}

/** A slide or a hold that doesn't work must leave a plain way to stop: a Stop button comes up. */
object StopBackup {
    /** It shows by itself this long after the screen came up, even if no touch ever reached the track. */
    const val AFTER_MS = 20_000L
    fun shows(elapsedMs: Long, failedTries: Int) = failedTries > 0 || elapsedMs >= AFTER_MS

    /** The slide counts once the knob is this far along. */
    private const val SLIDE_DONE = 0.9f
    fun slideDone(x: Float, max: Float) = max > 0f && x >= max * SLIDE_DONE
}

/** An alarm still to ring in a bundle, for Stop the rest: a clock alarm, or a wake-up alarm's occurrence. */
data class StillToRing(val minute: Int, val clockId: Long = 0, val reminderId: Long = 0, val original: Long = 0)

/** Where a ringing alarm sits among the alarms it rings with: minutes of the day, in order. */
data class RingBundle(
    val times: List<Int>,
    val index: Int,
    val next: Int?,
    val rest: List<StillToRing>,
    /** Tells this bundle from others of the day: which one had the morning's first ring. */
    val key: String,
) {
    /** "Alarm 2 of 4 · next 07:20" */
    val line get() = "Alarm ${index + 1} of ${times.size}" + (next?.let { " · next ${formatTime(it)}" } ?: "")
    /** "07:20, 07:30" */
    val restTimes get() = rest.joinToString(", ") { formatTime(it.minute) }
}

object RingBundles {
    private fun rangOn(a: ClockAlarm, day: LocalDate, zone: ZoneId) =
        a.rangAt?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() == day } == true

    /** The clock alarms [id] rings with today, or null when it rings alone: its series, or its bundle as on the Clock page. */
    fun forClock(all: List<ClockAlarm>, id: Long, window: Int, now: LocalDateTime, zone: ZoneId = ZoneId.systemDefault()): RingBundle? {
        val me = all.firstOrNull { it.id == id } ?: return null
        val day = now.toLocalDate()
        val nowMin = now.hour * 60 + now.minute
        // A one-off that rang switched itself off: it still counts, as one of this morning's. One still on with its time past is tomorrow's.
        val today = all.filter { a ->
            a.id == id || rangOn(a, day, zone) || (a.enabled && if (a.repeating) a.ringsOn(day) else a.minuteOfDay > nowMin)
        }.sortedBy { it.minuteOfDay }
        val group = if (me.series != null) today.filter { it.series == me.series } else {
            val at = day.atStartOfDay(zone).toInstant().toEpochMilli()
            val key = Card.daysKey(me, at, zone)
            val same = today.filter { it.series == null && Card.daysKey(it, at, zone) == key }
            val chains = ArrayList<MutableList<ClockAlarm>>()
            for (a in same) {
                val last = chains.lastOrNull()
                if (last != null && window > 0 && a.minuteOfDay - last.last().minuteOfDay <= window) last += a else chains += mutableListOf(a)
            }
            chains.firstOrNull { c -> c.any { it.id == id } }.orEmpty()
        }
        if (group.size < 2) return null
        val later = group.filter { it.minuteOfDay > nowMin }
        return RingBundle(
            times = group.map { it.minuteOfDay },
            index = group.indexOfFirst { it.id == id },
            next = later.firstOrNull()?.minuteOfDay,
            rest = later.filter { it.enabled && it.id != id }.map { StillToRing(it.minuteOfDay, clockId = it.id) },
            key = me.series?.let { "s$it" } ?: "c${group.first().id}",
        )
    }

    /** An event's wake-up alarms for its occurrence on [day] (245), as they ring now; null if [reminderId] isn't one of several. */
    fun forWakeUp(
        item: Item, reminders: List<Reminder>, reminderId: Long, day: Long, defaultTime: Int, now: Long,
        adjust: (Long, Long) -> Long?, zone: ZoneId = ZoneId.systemDefault(),
    ): RingBundle? {
        val date = day.toDate()
        val wakes = reminders.filter { it.itemId == item.id && it.wake }.sortedByDescending { it.offsetMin }
            .map { it to AlarmScheduler.originalAt(item, date, it.offsetMin, defaultTime, zone) }
            .filter { (r, at) -> r.id == reminderId || adjust(r.id, at) != null }
        if (wakes.size < 2 || wakes.none { it.first.id == reminderId }) return null
        fun minute(at: Long) = Instant.ofEpochMilli(at).atZone(zone).let { it.hour * 60 + it.minute }
        val later = wakes.filter { it.second > now }
        return RingBundle(
            times = wakes.map { minute(it.second) },
            index = wakes.indexOfFirst { it.first.id == reminderId },
            next = later.firstOrNull()?.let { minute(it.second) },
            rest = later.filter { it.first.id != reminderId }.map { (r, at) -> StillToRing(minute(at), reminderId = r.id, original = at) },
            key = "w${item.id}",
        )
    }
}

/** The day's events, and what's left to do, as the page worked them out (domain/agenda.ts). */
@Serializable data class AgendaEvent(val min: Int, val title: String)

@Serializable
data class AgendaDay(val day: Long, val events: List<AgendaEvent> = emptyList(), val routines: Int = 0, val tasks: Int = 0)

/** One line of the Today card: "10:00 Dentist", or "10:30 Tese rings". */
data class TodayRow(val time: String, val title: String, val rings: Boolean)

/** C's card, on the morning's first alarm (246). */
data class TodayCard(val rows: List<TodayRow>, val summary: String?)

object Morning {
    private const val PREFS = "ring-look"
    private const val DAY = "firstDay"
    private const val KEY = "firstKey"

    /** Whether the alarm [key] is the morning's first: the first of the day to ring before noon, or its bundle. */
    fun isFirst(storedDay: Long, storedKey: String?, day: Long, key: String, hour: Int) =
        hour in 3..11 && (storedDay != day || storedKey == key)

    /** [isFirst], remembering the day's first. */
    fun claim(context: Context, key: String, now: LocalDateTime): Boolean {
        val prefs = AlarmStore.prefs(context, PREFS)
        val day = now.toLocalDate().toEpochDay()
        if (!isFirst(prefs.getLong(DAY, -1), prefs.getString(KEY, null), day, key, now.hour)) return false
        prefs.edit().putLong(DAY, day).putString(KEY, key).apply()
        return true
    }

    /**
     * The card for [day]: the first event still to come and the next ring ([rings]: when and what, soonest
     * first), in time order, then what's left to do. Null with nothing to say.
     */
    fun card(agenda: List<AgendaDay>, day: Long, nowMin: Int, rings: List<Pair<Int, String>>): TodayCard? {
        val today = agenda.firstOrNull { it.day == day }
        val event = today?.events?.firstOrNull { it.min > nowMin }
        val ring = rings.firstOrNull { it.first > nowMin }
        val rows = listOfNotNull(event?.let { it.min to TodayRow(formatTime(it.min), it.title, false) }, ring?.let { it.first to TodayRow(formatTime(it.first), it.second, true) })
            .sortedBy { it.first }.map { it.second }
        fun count(n: Int, what: String) = if (n <= 0) null else "$n $what${if (n == 1) "" else "s"}"
        val summary = listOfNotNull(count(today?.routines ?: 0, "routine"), count(today?.tasks ?: 0, "task")).joinToString(", ").ifEmpty { null }
        return if (rows.isEmpty() && summary == null) null else TodayCard(rows, summary)
    }
}

/** What goes on the screen, read from the engine's data. Every answer is null if anything goes wrong. */
object RingInfo {
    fun bundle(context: Context, clockId: Long, reminderId: Long, itemId: Long, day: Long): RingBundle? = runCatching {
        val settings = Mirror.settings(context)
        if (clockId != 0L) return@runCatching RingBundles.forClock(ClockAlarms.all(context), clockId, settings.bundleWindow, LocalDateTime.now())
        if (reminderId == 0L || Mirror.reminder(context, reminderId)?.wake != true) return@runCatching null
        val item = Mirror.item(context, itemId) ?: return@runCatching null
        RingBundles.forWakeUp(item, Mirror.current(context).reminders, reminderId, day, settings.defaultTaskTime, System.currentTimeMillis(), { r, at -> AlarmOverrides.adjusted(context, r, at) })
    }.getOrNull()

    /** The rest of a bundle stays quiet this time: the same as Skip on each one's notice. */
    fun stopRest(context: Context, rest: List<StillToRing>) {
        for (s in rest) runCatching {
            if (s.clockId != 0L) {
                val a = ClockAlarms.get(context, s.clockId) ?: return@runCatching
                ClockAlarms.skip(context, a.id, ClockAlarms.nextRingAt(a) ?: return@runCatching)
            } else {
                val r = Mirror.reminder(context, s.reminderId) ?: return@runCatching
                AlarmOverrides.stop(context, r.id, s.original)
                Notifications.cancelUpcoming(context, r.id)
                Mirror.item(context, r.itemId)?.let { AlarmScheduler.scheduleItem(context, it, listOf(r)) }
            }
        }
    }

    /** What rings later today apart from [bundle] and what's ringing, soonest first: minutes and name. */
    private fun ringsLater(context: Context, clockId: Long, reminderId: Long, bundle: RingBundle?): List<Pair<Int, String>> {
        val m = Mirror.current(context)
        val now = System.currentTimeMillis()
        val zone = ZoneId.systemDefault()
        val out = ArrayList<Pair<Int, String>>()
        if (RingDevice.ringsEvents(context)) {
            val done = m.completions.groupBy({ it.itemId }, { it.day }).mapValues { it.value.toSet() }
            val skip = (bundle?.rest.orEmpty().map { it.reminderId } + reminderId).toSet()
            AlarmScheduler.upcoming(m.items, m.reminders, { id, d -> done[id]?.contains(d) == true }, now, m.settings.defaultTaskTime, { r, o -> AlarmOverrides.adjusted(context, r, o) }, 1)
                .filter { !it.skipped && it.reminderId !in skip }
                .forEach { u -> out += Instant.ofEpochMilli(u.at).atZone(zone).let { it.hour * 60 + it.minute } to u.title.ifBlank { "Untitled" } }
        }
        val mine = (bundle?.rest.orEmpty().map { it.clockId } + clockId).toSet()
        val today = LocalDate.now(zone)
        for (a in ClockAlarms.all(context)) {
            if (!a.enabled || a.id in mine) continue
            val at = ClockAlarms.nextRing(a, LocalDateTime.now(zone)) ?: continue
            if (at.toLocalDate() == today) out += a.minuteOfDay to a.label.trim().ifBlank { "Alarm" }
        }
        return out.sortedBy { it.first }
    }

    /** The Today card, on the morning's first clock or wake-up alarm. */
    fun today(context: Context, clockId: Long, reminderId: Long, bundle: RingBundle?): TodayCard? = runCatching {
        val wake = Mirror.reminder(context, reminderId)?.wake == true
        if (clockId == 0L && !wake) return@runCatching null
        val now = LocalDateTime.now()
        if (!Morning.claim(context, bundle?.key ?: if (clockId != 0L) "c$clockId" else "r$reminderId", now)) return@runCatching null
        Morning.card(Mirror.current(context).agenda, now.toLocalDate().toEpochDay(), now.hour * 60 + now.minute, ringsLater(context, clockId, reminderId, bundle))
    }.getOrNull()

    /** B's line under an event: "Next: Tese rings at 10:30". */
    fun nextLine(context: Context, clockId: Long, reminderId: Long, bundle: RingBundle?): String? = runCatching {
        ringsLater(context, clockId, reminderId, bundle).firstOrNull()?.let { (min, name) -> "Next: $name rings at ${formatTime(min)}" }
    }.getOrNull()

    /** "10:00 – 10:45 · starts in 30 min", for an event or task with a time, today. */
    fun whenLine(item: Item?, day: Long, nowMillis: Long, zone: ZoneId = ZoneId.systemDefault()): String? {
        if (item == null || item.allDay || item.startMin == null) return null
        val date = day.toDate()
        if (date != Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()) return null
        val start = AlarmScheduler.originalAt(item, date, 0, 0, zone)
        val time = formatTime(item.startMin) + (item.endMin?.takeIf { item.type == ItemType.EVENT && item.endDay in listOf(null, item.startDay) }?.let { " – ${formatTime(it)}" } ?: "")
        return if (start > nowMillis) "$time · starts in ${Card.span(start - nowMillis)}" else time
    }
}
