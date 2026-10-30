package com.alex.planner.web.alarm

import android.content.Context
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.alex.planner.web.R
import java.time.Instant
import java.time.ZoneId

/**
 * What the engine has set with AlarmManager to ring, with when (194). AlarmManager forgets everything
 * when the phone is turned off, so this record is how a restart knows what should have rung meanwhile
 * ([Missed]), and how many are set ([AlarmScheduler]'s cap). Item reminders by reminder id, clock alarms
 * by their id; snoozes have records of their own (AlarmOverrides' ring snooze, ClockAlarms' snoozes).
 * In device-protected storage, like the rest of the engine's data.
 */
object Armed {
    private const val PREFS = "alarm-armed"
    private const val REMINDER = "r:"
    private const val CLOCK = "c:"
    const val BOOT = "boot"

    /** One reminder set to ring at [at], for [itemId]'s occurrence on [day] (due at [original]). */
    data class Entry(val reminderId: Long, val itemId: Long, val day: Long, val at: Long, val original: Long)

    private const val HORIZON = "horizon"

    fun prefs(context: Context) = AlarmStore.prefs(context, PREFS)

    /** Reminders due after this aren't set yet ([AlarmScheduler.MAX_ARMED]); Long.MAX_VALUE: all are. */
    fun horizon(context: Context): Long = prefs(context).getLong(HORIZON, Long.MAX_VALUE)

    fun setHorizon(context: Context, at: Long) {
        if (horizon(context) != at) prefs(context).edit().putLong(HORIZON, at).apply()
    }

    fun putReminder(context: Context, e: Entry) {
        prefs(context).edit().putString(REMINDER + e.reminderId, "${e.at}|${e.itemId}|${e.day}|${e.original}").apply()
    }

    fun removeReminder(context: Context, reminderId: Long) {
        val p = prefs(context)
        if (p.contains(REMINDER + reminderId)) p.edit().remove(REMINDER + reminderId).apply()
    }

    fun reminders(context: Context): List<Entry> = prefs(context).all.mapNotNull { (k, v) ->
        if (!k.startsWith(REMINDER)) return@mapNotNull null
        val id = k.removePrefix(REMINDER).toLongOrNull() ?: return@mapNotNull null
        val f = (v as? String)?.split('|')?.map { it.toLongOrNull() } ?: return@mapNotNull null
        if (f.size < 4 || f.any { it == null }) return@mapNotNull null
        Entry(id, f[1]!!, f[2]!!, f[0]!!, f[3]!!)
    }

    fun putClock(context: Context, id: Long, at: Long) {
        prefs(context).edit().putLong(CLOCK + id, at).apply()
    }

    fun removeClock(context: Context, id: Long) {
        val p = prefs(context)
        if (p.contains(CLOCK + id)) p.edit().remove(CLOCK + id).apply()
    }

    fun clocks(context: Context): Map<Long, Long> = prefs(context).all.mapNotNull { (k, v) ->
        if (!k.startsWith(CLOCK)) return@mapNotNull null
        val id = k.removePrefix(CLOCK).toLongOrNull() ?: return@mapNotNull null
        (v as? Long)?.let { id to it }
    }.toMap()
}

/**
 * Alarms that should have rung while the phone was off (194): after a restart, each gets a "Missed alarm"
 * notice, a reminder's notification is shown late, and a one-off clock alarm switches itself off as if it
 * had rung (it doesn't quietly move to the next day). Runs once per restart, before everything is set again.
 */
object Missed {
    /** Older than this, a missed alarm says nothing (the phone was off for days). */
    const val MAX_AGE_MS = 24 * 3_600_000L

    /** Whether something set for [at] should have rung by [now] and is recent enough to tell about. */
    fun isMissed(at: Long, now: Long): Boolean = at in 1..now && now - at <= MAX_AGE_MS

    /** Whether a clock alarm that missed its ring turns off (a one-off, or one whose dates are all past): as [ClockAlarms.afterRing]. */
    fun clockTurnsOff(a: ClockAlarm, now: java.time.LocalDateTime): Boolean = !a.repeating || ClockAlarms.nextRing(a, now) == null

    /** Runs once per restart (both boot broadcasts call it; the second does nothing). */
    fun afterBoot(context: Context) {
        val count = runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrDefault(-1)
        val p = Armed.prefs(context)
        if (count >= 0 && p.getInt(Armed.BOOT, -1) == count) return
        p.edit().putInt(Armed.BOOT, count).commit()
        check(context, System.currentTimeMillis())
    }

