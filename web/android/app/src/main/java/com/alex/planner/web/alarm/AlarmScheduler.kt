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
 * sets nothing for events and tasks while they are turned off in Settings ([RingDevice]).
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
        val lookBack = r.offsetMin / (60 * 24) + 1L
        var d = Recurrence.nextOnOrAfter(item, now.toLocalDate().minusDays(lookBack)) ?: return null
        repeat(500) {
            val original = originalAt(item, d, r.offsetMin, defaultTime, zone)
            val completionDay = if (item.isRecurring) d.epoch() else item.startDay
            val skip = item.type == ItemType.TASK && isDone(completionDay)
            val at = adjust(original)
            if (at != null && at > nowMillis && !skip) return Fire(d, at, original)
            if (!item.isRecurring) return null
            d = Recurrence.nextOnOrAfter(item, d.plusDays(1)) ?: return null
        }
        return null
    }

    /** When [item]'s occurrence on [day] is due for a reminder [offsetMin] minutes before it, as the item is now. */
    fun originalAt(item: Item, day: LocalDate, offsetMin: Int, defaultTime: Int, zone: ZoneId = ZoneId.systemDefault()): Long {
        val time = if (item.allDay || item.startMin == null) defaultTime else item.startMin
        return day.atTime(time / 60, time % 60).minusMinutes(offsetMin.toLong()).atZone(zone).toInstant().toEpochMilli()
    }

    /**
     * Whether something out for [r]'s occurrence on [day] (a notification, an upcoming notice, a snooze; see
     * [Shown]) no longer applies: the item or reminder is gone, the task was ticked for that day, the day
     * left the series, or the item moved so the occurrence is now due at another time than [original]
     * (0: not known, not checked).
     */
    fun noLongerApplies(item: Item?, r: Reminder?, day: Long, original: Long, done: Set<Long>, defaultTime: Int, zone: ZoneId = ZoneId.systemDefault()): Boolean {
        if (item == null || r == null || item.deletedAt != null || item.startDay == null) return true
        val completionDay = if (item.isRecurring) day else item.startDay
        if (item.type == ItemType.TASK && completionDay in done) return true
        if (!Recurrence.occursOn(item, day.toDate())) return true
        return original != 0L && originalAt(item, day.toDate(), r.offsetMin, defaultTime, zone) != original
    }

    /**
     * Whether [item]'s start on [day] gets a gentle "Starting now" (after one of its reminders came before):
     * it has a time, it isn't ticked, and none of its own reminders rings right at the start.
     */
    fun startingNow(item: Item, reminders: List<Reminder>, day: Long, done: Set<Long>): Boolean {
        if (item.type == ItemType.NOTE || item.deletedAt != null || item.allDay || item.startMin == null || item.startDay == null) return false
        val completionDay = if (item.isRecurring) day else item.startDay
        if (item.type == ItemType.TASK && completionDay in done) return false
        return reminders.none { it.itemId == item.id && it.offsetMin <= 0 }
    }

    /** Sets the start of [item]'s occurrence on [day]: its reminders are cleared then (see [AlarmReceiver.ACTION_START]). */
    fun scheduleStart(context: Context, item: Item, day: Long) {
        if (item.allDay || item.startMin == null) return
        val at = originalAt(item, day.toDate(), 0, 0)
        if (at <= System.currentTimeMillis()) return
        val am = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = AlarmReceiver.ACTION_START
            data = Uri.parse("planner-alarm://start/${item.id}")
            putExtra(AlarmReceiver.EXTRA_ITEM, item.id)
            putExtra(AlarmReceiver.EXTRA_DAY, day)
            putExtra(AlarmReceiver.EXTRA_AT, at)
        }
        val pi = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        if (canExact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    /** Schedules [itemId]'s reminders again from the engine's copy (after it was ticked here, say). */
    fun refreshItem(context: Context, itemId: Long) {
        val m = Mirror.current(context)
        val item = m.items.firstOrNull { it.id == itemId } ?: return
        scheduleItem(context, item, m.reminders.filter { it.itemId == itemId })
    }

    /** The next firing of [r] as the engine sees it now (overrides applied), or null. */
    fun nextFireNow(context: Context, item: Item, r: Reminder): Fire? {
        val done = Mirror.doneDays(context, item.id)
        return nextFire(item, r, LocalDateTime.now(), Mirror.settings(context).defaultTaskTime, { it in done }) {
            AlarmOverrides.adjusted(context, r.id, it)
        }
    }

    fun scheduleItem(context: Context, item: Item, reminders: List<Reminder>) {
        // What's out for occurrences that no longer apply (ticked, moved) goes first.
        Shown.tidy(context, item, reminders)
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
            if (item == null || item.deletedAt != null) rs.forEach { cancel(context, it.id); Shown.forget(context, it.id) }
            else {
                scheduleItem(context, item, rs)
                rs.forEach { live += it.id }
            }
        }
        m.scheduled.filter { it !in live }.forEach { cancel(context, it); Shown.forget(context, it) }
        if (m.scheduled.toSet() != live) Mirror.update(context) { it.copy(scheduled = live.toList()) }
    }

    /** [original]: when the occurrence snoozed was due (0 if not known), so the snooze can be taken back if it moves. */
    fun snooze(context: Context, item: Item, r: Reminder, day: Long, minutes: Int, original: Long = 0L) {
        val at = System.currentTimeMillis() + minutes * 60_000L
        set(context, item, r, day, at, snooze = true, original = 0L)
        Shown.put(context, Shown.SNOOZE, r.id, day, original)
        // Remembered so the task or event can show it, and undo it ("Reset").
        AlarmOverrides.setRingSnooze(context, r.id, at)
    }

    /** Drops a snooze set from the ringing screen or a reminder's notification. */
    fun cancelSnooze(context: Context, reminderId: Long) {
        val am = context.getSystemService(AlarmManager::class.java)
        pending(context, reminderId, snooze = true)?.let { am.cancel(it); it.cancel() }
        AlarmOverrides.clearRingSnooze(context, reminderId)
        Shown.remove(context, Shown.SNOOZE, reminderId)
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
