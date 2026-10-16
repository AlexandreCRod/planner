package com.alex.planner.web.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Schedules the next firing of every reminder with AlarmManager (one pending alarm per reminder).
 * Copied from the native app's AlarmScheduler; it reads the engine's [Mirror] instead of Room, and
 * sets nothing for events and tasks while [RingDevice] says the original app rings them.
 */
object AlarmScheduler {
    /** How long before an alarm its upcoming notice (with Snooze / Stop) appears. */
    const val UPCOMING_NOTICE_MS = 2 * 3_600_000L

    /** From how long before an alarm its task or event offers Snooze / Stop. */
    const val EARLY_CONTROL_MS = 23 * 3_600_000L

    /** An alarm can't be snoozed ahead of time once it's this close (it can still be stopped). */
    const val NO_SNOOZE_MS = 15 * 60_000L

    fun canSnoozeEarly(at: Long, now: Long = System.currentTimeMillis()) = at - now > NO_SNOOZE_MS

    /** [atMillis] is when it rings; [originalMillis] when it was due before any early snooze. */
    data class Fire(val day: LocalDate, val atMillis: Long, val originalMillis: Long = atMillis)

    /**
     * [adjust] maps an occurrence's due time to when it should ring now (null = stopped early),
     * see [AlarmOverrides].
     */
    fun nextFire(
        item: Item,
        r: Reminder,
        now: LocalDateTime,
        defaultTime: Int,
        isDone: (Long) -> Boolean,
        adjust: (Long) -> Long? = { it },
    ): Fire? {
        if (item.type == ItemType.NOTE || item.startDay == null || item.deletedAt != null) return null
        val zone = ZoneId.systemDefault()
        val nowMillis = now.atZone(zone).toInstant().toEpochMilli()
        val time = if (item.allDay || item.startMin == null) defaultTime else item.startMin
        val lookBack = r.offsetMin / (60 * 24) + 1L
        var d = Recurrence.nextOnOrAfter(item, now.toLocalDate().minusDays(lookBack)) ?: return null
        repeat(500) {
            val original = d.atTime(time / 60, time % 60).minusMinutes(r.offsetMin.toLong())
                .atZone(zone).toInstant().toEpochMilli()
            val completionDay = if (item.isRecurring) d.epoch() else item.startDay
            val skip = item.type == ItemType.TASK && isDone(completionDay)
            val at = adjust(original)
            if (at != null && at > nowMillis && !skip) return Fire(d, at, original)
            if (!item.isRecurring) return null
            d = Recurrence.nextOnOrAfter(item, d.plusDays(1)) ?: return null
        }
        return null
    }

    /** The next firing of [r] as the engine sees it now (overrides applied), or null. */
    fun nextFireNow(context: Context, item: Item, r: Reminder): Fire? {
        val done = Mirror.doneDays(context, item.id)
        return nextFire(item, r, LocalDateTime.now(), Mirror.settings(context).defaultTaskTime, { it in done }) {
            AlarmOverrides.adjusted(context, r.id, it)
        }
    }

    fun scheduleItem(context: Context, item: Item, reminders: List<Reminder>) {
        if (!RingDevice.ringsEvents(context)) {
            reminders.forEach { cancel(context, it.id) }
            return
        }
        val settings = Mirror.settings(context)
        for (r in reminders) {
            val fire = nextFireNow(context, item, r)
            if (fire == null) {
                cancel(context, r.id)
                continue
            }
            set(context, item, r, fire.day.epoch(), fire.atMillis, snooze = false, original = fire.originalMillis)
            if (r.type == AlertType.ALARM && settings.upcomingAlarms) scheduleNotice(context, item, r, fire)
            else cancelNotice(context, r.id)
        }
    }

    /**
     * Sets every reminder in the mirror again, and cancels those that have left it (deleted, or their
     * item was). Runs after each push from the page, after a reboot or an app update, and when the
     * ring-on-this-phone setting changes.
     */
    fun rescheduleAll(context: Context) {
        val m = Mirror.current(context)
        val items = m.items.associateBy { it.id }
        val live = HashSet<Long>()
        m.reminders.groupBy { it.itemId }.forEach { (itemId, rs) ->
            val item = items[itemId]
            if (item == null || item.deletedAt != null) rs.forEach { cancel(context, it.id) }
            else {
                scheduleItem(context, item, rs)
                rs.forEach { live += it.id }
            }
        }
        m.scheduled.filter { it !in live }.forEach { cancel(context, it) }
        if (m.scheduled.toSet() != live) Mirror.update(context) { it.copy(scheduled = live.toList()) }
    }