    fun check(context: Context, now: Long) {
        val m = Mirror.current(context)
        val settings = m.settings
        val rings = RingDevice.ringsEvents(context)
        // Task and event reminders.
        for (e in Armed.reminders(context)) {
            if (!isMissed(e.at, now)) continue
            Armed.removeReminder(context, e.reminderId)
            if (!rings) continue
            val item = m.items.firstOrNull { it.id == e.itemId } ?: continue
            val r = m.reminders.firstOrNull { it.id == e.reminderId } ?: continue
            val done = Mirror.doneDays(context, item.id)
            if (AlarmScheduler.noLongerApplies(item, r, e.day, e.original, done, settings.defaultTaskTime)) continue
            tellItem(context, item, r, e.day, e.at, e.original, settings)
        }
        // Their snoozes (from the ringing screen or a reminder's notification).
        for (r in m.reminders) {
            val until = AlarmOverrides.ringSnoozeAny(context, r.id) ?: continue
            if (!isMissed(until, now)) continue
            val occ = Shown.get(context, Shown.SNOOZE, r.id)
            AlarmOverrides.clearRingSnooze(context, r.id)
            Shown.remove(context, Shown.SNOOZE, r.id)
            if (!rings || occ == null) continue
            val item = m.items.firstOrNull { it.id == r.itemId } ?: continue
            if (AlarmScheduler.noLongerApplies(item, r, occ.day, occ.original, Mirror.doneDays(context, item.id), settings.defaultTaskTime)) continue
            tellItem(context, item, r, occ.day, until, occ.original, settings)
        }
        // Clock alarms and their snoozes.
        val armedClocks = Armed.clocks(context)
        val snoozes = ClockAlarms.snoozes(context)
        for (a in ClockAlarms.all(context)) {
            val at = armedClocks[a.id]?.takeIf { isMissed(it, now) && a.enabled }
            val snoozedTo = snoozes[a.id]?.takeIf { isMissed(it, now) }
            if (at == null && snoozedTo == null) continue
            if (at != null) Armed.removeClock(context, a.id)
            if (snoozedTo != null) ClockAlarms.clearSnooze(context, a.id)
            val title = a.label.trim().ifBlank { "Alarm" }
            show(context, clockNoticeId(a.id), title, whenText(maxOf(at ?: 0L, snoozedTo ?: 0L)),
                Notifications.openSectionIntent(context, "alarm", 4))
            if (at != null && clockTurnsOff(a, java.time.LocalDateTime.now())) ClockAlarms.save(context, a.copy(enabled = false))
        }
        // Records for clock alarms that are gone.
        armedClocks.keys.filter { id -> ClockAlarms.get(context, id) == null }.forEach { Armed.removeClock(context, it) }
    }

    /** An alarm gets the missed notice; a reminder or notification is shown as it would have been. */
    private fun tellItem(context: Context, item: Item, r: Reminder, day: Long, at: Long, original: Long, settings: AlarmSettings) {
        if (r.type == AlertType.ALARM) {
            show(context, smallId(r.id), item.title.ifBlank { "Alarm" }, whenText(at), Notifications.openItemIntent(context, item.id))
        } else {
            val text = relativeDayLabel(day.toDate()) + if (!item.allDay && item.startMin != null) " at ${formatTime(item.startMin)}" else ""
            Notifications.show(context, item, r.id, day, r.type, text, quiet = true, settings.snoozeMinutes)
            Shown.put(context, Shown.NOTIFICATION, r.id, day, original)
        }
    }

    fun clockNoticeId(id: Long) = 779_000 + Math.floorMod(id, 1000L).toInt()

    /** "Today at 07:00": when it should have rung. */
    fun whenText(at: Long): String {
        val t = Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()).toLocalDateTime()
        return relativeDayLabel(t.toLocalDate()) + " at " + formatTime(t.hour * 60 + t.minute)
    }

    /** The missed-alarm notice (the ringing service's timeout leaves the same one). */
    fun show(context: Context, id: Int, title: String, text: String, open: android.app.PendingIntent) {
        val b = NotificationCompat.Builder(context, Notifications.CH_REMIND)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Missed alarm: $title")
            .setContentText(text)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
        Notifications.notify(context, id, b)
    }
}
