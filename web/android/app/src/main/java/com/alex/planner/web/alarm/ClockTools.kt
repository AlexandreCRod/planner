package com.alex.planner.web.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import com.alex.planner.web.R
import kotlinx.serialization.Serializable
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * A countdown. Running, it keeps the time it ends ([endAt]); paused or not started, what's left. Times
 * are wall-clock milliseconds, so it carries on while the app is closed. (Copied from the native app.)
 */
@Serializable
data class ClockTimer(
    val id: Long,
    val durationMs: Long,
    val label: String = "",
    val endAt: Long? = null,
    val remainingMs: Long = durationMs,
) {
    val running get() = endAt != null
    fun remaining(now: Long): Long = endAt?.let { (it - now).coerceAtLeast(0) } ?: remainingMs
    fun start(now: Long) = if (running) this else copy(endAt = now + remainingMs.coerceAtLeast(1_000))
    fun pause(now: Long) = copy(endAt = null, remainingMs = remaining(now))
    fun reset() = copy(endAt = null, remainingMs = durationMs)
    fun plusMinute() = if (endAt != null) copy(endAt = endAt + 60_000) else copy(remainingMs = remainingMs + 60_000)
}

/**
 * A stopwatch: when it was (re)started and how much it had counted before. Elapsed time is worked
 * out from those, never counted in memory, so it survives the app being closed. The first one (id 0)
 * is the one there always was; the page can add more beside it (327), each with an id and an optional name.
 */
@Serializable
data class Stopwatch(
    val id: Long = 0,
    val name: String = "",
    val startedAt: Long? = null,
    val accumulatedMs: Long = 0,
    /** Total elapsed time at each lap, oldest first. */
    val laps: List<Long> = emptyList(),
) {
    val running get() = startedAt != null
    fun elapsed(now: Long): Long = accumulatedMs + (startedAt?.let { (now - it).coerceAtLeast(0) } ?: 0)
    fun start(now: Long) = if (running) this else copy(startedAt = now)
    fun pause(now: Long) = if (!running) this else copy(startedAt = null, accumulatedMs = elapsed(now))
    fun lap(now: Long) = copy(laps = laps + elapsed(now))
    fun reset() = copy(startedAt = null, accumulatedMs = 0, laps = emptyList())
    /** Each lap's own length, oldest first. */
    fun lapLengths(): List<Long> = laps.mapIndexed { i, t -> t - (laps.getOrNull(i - 1) ?: 0) }
}

@Serializable
data class ClockToolsState(
    val timers: List<ClockTimer> = emptyList(),
    /** The first stopwatch (as before 327, so an update keeps a running one running). */
    val stopwatch: Stopwatch = Stopwatch(),
    /** The ones added beside it (327), in the order added. */
    val moreStopwatches: List<Stopwatch> = emptyList(),
    /** World clock: time zone ids, in the order added. */
    val zones: List<String> = emptyList(),
)

/** Timers, the stopwatch and world clocks of the Alarms page. Kept on the phone only, like [ClockAlarms]. */
object ClockTools {
    private const val PREFS = "clock-tools"
    private const val KEY = "state"
    const val EXTRA_TIMER = "timerId"
    private val lock = Any()
    @Volatile private var state: ClockToolsState? = null

    fun current(context: Context): ClockToolsState = state ?: load(context).also { state = it }

    /** Forgets what was read (after AlarmStore moved the data). */
    fun reload() { state = null }

    private fun load(context: Context): ClockToolsState {
        val raw = AlarmStore.prefs(context, PREFS).getString(KEY, null) ?: return ClockToolsState()
        return runCatching { json.decodeFromString(ClockToolsState.serializer(), raw) }.getOrDefault(ClockToolsState())
    }

    private fun store(context: Context, s: ClockToolsState) {
        AlarmStore.prefs(context, PREFS).edit().putString(KEY, json.encodeToString(ClockToolsState.serializer(), s)).commit()
        state = s
        AlarmEvents.changed("tools")
    }

    private fun change(context: Context, fn: (ClockToolsState) -> ClockToolsState) = synchronized(lock) { store(context, fn(current(context))) }

    // ---- Timers ----

    fun timer(context: Context, id: Long) = current(context).timers.firstOrNull { it.id == id }

    /** Saves a timer and sets (or clears) its alarm and notification to match. */
    fun saveTimer(context: Context, t: ClockTimer) {
        change(context) { s -> s.copy(timers = s.timers.filterNot { it.id == t.id } + t) }
        if (t.running) arm(context, t) else disarm(context, t.id)
        showNotification(context, t)
    }

    fun startTimer(context: Context, durationMs: Long, label: String = "") {
        val now = System.currentTimeMillis()
        saveTimer(context, ClockTimer(id = now, durationMs = durationMs, label = label).start(now))
    }

