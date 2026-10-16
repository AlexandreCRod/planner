package com.alex.planner.web.alarm

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

// The parts of the native app's domain code the alarms use, copied from app/.../domain/Recurrence.kt
// and Format.kt. The web app mirrors the same rules (web/src/domain/recurrence.ts), and all three are
// checked against shared/schedule-cases.json (here by AlarmDomainTest).

const val LAST_DAY_OF_MONTH = 32

fun parseIntList(s: String): List<Int> = s.split(',').mapNotNull { it.trim().toIntOrNull() }
fun parseLongSet(s: String): Set<Long> = s.split(',').mapNotNull { it.trim().toLongOrNull() }.toSet()
fun DayOfWeek.bit(): Int = 1 shl (value - 1)
fun hasWeekDay(mask: Int, d: DayOfWeek) = mask and d.bit() != 0
fun hasMonth(mask: Int, month: Int) = mask and (1 shl (month - 1)) != 0
fun LocalDate.epoch(): Long = toEpochDay()
fun Long.toDate(): LocalDate = LocalDate.ofEpochDay(this)

object Recurrence {
    fun occursOn(item: Item, day: LocalDate): Boolean {
        val start = item.startDay?.toDate() ?: return false
        if (day < start) return false
        if (item.untilDay != null && day.epoch() > item.untilDay) return false
        if (item.freq == Freq.NONE) return day == start
        if (day.epoch() in parseLongSet(item.excludedDays)) return false
        val interval = item.interval.coerceAtLeast(1)
        return when (item.freq) {
            Freq.NONE -> false
            Freq.DAILY -> ChronoUnit.DAYS.between(start, day) % interval == 0L
            Freq.WEEKLY -> {
                val mask = if (item.weekDays == 0) start.dayOfWeek.bit() else item.weekDays
                val weekStart = start.with(DayOfWeek.MONDAY)
                val weeks = ChronoUnit.WEEKS.between(weekStart, day.with(DayOfWeek.MONDAY))
                hasWeekDay(mask, day.dayOfWeek) && weeks % interval == 0L
            }
            Freq.MONTHLY -> {
                val months = ChronoUnit.MONTHS.between(start.withDayOfMonth(1), day.withDayOfMonth(1))
                months % interval == 0L && matchesMonthDay(item, start, day)
            }
            Freq.YEARLY -> {
                val years = day.year - start.year
                val monthMask = if (item.months == 0) 1 shl (start.monthValue - 1) else item.months
                years % interval == 0 && hasMonth(monthMask, day.monthValue) && matchesMonthDay(item, start, day)
            }
        }
    }

    private fun matchesMonthDay(item: Item, start: LocalDate, day: LocalDate): Boolean {
        val days = parseIntList(item.monthDays).ifEmpty { listOf(start.dayOfMonth) }
        val last = day.lengthOfMonth()
        return days.any { d -> if (d == LAST_DAY_OF_MONTH) day.dayOfMonth == last else day.dayOfMonth == d }
    }

    /** All occurrence days in [from, to] inclusive. */
    fun occurrences(item: Item, from: LocalDate, to: LocalDate): List<LocalDate> {
        val start = item.startDay?.toDate() ?: return emptyList()
        if (item.freq == Freq.NONE) return if (start in from..to) listOf(start) else emptyList()
        var d = maxOf(from, start)
        val end = item.untilDay?.let { minOf(to, it.toDate()) } ?: to
        val out = ArrayList<LocalDate>()
        while (d <= end) {
            if (occursOn(item, d)) out += d
            d = d.plusDays(1)
        }
        return out
    }

    /** Next occurrence on or after [from], searching up to ~5 years ahead. */
    fun nextOnOrAfter(item: Item, from: LocalDate): LocalDate? {
        val start = item.startDay?.toDate() ?: return null
        if (item.freq == Freq.NONE) return if (start >= from) start else null
        var d = maxOf(from, start)
        val limit = d.plusYears(5)
        while (d <= limit) {
            if (item.untilDay != null && d.epoch() > item.untilDay) return null
            if (occursOn(item, d)) return d
            d = d.plusDays(1)
        }
        return null
    }
}

/** Follows the clock and date formats chosen in Settings (or the phone's own clock setting). */
object TimeFormat {
    @Volatile var use24h: Boolean = true
    /** 0 written ("Thu, 15 Oct"), 1 DD/MM/YYYY, 2 MM/DD/YYYY, 3 YYYY-MM-DD. */
    @Volatile var dateStyle: Int = 0

    /** [clock]: 0 follow the phone, 1 24-hour, 2 12-hour. */
    fun apply(context: android.content.Context, clock: Int, date: Int) {
        use24h = when (clock) {
            1 -> true
            2 -> false
            else -> android.text.format.DateFormat.is24HourFormat(context)
        }
        dateStyle = date
    }
}

fun DayOfWeek.short(): String = getDisplayName(TextStyle.SHORT, Locale.getDefault())

private val dateFmt = DateTimeFormatter.ofPattern("EEE, d MMM yyyy")
private val dateFmtNoYear = DateTimeFormatter.ofPattern("EEE, d MMM")
private val numericFmts = listOf("dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd").map { DateTimeFormatter.ofPattern(it) }

/** Weekday and date: "Thu, 15 Oct" (year added when it isn't this year) or "Thu, 15/10/2026". */
fun formatDate(d: LocalDate): String {
    val numeric = numericFmts.getOrNull(TimeFormat.dateStyle - 1)
    return when {
        numeric != null -> d.dayOfWeek.short() + ", " + d.format(numeric)
        d.year == LocalDate.now().year -> d.format(dateFmtNoYear)
        else -> d.format(dateFmt)
    }
}

fun formatTime(minOfDay: Int): String {
    val h = minOfDay / 60
    val m = minOfDay % 60
    return if (TimeFormat.use24h) "%02d:%02d".format(h, m)
    else {
        val h12 = if (h % 12 == 0) 12 else h % 12
        if (m == 0) "$h12 ${if (h < 12) "AM" else "PM"}" else "%d:%02d %s".format(h12, m, if (h < 12) "AM" else "PM")
    }
}

fun relativeDayLabel(d: LocalDate, today: LocalDate = LocalDate.now()): String = when (d) {
    today -> "Today"
    today.plusDays(1) -> "Tomorrow"
    today.minusDays(1) -> "Yesterday"
    else -> formatDate(d)
}

fun offsetLabel(min: Int): String = when {
    min == 0 -> "At time"
    min % (60 * 24 * 7) == 0 -> "${min / (60 * 24 * 7)} week(s) before"
    min % (60 * 24) == 0 -> "${min / (60 * 24)} day(s) before"
    min % 60 == 0 -> "${min / 60} hour(s) before"
    else -> "$min min before"
}
