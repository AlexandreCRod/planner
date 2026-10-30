package com.alex.planner.web.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.LocalTime

/** Copied from the native app's AlarmReceiver; reads the engine's [Mirror] instead of Room. */
class AlarmReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_FIRE = "com.alex.planner.web.FIRE"
        const val ACTION_SNOOZE = "com.alex.planner.web.SNOOZE"
        const val ACTION_DONE = "com.alex.planner.web.DONE"
        /** Posts the upcoming-alarm notice. */
        const val ACTION_UPCOMING = "com.alex.planner.web.UPCOMING"
        /** From that notice: ring later / don't ring this time. */
        const val ACTION_EARLY_SNOOZE = "com.alex.planner.web.EARLY_SNOOZE"
        const val ACTION_EARLY_STOP = "com.alex.planner.web.EARLY_STOP"
        /**
         * An item starts: its reminders from before the start (notifications, snoozes, notices) are cleared,
         * and a gentle "Starting now" shows if nothing of its own rings at the start. Set when one of its
         * earlier reminders fires.
         */
        const val ACTION_START = "com.alex.planner.web.START"
        /** A clock alarm (the Alarms page) is due. */
        const val ACTION_CLOCK = "com.alex.planner.web.CLOCK"
        /** A timer (the Alarms page) is up, and its notification's buttons. */
        const val ACTION_TIMER = "com.alex.planner.web.TIMER"
        const val ACTION_TIMER_PAUSE = "com.alex.planner.web.TIMER_PAUSE"
        const val ACTION_TIMER_RESUME = "com.alex.planner.web.TIMER_RESUME"
        const val ACTION_TIMER_CANCEL = "com.alex.planner.web.TIMER_CANCEL"
        const val ACTION_TIMER_PLUS = "com.alex.planner.web.TIMER_PLUS"
        const val EXTRA_ITEM = "itemId"
        const val EXTRA_REMINDER = "reminderId"
        const val EXTRA_DAY = "day"
        const val EXTRA_SNOOZE = "snooze"
        /** When the alarm will ring (after any early snooze). */
        const val EXTRA_AT = "at"
        /** When the occurrence was originally due; identifies it in [AlarmOverrides]. */
        const val EXTRA_ORIGINAL = "original"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                handle(context.applicationContext, intent)
            } finally {
                pending.finish()
            }
        }
    }

    private fun handle(context: Context, intent: Intent) {
        if (intent.action == ACTION_CLOCK) {
            val id = intent.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0)
            val alarm = ClockAlarms.get(context, id) ?: return
            val snoozed = intent.getBooleanExtra(EXTRA_SNOOZE, false)
            if (snoozed) ClockAlarms.clearSnooze(context, id) else Armed.removeClock(context, id)
            if (!snoozed) {
                if (!alarm.enabled) return
                ClockAlarms.afterRing(context, id)
            }
            val svc = Intent(context, AlarmService::class.java).apply {
                putExtra(ClockAlarms.EXTRA_CLOCK, id)
                // The alarm's title is the ringing screen's title (AlarmService); here only whether it's a snooze.
                putExtra(AlarmService.EXTRA_TEXT, if (snoozed) "Snoozed" else "")
                putExtra(AlarmService.EXTRA_SOUND, alarm.sound ?: Mirror.settings(context).defaultAlarmSound)
            }
            RingWakeLock.acquire(context, 60_000)
            ContextCompat.startForegroundService(context, svc)
            return
        }
        if (intent.action in setOf(ACTION_TIMER, ACTION_TIMER_PAUSE, ACTION_TIMER_RESUME, ACTION_TIMER_CANCEL, ACTION_TIMER_PLUS)) {
            handleTimer(context, intent)
            return
        }
        val itemId = intent.getLongExtra(EXTRA_ITEM, 0)
        val reminderId = intent.getLongExtra(EXTRA_REMINDER, 0)
        val day = intent.getLongExtra(EXTRA_DAY, 0)
        val item = Mirror.item(context, itemId) ?: return
        val reminder = Mirror.reminder(context, reminderId)
        val settings = Mirror.settings(context)
        val original = intent.getLongExtra(EXTRA_ORIGINAL, 0L)
        val completionDay = if (item.isRecurring) day else (item.startDay ?: day)
        fun isDone() = item.completable && completionDay in Mirror.doneDays(context, item.id)

        when (intent.action) {
            ACTION_UPCOMING -> {
                if (reminder == null || item.deletedAt != null || !RingDevice.ringsEvents(context)) return
                val at = AlarmOverrides.adjusted(context, reminder.id, original) ?: return
                if (at <= System.currentTimeMillis()) return
                if (isDone()) return
                if (!AlarmOverrides.firstNotice(context, reminder.id, original)) return
                Notifications.showUpcoming(context, item, reminder.id, day, at, original, snoozed = at != original, settings.snoozeMinutes)
            }
            ACTION_EARLY_SNOOZE -> {
                if (reminder == null) return
                val current = AlarmOverrides.adjusted(context, reminder.id, original) ?: return
                if (!AlarmScheduler.canSnoozeEarly(current)) {
                    // Too close to ringing: show the notice again, now with Stop only.
                    Notifications.showUpcoming(context, item, reminder.id, day, current, original, snoozed = current != original, settings.snoozeMinutes)
                    return
                }
                val later = current + settings.snoozeMinutes * 60_000L
                AlarmOverrides.delay(context, reminder.id, original, later)
                AlarmScheduler.scheduleItem(context, item, listOf(reminder))
                // Put off: the notice goes until it rings at the new time (the item shows the new time meanwhile).
                Shown.takeBack(context, Shown.UPCOMING, reminder.id)
            }
            ACTION_EARLY_STOP -> {
                if (reminder == null) return
                AlarmOverrides.stop(context, reminder.id, original)
                Notifications.cancelUpcoming(context, reminder.id)
                // Sets up the next occurrence instead (this one is now skipped).
                AlarmScheduler.scheduleItem(context, item, listOf(reminder))
            }
            ACTION_DONE -> {
                Mirror.markDone(context, item.id, completionDay)
                Notifications.cancel(context, smallId(reminderId))
                Notifications.cancelStarting(context, item.id)
                // Everything else out for that day goes too (other reminders, snoozes, notices).
                AlarmScheduler.refreshItem(context, item.id)
            }
            ACTION_SNOOZE -> {
                val occ = Shown.get(context, Shown.NOTIFICATION, reminderId)
                Notifications.cancel(context, smallId(reminderId))
                Shown.remove(context, Shown.NOTIFICATION, reminderId)
                if (reminder != null) AlarmScheduler.snooze(context, item, reminder, day, settings.snoozeMinutes, occ?.original ?: 0L)
            }
            ACTION_START -> handleStart(context, item, day, intent.getLongExtra(EXTRA_AT, 0L))
            ACTION_FIRE -> {
                if (!intent.getBooleanExtra(EXTRA_SNOOZE, false)) Armed.removeReminder(context, reminderId)
                Notifications.cancelUpcoming(context, reminderId)
                Shown.remove(context, Shown.UPCOMING, reminderId)
                val snoozed = intent.getBooleanExtra(EXTRA_SNOOZE, false)
                // A snooze carries no time of its own: the occurrence's comes from when it was snoozed.
                val occOriginal = if (snoozed) Shown.get(context, Shown.SNOOZE, reminderId)?.takeIf { it.day == day }?.original ?: 0L else original
                if (snoozed) {
                    AlarmOverrides.clearRingSnooze(context, reminderId)
                    Shown.remove(context, Shown.SNOOZE, reminderId)
                }
                if (reminder == null || item.deletedAt != null) return
                // Unless turned off in Settings (see RingDevice).
                if (!RingDevice.ringsEvents(context)) return
                val done = Mirror.doneDays(context, item.id)
                // Ticked, moved or started meanwhile (a snooze can outlive its occurrence): nothing to say.
                val stale = AlarmScheduler.noLongerApplies(item, reminder, day, occOriginal, done, settings.defaultTaskTime)
                val started = snoozed && reminder.offsetMin > 0 && !item.allDay && item.startMin != null &&
                    AlarmScheduler.originalAt(item, day.toDate(), 0, settings.defaultTaskTime) <= System.currentTimeMillis()
                if (!isDone() && !stale && !started) {
                    val text = describe(item.startMin, item.allDay, day)
                    if (reminder.type == AlertType.ALARM) {
                        val svc = Intent(context, AlarmService::class.java).apply {
                            putExtra(EXTRA_ITEM, item.id)
                            putExtra(EXTRA_REMINDER, reminder.id)
                            putExtra(EXTRA_DAY, day)
                            putExtra(EXTRA_ORIGINAL, occOriginal)
                            putExtra(AlarmService.EXTRA_TEXT, text)
                            putExtra(AlarmService.EXTRA_SOUND, reminder.soundUri ?: settings.defaultAlarmSound)
                        }
                        RingWakeLock.acquire(context, 60_000)
            ContextCompat.startForegroundService(context, svc)
                    } else {
                        val quiet = settings.quietHoursEnabled && inQuietHours(settings.quietStart, settings.quietEnd)
                        Notifications.show(context, item, reminder.id, day, reminder.type, text, quiet, settings.snoozeMinutes)
                        Shown.put(context, Shown.NOTIFICATION, reminder.id, day, occOriginal)
                    }
                    // A reminder before the start: at the start it's cleared, and "Starting now" may show.
                    if (reminder.offsetMin > 0) AlarmScheduler.scheduleStart(context, item, day)
                }
                // Queue the next occurrence of this reminder (snoozes are one-offs). With too many to set at once,
                // everything is looked at again, so the next nearest get set (194).
                if (!snoozed) {
                    if (Armed.horizon(context) != Long.MAX_VALUE) AlarmScheduler.rescheduleAll(context)
                    else AlarmScheduler.scheduleItem(context, item, listOf(reminder))
                }
            }
        }
    }

    private fun handleTimer(context: Context, intent: Intent) {
        val id = intent.getLongExtra(ClockTools.EXTRA_TIMER, 0)
        val t = ClockTools.timer(context, id) ?: return
        val now = System.currentTimeMillis()
        when (intent.action) {
            ACTION_TIMER_PAUSE -> ClockTools.saveTimer(context, t.pause(now))
            ACTION_TIMER_RESUME -> ClockTools.saveTimer(context, t.start(now))
            ACTION_TIMER_CANCEL -> ClockTools.saveTimer(context, t.reset())
            ACTION_TIMER_PLUS -> ClockTools.saveTimer(context, t.plusMinute())
            ACTION_TIMER -> {
                // Paused or changed since this was set: not its time.
                val end = t.endAt ?: return
                if (end - now > 2_000) return
                ClockTools.finished(context, id)
                val svc = Intent(context, AlarmService::class.java).apply {
                    putExtra(ClockTools.EXTRA_TIMER, id)
                    putExtra(AlarmService.EXTRA_TEXT, t.label.ifBlank { ClockTools.formatDuration(t.durationMs) + " timer" })
                    putExtra(AlarmService.EXTRA_SOUND, Mirror.settings(context).defaultAlarmSound)
                }
                RingWakeLock.acquire(context, 60_000)
            ContextCompat.startForegroundService(context, svc)
            }
        }
    }

    /** A reminder's text: the item's own time only ("Today at 19:00"), never how long before it is. */
    private fun describe(startMin: Int?, allDay: Boolean, day: Long): String =
        relativeDayLabel(day.toDate()) + if (!allDay && startMin != null) " at ${formatTime(startMin)}" else ""

    /**
     * [item] starts ([at] when it was set for; the item may have moved since). Its reminders from before
     * the start are over: their notifications, snoozes and notices go, and an alarm put off past the start
     * won't ring. Reminders set for after the start (negative offsets) are left alone: they're still to come.
     * Then a gentle "Starting now", unless something of its own rings at the start.
     */
    private fun handleStart(context: Context, item: Item, day: Long, at: Long) {
        if (item.deletedAt != null || item.allDay || item.startMin == null) return
        val settings = Mirror.settings(context)
        val start = AlarmScheduler.originalAt(item, day.toDate(), 0, settings.defaultTaskTime)
        val now = System.currentTimeMillis()
        // Moved later since this was set: wait for the new start (moved earlier: it has started already).
        if (start != at && start > now) { AlarmScheduler.scheduleStart(context, item, day); return }
        val reminders = Mirror.current(context).reminders.filter { it.itemId == item.id }
        for (r in reminders.filter { it.offsetMin > 0 }) {
            for (kind in listOf(Shown.NOTIFICATION, Shown.SNOOZE, Shown.UPCOMING)) {
                if (Shown.get(context, kind, r.id)?.day == day) Shown.takeBack(context, kind, r.id)
            }
            if (r.type == AlertType.ALARM) {
                val original = start - r.offsetMin * 60_000L
                val ringsAt = AlarmOverrides.adjusted(context, r.id, original)
                if (ringsAt != null && ringsAt > start) {
                    AlarmOverrides.stop(context, r.id, original)
                    AlarmScheduler.scheduleItem(context, item, listOf(r))
                }
            }
        }
        if (start < now - 10 * 60_000L) return // long started (the phone was off): no "now"
        val done = Mirror.doneDays(context, item.id)
        if (!AlarmScheduler.startingNow(item, reminders, day, done)) return
        val quiet = settings.quietHoursEnabled && inQuietHours(settings.quietStart, settings.quietEnd)
        Notifications.showStarting(context, item, day, quiet)
    }

    private fun inQuietHours(start: Int, end: Int): Boolean {
        val now = LocalTime.now().let { it.hour * 60 + it.minute }
        return if (start <= end) now in start until end else now >= start || now < end
    }
}
