package com.alex.planner.web.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
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
    const val EXTRA_STOPWATCH = "stopwatchId"
    private val lock = Any()
    @Volatile private var state: ClockToolsState? = null

    fun current(context: Context): ClockToolsState = state ?: load(context).also { state = it }

    /** Forgets what was read (after AlarmStore moved the data). */
    fun reload() { state = null; synchronized(lock) { pausedLines.clear() } }

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

    /**
     * Stopwatches deleted on the page whose Undo is still offered: their line goes at once and comes back on Undo
     * (review of 2.10.1, finding 6). Only in memory: the delete is committed when the app is put away.
     */
    private val hiddenLines = mutableSetOf<Long>()

    /**
     * Stopwatches paused while this process ran (358): their line stays, paused, so a tap on its time goes on.
     * Only in memory, so a paused line isn't brought back days later after a restart.
     */
    private val pausedLines = mutableSetOf<Long>()

    /** A tap on the time in a stopwatch's notification (358): it pauses, or goes on. */
    fun toggleStopwatch(context: Context, id: Long) {
        val sw = stopwatches(current(context)).firstOrNull { it.id == id } ?: return
        stopwatch(context, if (sw.running) "pause" else "start", id, "")
    }

    /** A paused stopwatch's line was swiped away (358): it stays away until the stopwatch goes on (or is paused again). */
    fun lineDismissed(id: Long) = synchronized(lock) { pausedLines -= id }

    fun stopwatch(context: Context, action: String, id: Long, name: String) {
        when (action) {
            "hide" -> synchronized(lock) { hiddenLines += id }
            "show" -> synchronized(lock) { hiddenLines -= id }
            else -> {
                // A reset or a delete for good ends the hiding its Undo needed.
                if (action == "remove" || action == "reset") synchronized(lock) { hiddenLines -= id }
                synchronized(lock) { if (action == "pause") pausedLines += id else if (action != "lap" && action != "rename") pausedLines -= id }
                val now = System.currentTimeMillis()
                change(context) { stopwatchAction(it, action, id, name, now) }
            }
        }
        showStopwatches(context)
    }

    /** A stopwatch's name in the notification: its own, else "Stopwatch", "Stopwatch 2"... by its place (as the page says). */
    fun stopwatchLabel(sw: Stopwatch, index: Int) = sw.name.trim().ifBlank { if (index == 0) "Stopwatch" else "Stopwatch ${index + 1}" }

    /** The running ones, as the notification lists them: name and when it would have started counting from zero. */
    fun runningStopwatches(s: ClockToolsState, now: Long, hidden: Set<Long> = emptySet()): List<Pair<String, Long>> =
        stopwatches(s).mapIndexedNotNull { i, sw -> if (sw.running && sw.id !in hidden) stopwatchLabel(sw, i) to (now - sw.elapsed(now)) else null }

    /** A stopwatch's notification line: its name, whether it runs, and how long it has counted at [StopwatchLine.at]. */
    data class StopwatchLine(val id: Long, val label: String, val running: Boolean, val elapsed: Long)

    /** The lines to show (358): the running ones, and those paused here since ([paused]) with a time; none [hidden]. */
    fun stopwatchLines(s: ClockToolsState, now: Long, hidden: Set<Long> = emptySet(), paused: Set<Long> = emptySet()): List<StopwatchLine> =
        stopwatches(s).mapIndexedNotNull { i, sw ->
            val e = sw.elapsed(now)
            if (sw.id !in hidden && (sw.running || (sw.id in paused && e > 0))) StopwatchLine(sw.id, stopwatchLabel(sw, i), sw.running, e) else null
        }

    /**
     * The running stopwatches' lines: 780000-780004. The other fixed ranges: the card 776000-776001, the ringing
     * service 777000-777001, timers 778000-778999 and clock alarms' "Missed alarm" 779000-779999 (review of 2.10.1,
     * finding 1: the stopwatches had 779000-779004 and wiped a missed notice for an alarm id ending in 000-004).
     */
    const val SW_NOTIFICATION = 780_000

    /**
     * One line per running stopwatch (and one paused here since, 358), counting by itself (the system's chronometer). Not in the card's group
     * (350): on the user's Xiaomi the lines didn't show; a child of the group is drawn under the card's summary
     * (which is redrawn, or taken down, right as the line is posted), so a stopwatch now stands on its own, on its
     * own channel (silent by the channel: NotificationCompat's setSilent would put it in a "silent" group of its
     * own, without a summary), shown in full on the lock screen too.
     */
    private fun showStopwatches(context: Context) {
        val now = System.currentTimeMillis()
        val (hidden, paused) = synchronized(lock) { hiddenLines.toSet() to pausedLines.toSet() }
        val lines = stopwatchLines(current(context), now, hidden, paused)
        val nm = NotificationManagerCompat.from(context)
        lines.forEachIndexed { i, line ->
            if (nm.areNotificationsEnabled()) runCatching { nm.notify(SW_NOTIFICATION + i, stopwatchNotice(context, line)) }
        }
        for (i in lines.size until MAX_STOPWATCHES) nm.cancel(SW_NOTIFICATION + i)
        // Lines of an older build were in the card's group: its summary is drawn again without them.
        Card.refresh(context)
    }

    /**
     * A stopwatch's line (358): no buttons. Its own layout puts the count at the right as a tap target of its own,
     * which pauses it (or goes on); a tap anywhere else opens the stopwatch. Where a phone doesn't draw custom
     * layouts, the plain title and "Running" / "Paused · 4:20" still show (a tap then opens the stopwatch).
     */
    fun stopwatchNotice(context: Context, line: StopwatchLine): android.app.Notification {
        val state = if (line.running) "Tap the time to pause" else "Paused · tap the time to go on"
        val view = RemoteViews(context.packageName, R.layout.notification_stopwatch).apply {
            setTextViewText(R.id.sw_label, line.label)
            setTextViewText(R.id.sw_state, state)
            setChronometer(R.id.sw_time, SystemClock.elapsedRealtime() - line.elapsed, null, line.running)
            setOnClickPendingIntent(R.id.sw_time, toggleIntent(context, line.id))
            setContentDescription(R.id.sw_time, if (line.running) "Pause ${line.label}" else "Go on with ${line.label}")
        }
        val b = NotificationCompat.Builder(context, Notifications.CH_STOPWATCH)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(line.label)
            .setContentText(if (line.running) "Running" else "Paused · ${formatDuration(line.elapsed)}")
            .setContentIntent(Notifications.openSectionIntent(context, "stopwatch", 3))
            .setStyle(NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(view)
            // A paused one can be swiped away; a running one stays while it counts.
            .setOngoing(line.running)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
        if (!line.running) b.setDeleteIntent(lineIntent(context, line.id, AlarmReceiver.ACTION_STOPWATCH_DISMISS, "dismiss"))
        // The count is in the layout: no second one in the header ("Planner · 04:00").
        b.setShowWhen(false)
        return b.build()
    }

    private fun toggleIntent(context: Context, id: Long) = lineIntent(context, id, AlarmReceiver.ACTION_STOPWATCH_TOGGLE, "toggle")

    private fun lineIntent(context: Context, id: Long, action: String, path: String): PendingIntent {
        val i = Intent(context, AlarmReceiver::class.java).setAction(action)
            .setData(Uri.parse("planner-alarm://stopwatch/$id/$path")).putExtra(EXTRA_STOPWATCH, id)
        return PendingIntent.getBroadcast(context, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
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