    /** Undo of a delete: [text] is the timer as the page read it, and it comes back just so (same id, paused or still counting). */
    fun restoreTimer(context: Context, text: String) = saveTimer(context, json.decodeFromString(ClockTimer.serializer(), text))

    fun deleteTimer(context: Context, id: Long) {
        change(context) { s -> s.copy(timers = s.timers.filterNot { it.id == id }) }
        disarm(context, id)
        Notifications.cancel(context, notificationId(id))
    }

    /** Its time is up: it goes back to its full length, ready to start again. */
    fun finished(context: Context, id: Long) {
        val t = timer(context, id) ?: return
        change(context) { s -> s.copy(timers = s.timers.map { if (it.id == id) t.reset() else it }) }
        Notifications.cancel(context, notificationId(id))
    }

    /** After a reboot or an update: running timers are set again, and their notifications come back (and the stopwatches'). */
    fun rescheduleAll(context: Context) {
        current(context).timers.forEach { if (it.running) arm(context, it); showNotification(context, it) }
        showStopwatches(context)
    }

    private fun pending(context: Context, id: Long, create: Boolean): PendingIntent? {
        val intent = Intent(context, AlarmReceiver::class.java).setAction(AlarmReceiver.ACTION_TIMER)
            .setData(Uri.parse("planner-alarm://timer/$id")).putExtra(EXTRA_TIMER, id)
        val flags = PendingIntent.FLAG_IMMUTABLE or if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE
        return PendingIntent.getBroadcast(context, 0, intent, flags)
    }

