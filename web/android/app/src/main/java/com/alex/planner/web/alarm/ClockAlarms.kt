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
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * A plain alarm clock, like the phone's Clock app: a time, the weekdays it repeats on (none = rings
 * once), a label and a colour. Kept on the phone only, since only the phone rings.
 * (Copied from the native app's ClockAlarms.)
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
) {
    val minuteOfDay get() = hour * 60 + minute
    fun repeatsOn(d: DayOfWeek) = days and (1 shl (d.value - 1)) != 0
}

object ClockAlarms {
    private const val PREFS = "clock-alarms"
    private const val KEY = "list"
    const val EXTRA_CLOCK = "clockId"
    private val lock = Any()
    @Volatile private var state: List<ClockAlarm>? = null

    fun all(context: Context): List<ClockAlarm> = state ?: load(context).also { state = it }

    fun get(context: Context, id: Long): ClockAlarm? = all(context).firstOrNull { it.id == id }

    private fun load(context: Context): List<ClockAlarm> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
        return runCatching { json.decodeFromString(ListSerializer(ClockAlarm.serializer()), raw) }.getOrDefault(emptyList())
    }

    private fun store(context: Context, list: List<ClockAlarm>) {
        val sorted = list.sortedBy { it.minuteOfDay }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
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

    /** The next time [a] rings after [now]. */
    fun nextRing(a: ClockAlarm, now: LocalDateTime = LocalDateTime.now()): LocalDateTime {
        var d = now.toLocalDate()
        repeat(8) {
            val at = d.atTime(a.hour, a.minute)
            if (at.isAfter(now) && (a.days == 0 || a.repeatsOn(d.dayOfWeek))) return at
            d = d.plusDays(1)
        }
        return now.toLocalDate().plusDays(1).atTime(a.hour, a.minute)
    }

    fun rescheduleAll(context: Context) = load(context).forEach { schedule(context, it) }

    fun schedule(context: Context, a: ClockAlarm) {
        if (!a.enabled) { cancel(context, a.id); return }
        val at = nextRing(a).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        set(context, a.id, at, snooze = false)
    }

    fun snooze(context: Context, id: Long, minutes: Int) {
        set(context, id, System.currentTimeMillis() + minutes * 60_000L, snooze = true)
    }

    /** After ringing: a one-off alarm switches itself off, a repeating one queues its next day. */
    fun afterRing(context: Context, id: Long) {
        val a = get(context, id) ?: return
        if (a.days == 0) save(context, a.copy(enabled = false)) else schedule(context, a)
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
    }
}
