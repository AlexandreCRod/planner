package com.alex.planner.web.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * A plain alarm clock, like the phone's Clock app: a time, the weekdays it repeats on (none = rings
 * once) or chosen dates instead, days it skips or a day it's paused until, a label and a colour. Kept
 * on the phone only, since only the phone rings. The rules match the page's (web/src/domain/alarms.ts,
 * tested there). (Started from the native app's ClockAlarms.)
 */
@Serializable
data class ClockAlarm(
    val id: Long,
    val hour: Int,
    val minute: Int,
    val label: String = "",
    /** Bit 0 = Monday ... bit 6 = Sunday; 0 rings once, at the next matching time. */
    val days: Int = 0,
    val enabled: Boolean = true,
    /** Index into the alarm page's palette. */
    val color: Int = 0,
    val sound: String? = null,
    /** Local epoch days it rings on, instead of [days], when there are any. */
    val dates: List<Long> = emptyList(),
    /** Days a repeating alarm stays quiet. */
    val skip: List<Long> = emptyList(),
    /** A repeating alarm is quiet until this day (the first day it rings again). */
    val pausedUntil: Long? = null,
) {
    val minuteOfDay get() = hour * 60 + minute
    fun repeatsOn(d: DayOfWeek) = days and (1 shl (d.value - 1)) != 0
    val repeating get() = days != 0 || dates.isNotEmpty()

    /** Whether it rings on [day] (its time aside): ringsOnDay in alarms.ts. */
    fun ringsOn(day: LocalDate): Boolean {
        val e = day.toEpochDay()
        if (dates.isNotEmpty()) { if (e !in dates) return false }
        else if (days == 0) return true
        else if (!repeatsOn(day.dayOfWeek)) return false
        if (e in skip) return false
        return pausedUntil == null || e >= pausedUntil
    }
}

object ClockAlarms {
    private const val PREFS = "clock-alarms"
    private const val KEY = "list"
    const val EXTRA_CLOCK = "clockId"
    private val lock = Any()
    @Volatile private var state: List<ClockAlarm>? = null

    fun all(context: Context): List<ClockAlarm> = state ?: load(context).also { state = it }

    /** Forgets what was read (after AlarmStore moved the data). */
    fun reload() { state = null }

    fun get(context: Context, id: Long): ClockAlarm? = all(context).firstOrNull { it.id == id }

    private fun load(context: Context): List<ClockAlarm> {
        val raw = AlarmStore.prefs(context, PREFS).getString(KEY, null) ?: return emptyList()
        return runCatching { json.decodeFromString(ListSerializer(ClockAlarm.serializer()), raw) }.getOrDefault(emptyList())
    }

    private fun store(context: Context, list: List<ClockAlarm>) {
        val sorted = list.sortedBy { it.minuteOfDay }
        AlarmStore.prefs(context, PREFS).edit()
            .putString(KEY, json.encodeToString(ListSerializer(ClockAlarm.serializer()), sorted)).commit()
        state = sorted
        AlarmEvents.changed("clock")
    }

    fun save(context: Context, alarm: ClockAlarm) {
        synchronized(lock) { store(context, all(context).filterNot { it.id == alarm.id } + alarm) }
        schedule(context, alarm)
    }

    fun delete(context: Context, id: Long) {
        synchronized(lock) { store(context, all(context).filterNot { it.id == id }) }
        cancel(context, id)
    }

    /** The next time [a] rings after [now], or null if it won't (its dates are all past): nextRing in alarms.ts. */
    fun nextRing(a: ClockAlarm, now: LocalDateTime = LocalDateTime.now()): LocalDateTime? {
        var d = now.toLocalDate()
        repeat(401) {
            if (a.ringsOn(d)) {
                val at = d.atTime(a.hour, a.minute)
                if (at.isAfter(now)) return at
            }
            d = d.plusDays(1)
        }
        return null
    }

    /** Sets every alarm again (after a restart, an update, a clock change), and the snoozes still to ring (194). */
    fun rescheduleAll(context: Context) {
        val list = load(context)
        list.forEach { schedule(context, it) }
        val now = System.currentTimeMillis()
        for ((id, until) in snoozes(context)) {
            if (list.none { it.id == id }) clearSnooze(context, id)
            else if (until > now) set(context, id, until, snooze = true)
        }
    }

    fun schedule(context: Context, a: ClockAlarm) {
        if (!a.enabled) { cancel(context, a.id); return }
        val next = nextRing(a) ?: run { cancel(context, a.id); return }
        val at = next.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        set(context, a.id, at, snooze = false)
        Armed.putClock(context, a.id, at)
        // Only the notice: whatever goes wrong with it, the alarm above is set.
        runCatching { scheduleNotice(context, a, at) }
    }

    /** When [a] rings next, in milliseconds, or null. */
    fun nextRingAt(a: ClockAlarm): Long? = nextRing(a)?.atZone(ZoneId.systemDefault())?.toInstant()?.toEpochMilli()

    /**
     * Queues the notice for 2 hours before [at] (219: clock alarms never had one). One already showing for
     * another time is out of date (the alarm moved, was skipped, or rang), so it goes.
     */
    private fun scheduleNotice(context: Context, a: ClockAlarm, at: Long) {
        Shown.get(context, Shown.CLOCK, a.id)?.let { if (it.original != at) takeBackNotice(context, a.id) }
        if (!Mirror.settings(context).upcomingAlarms) { cancelNotice(context, a.id); return }
        val pi = noticePending(context, a.id, at, create = true) ?: return
        AlarmScheduler.setNotice(context, AlarmScheduler.noticeAt(at), pi)
    }

    private fun noticePending(context: Context, id: Long, at: Long, create: Boolean): PendingIntent? {
        val intent = Intent(context, AlarmReceiver::class.java)
            .setAction(AlarmReceiver.ACTION_CLOCK_UPCOMING)
            .setData(Uri.parse("planner-alarm://clock/$id/notice"))
            .putExtra(EXTRA_CLOCK, id)
            .putExtra(AlarmReceiver.EXTRA_AT, at)
        val flags = PendingIntent.FLAG_IMMUTABLE or if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE
        return PendingIntent.getBroadcast(context, 0, intent, flags)
    }

    private fun cancelNotice(context: Context, id: Long) {
        val am = context.getSystemService(AlarmManager::class.java)
        noticePending(context, id, 0L, create = false)?.let { am.cancel(it); it.cancel() }
        takeBackNotice(context, id)
    }

    private fun takeBackNotice(context: Context, id: Long) {
        Card.dropClock(context, id)
        Shown.remove(context, Shown.CLOCK, id)
    }

    /** The notice is due: shows it, unless the alarm changed since it was set or it was shown before. */
    fun notice(context: Context, id: Long, at: Long) {
        val a = get(context, id) ?: return
        if (!a.enabled || at <= System.currentTimeMillis() || nextRingAt(a) != at) return
        val settings = Mirror.settings(context)
        if (!settings.upcomingAlarms) return
        // Negative: a clock alarm's id is in a different series from a reminder's.
        if (!AlarmOverrides.firstNotice(context, -id, at)) return
        Card.clockNotice(context, a, at)
        Shown.put(context, Shown.CLOCK, a.id, 0L, at)
    }

    /**
     * Doesn't ring at [at], from the notice: a repeating alarm skips that day (the page's Skip next, 75),
     * one that rings once is switched off. Does nothing if the alarm has moved on since.
     */
    fun skip(context: Context, id: Long, at: Long) {
        val a = get(context, id) ?: return
        if (nextRingAt(a) != at) { takeBackNotice(context, id); return }
        val day = java.time.Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()).toLocalDate().toEpochDay()
        save(context, if (a.repeating) a.copy(skip = a.skip + day) else a.copy(enabled = false))
    }

    /** Rings [minutes] after [at] instead of at [at], from the notice. */
    fun snoozeEarly(context: Context, id: Long, at: Long, minutes: Int) {
        skip(context, id, at)
        val until = at + minutes * 60_000L
        setSnoozes(context, snoozes(context) + (id to until))
        set(context, id, until, snooze = true)
    }

    fun snooze(context: Context, id: Long, minutes: Int) {
        val until = System.currentTimeMillis() + minutes * 60_000L
        // Remembered, so a restart sets it again: AlarmManager forgets everything then (194).
        setSnoozes(context, snoozes(context) + (id to until))
        set(context, id, until, snooze = true)
    }

    private const val SNOOZES = "snoozes"

    /** Snoozed clock alarms: id to when it rings again. */
    fun snoozes(context: Context): Map<Long, Long> =
        (AlarmStore.prefs(context, PREFS).getString(SNOOZES, null) ?: "").split(',').mapNotNull { e ->
            val id = e.substringBefore(':').toLongOrNull() ?: return@mapNotNull null
            val until = e.substringAfter(':').toLongOrNull() ?: return@mapNotNull null
            id to until
        }.toMap()

    private fun setSnoozes(context: Context, map: Map<Long, Long>) {
        AlarmStore.prefs(context, PREFS).edit().putString(SNOOZES, map.entries.joinToString(",") { "${it.key}:${it.value}" }).commit()
    }

    /** The snooze rang, or was dropped. */
    fun clearSnooze(context: Context, id: Long) {
        val map = snoozes(context)
        if (id in map) setSnoozes(context, map - id)
    }

    /** After ringing: a one-off alarm (or one whose dates have all come) switches itself off, a repeating one queues its next day. */
    fun afterRing(context: Context, id: Long) {
        val a = get(context, id) ?: return
        if (!a.repeating || nextRing(a) == null) save(context, a.copy(enabled = false)) else schedule(context, a)
    }

    private fun pending(context: Context, id: Long, snooze: Boolean, create: Boolean): PendingIntent? {
        val intent = Intent(context, AlarmReceiver::class.java)
            .setAction(AlarmReceiver.ACTION_CLOCK)
            .setData(Uri.parse("planner-alarm://clock/$id/${if (snooze) 1 else 0}"))
            .putExtra(EXTRA_CLOCK, id)
            .putExtra(AlarmReceiver.EXTRA_SNOOZE, snooze)
        val flags = PendingIntent.FLAG_IMMUTABLE or if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE
        return PendingIntent.getBroadcast(context, 0, intent, flags)
    }

    private fun set(context: Context, id: Long, at: Long, snooze: Boolean) {
        val am = context.getSystemService(AlarmManager::class.java)
        val pi = pending(context, id, snooze, create = true) ?: return
        val show = Notifications.openSectionIntent(context, "alarm", 3)
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        if (canExact) am.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    fun cancel(context: Context, id: Long) {
        val am = context.getSystemService(AlarmManager::class.java)
        listOf(false, true).forEach { s -> pending(context, id, s, create = false)?.let { am.cancel(it); it.cancel() } }
        clearSnooze(context, id)
        Armed.removeClock(context, id)
        runCatching { cancelNotice(context, id) }
    }
}