    /** Rings through the same path as alarms, so it works with the app closed and the screen locked. */
    private fun arm(context: Context, t: ClockTimer) {
        val at = maxOf(t.endAt ?: return, System.currentTimeMillis() + 500)
        val am = context.getSystemService(AlarmManager::class.java)
        val pi = pending(context, t.id, create = true) ?: return
        val show = Notifications.openSectionIntent(context, "timer", 1)
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        if (canExact) am.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    private fun disarm(context: Context, id: Long) {
        val am = context.getSystemService(AlarmManager::class.java)
        pending(context, id, create = false)?.let { am.cancel(it); it.cancel() }
    }

    private fun notificationId(id: Long) = 778_000 + Math.floorMod(id, 1000L).toInt()

    private fun action(context: Context, action: String, id: Long) = PendingIntent.getBroadcast(
        context, 0,
        Intent(context, AlarmReceiver::class.java).setAction(action)
            .setData(Uri.parse("planner-alarm://timer/$id/${action.substringAfterLast('.')}")).putExtra(EXTRA_TIMER, id),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /**
     * While a timer runs (or is paused), a quiet notification counts down, with Pause / Resume, +1 min
     * and Cancel.
     */
    private fun showNotification(context: Context, t: ClockTimer) {
        val now = System.currentTimeMillis()
        if (!t.running && t.remainingMs == t.durationMs) { Notifications.cancel(context, notificationId(t.id)); return }
        val open = Notifications.openSectionIntent(context, "timer", 2)
        val b = NotificationCompat.Builder(context, Notifications.CH_TIMER)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(t.label.ifBlank { "Timer" } + " · " + formatDuration(t.durationMs))
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
        if (t.running) {
            // The system counts down by itself, so nothing needs to update this every second.
            b.setUsesChronometer(true).setChronometerCountDown(true).setWhen(t.endAt!!).setShowWhen(true)
                .setContentText("Running")
                .addAction(0, "Pause", action(context, AlarmReceiver.ACTION_TIMER_PAUSE, t.id))
        } else {
            b.setContentText("Paused · ${formatDuration(t.remaining(now))} left")
                .addAction(0, "Resume", action(context, AlarmReceiver.ACTION_TIMER_RESUME, t.id))
        }
        b.addAction(0, "+1 min", action(context, AlarmReceiver.ACTION_TIMER_PLUS, t.id))
        b.addAction(0, "Cancel", action(context, AlarmReceiver.ACTION_TIMER_CANCEL, t.id))
        Notifications.notify(context, notificationId(t.id), b, t.endAt ?: now)
    }

    // ---- Stopwatches (327) ----
    // The page decides (which one, what to do, how many there may be: StopwatchPane, domain/alarms.ts); this
    // carries it out, with the phone's own clock, and keeps the notification of the running ones.

    const val MAX_STOPWATCHES = 5

    /** Every stopwatch, the first one first. */
    fun stopwatches(s: ClockToolsState): List<Stopwatch> = listOf(s.stopwatch) + s.moreStopwatches

    /**
     * [s] after [action] on stopwatch [id] at [now]: "start", "pause", "lap", "reset", "rename" ([name]),
     * "add" (a new one, [id] and [name] from the page, counting from [now]) and "remove" (not the first). An
     * unknown id or action changes nothing.
     */
    fun stopwatchAction(s: ClockToolsState, action: String, id: Long, name: String, now: Long): ClockToolsState {
        if (action == "add") {
            if (stopwatches(s).any { it.id == id } || stopwatches(s).size >= MAX_STOPWATCHES) return s
            return s.copy(moreStopwatches = s.moreStopwatches + Stopwatch(id = id, name = name).start(now))
        }
        if (action == "remove") return s.copy(moreStopwatches = s.moreStopwatches.filterNot { it.id == id })
        val fn: (Stopwatch) -> Stopwatch = when (action) {
            "start" -> { sw -> sw.start(now) }
            "pause" -> { sw -> sw.pause(now) }
            "lap" -> { sw -> sw.lap(now) }
            "reset" -> { sw -> sw.reset() }
            "rename" -> { sw -> sw.copy(name = name) }
            else -> return s
        }
        return if (id == s.stopwatch.id) s.copy(stopwatch = fn(s.stopwatch))
        else s.copy(moreStopwatches = s.moreStopwatches.map { if (it.id == id) fn(it) else it })
    }

    fun stopwatch(context: Context, action: String, id: Long, name: String) {
        val now = System.currentTimeMillis()
        change(context) { stopwatchAction(it, action, id, name, now) }
        showStopwatches(context)
    }

    /** A stopwatch's name in the notification: its own, else "Stopwatch", "Stopwatch 2"... by its place (as the page says). */
    fun stopwatchLabel(sw: Stopwatch, index: Int) = sw.name.trim().ifBlank { if (index == 0) "Stopwatch" else "Stopwatch ${index + 1}" }

    /** The running ones, as the notification lists them: name and when it would have started counting from zero. */
    fun runningStopwatches(s: ClockToolsState, now: Long): List<Pair<String, Long>> =
        stopwatches(s).mapIndexedNotNull { i, sw -> if (sw.running) stopwatchLabel(sw, i) to (now - sw.elapsed(now)) else null }

    private const val SW_NOTIFICATION = 779_000

    /** One quiet line per running stopwatch, counting by itself (the system's chronometer), in the card's group. */
    private fun showStopwatches(context: Context) {
        val now = System.currentTimeMillis()
        val running = runningStopwatches(current(context), now)
        running.forEachIndexed { i, (label, from) ->
            val b = NotificationCompat.Builder(context, Notifications.CH_TIMER)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(label)
                .setContentText("Running")
                .setContentIntent(Notifications.openSectionIntent(context, "stopwatch", 3))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setUsesChronometer(true).setWhen(from).setShowWhen(true)
            Notifications.notify(context, SW_NOTIFICATION + i, b, from)
        }
        for (i in running.size until MAX_STOPWATCHES) Notifications.cancel(context, SW_NOTIFICATION + i)
    }

    // ---- World clock ----

    fun addZone(context: Context, zone: String) = change(context) { s -> if (zone in s.zones) s else s.copy(zones = s.zones + zone) }

    fun removeZone(context: Context, zone: String) = change(context) { s -> s.copy(zones = s.zones - zone) }

    // ---- Shared maths and wording ----

    /** "4:05", "1:02:03"; with [hundredths] "4:05.27" (the stopwatch). */
    fun formatDuration(ms: Long, hundredths: Boolean = false): String {
        val total = ms.coerceAtLeast(0)
        val h = total / 3_600_000
        val m = total / 60_000 % 60
        val s = total / 1000 % 60
        val base = if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
        return if (hundredths) base + ".%02d".format(total / 10 % 100) else base
    }

    /** The city part of a zone id: "America/New_York" → "New York". */
    fun cityName(zone: String): String = zone.substringAfterLast('/').replace('_', ' ')

    /** How far [zone] is from the phone's zone at [at]: "Same time", "+1 h", "−5 h 30 min". */
    fun offsetLabel(zone: ZoneId, at: Instant = Instant.now(), local: ZoneId = ZoneId.systemDefault()): String {
        val diff = Duration.ofSeconds((zone.rules.getOffset(at).totalSeconds - local.rules.getOffset(at).totalSeconds).toLong())
        if (diff.isZero) return "Same time"
        val sign = if (diff.isNegative) "−" else "+"
        val abs = diff.abs()
        val h = abs.toHours()
        val m = abs.toMinutes() % 60
        return sign + (if (h > 0) "$h h" else "") + (if (h > 0 && m > 0) " " else "") + (if (m > 0) "$m min" else "")
    }

    /** "Tomorrow" / "Yesterday" when [zone] is on another day than the phone, else null. */
    fun dayLabel(zone: ZoneId, at: Instant = Instant.now(), local: ZoneId = ZoneId.systemDefault()): String? {
        val there: LocalDate = at.atZone(zone).toLocalDate()
        val here: LocalDate = at.atZone(local).toLocalDate()
        return when {
            there > here -> "Tomorrow"
            there < here -> "Yesterday"
            else -> null
        }
    }
}