    fun snooze(context: Context, item: Item, r: Reminder, day: Long, minutes: Int) {
        val at = System.currentTimeMillis() + minutes * 60_000L
        set(context, item, r, day, at, snooze = true, original = 0L)
        // Remembered so the task or event can show it, and undo it ("Reset").
        AlarmOverrides.setRingSnooze(context, r.id, at)
    }

    /** Drops a snooze set from the ringing screen or a reminder's notification. */
    fun cancelSnooze(context: Context, reminderId: Long) {
        val am = context.getSystemService(AlarmManager::class.java)
        pending(context, reminderId, snooze = true)?.let { am.cancel(it); it.cancel() }
        AlarmOverrides.clearRingSnooze(context, reminderId)
    }

    /**
     * Each reminder's alarms are told apart by their data address, not the request code: record ids
     * here are 53-bit, too big for the native app's "id * 2" codes.
     */
    private fun address(reminderId: Long, snooze: Boolean, action: String) =
        Uri.parse("planner-alarm://reminder/$reminderId/${if (snooze) 1 else 0}/${action.substringAfterLast('.')}")

    private fun pending(context: Context, reminderId: Long, snooze: Boolean, intent: Intent? = null, action: String = AlarmReceiver.ACTION_FIRE): PendingIntent? {
        val i = intent ?: Intent(context, AlarmReceiver::class.java).setAction(action).setData(address(reminderId, snooze, action))
        val flags = PendingIntent.FLAG_IMMUTABLE or
            if (intent == null) PendingIntent.FLAG_NO_CREATE else PendingIntent.FLAG_UPDATE_CURRENT
        return PendingIntent.getBroadcast(context, 0, i, flags)
    }

    private fun set(context: Context, item: Item, r: Reminder, day: Long, at: Long, snooze: Boolean, original: Long) {
        val am = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = AlarmReceiver.ACTION_FIRE
            data = address(r.id, snooze, AlarmReceiver.ACTION_FIRE)
            putExtra(AlarmReceiver.EXTRA_ITEM, item.id)
            putExtra(AlarmReceiver.EXTRA_REMINDER, r.id)
            putExtra(AlarmReceiver.EXTRA_DAY, day)
            putExtra(AlarmReceiver.EXTRA_SNOOZE, snooze)
            putExtra(AlarmReceiver.EXTRA_ORIGINAL, original)
        }
        val pi = pending(context, r.id, snooze, intent) ?: return
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        when {
            r.type == AlertType.ALARM && canExact ->
                am.setAlarmClock(AlarmManager.AlarmClockInfo(at, Notifications.openItemIntent(context, item.id)), pi)
            canExact -> am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else -> am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    /** Queues the upcoming-alarm notice for 2 hours before [fire] (or right away if that's past). */
    private fun scheduleNotice(context: Context, item: Item, r: Reminder, fire: Fire) {
        val am = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = AlarmReceiver.ACTION_UPCOMING
            data = address(r.id, false, AlarmReceiver.ACTION_UPCOMING)
            putExtra(AlarmReceiver.EXTRA_ITEM, item.id)
            putExtra(AlarmReceiver.EXTRA_REMINDER, r.id)
            putExtra(AlarmReceiver.EXTRA_DAY, fire.day.epoch())
            putExtra(AlarmReceiver.EXTRA_AT, fire.atMillis)
            putExtra(AlarmReceiver.EXTRA_ORIGINAL, fire.originalMillis)
        }
        val pi = pending(context, r.id, false, intent) ?: return
        val at = maxOf(fire.atMillis - UPCOMING_NOTICE_MS, System.currentTimeMillis() + 1_000)
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    private fun cancelNotice(context: Context, reminderId: Long) {
        val am = context.getSystemService(AlarmManager::class.java)
        pending(context, reminderId, false, action = AlarmReceiver.ACTION_UPCOMING)?.let { am.cancel(it); it.cancel() }
        Notifications.cancelUpcoming(context, reminderId)
    }

    fun cancel(context: Context, reminderId: Long) {
        val am = context.getSystemService(AlarmManager::class.java)
        listOf(false, true).forEach { snooze ->
            pending(context, reminderId, snooze)?.let { am.cancel(it); it.cancel() }
        }
        cancelNotice(context, reminderId)
    }

    /** Clears what was set for every reminder (the ring-on-this-phone setting was turned off). */
    fun cancelAll(context: Context) {
        val m = Mirror.current(context)
        (m.scheduled + m.reminders.map { it.id }).toSet().forEach { cancel(context, it) }
    }
}
