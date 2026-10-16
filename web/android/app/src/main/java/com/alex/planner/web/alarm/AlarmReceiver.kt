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
            if (!snoozed) {
                if (!alarm.enabled) return
                ClockAlarms.afterRing(context, id)
            }
            val svc = Intent(context, AlarmService::class.java).apply {
                putExtra(ClockAlarms.EXTRA_CLOCK, id)
                putExtra(AlarmService.EXTRA_TEXT, if (snoozed) "Snoozed" else alarm.label)
                putExtra(AlarmService.EXTRA_SOUND, alarm.sound ?: Mirror.settings(context).defaultAlarmSound)
            }
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
        fun isDone() = item.type == ItemType.TASK && completionDay in Mirror.doneDays(context, item.id)

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
                Notifications.showUpcoming(context, item, reminder.id, day, later, original, snoozed = true, settings.snoozeMinutes)
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
            }
            ACTION_SNOOZE -> {
                Notifications.cancel(context, smallId(reminderId))
                if (reminder != null) AlarmScheduler.snooze(context, item, reminder, day, settings.snoozeMinutes)
            }
            ACTION_FIRE -> {
                Notifications.cancelUpcoming(context, reminderId)
                val snoozed = intent.getBooleanExtra(EXTRA_SNOOZE, false)
                if (snoozed) AlarmOverrides.clearRingSnooze(context, reminderId)
                if (reminder == null || item.deletedAt != null) return
                // The original app rings these while it's on this phone (see RingDevice).
                if (!RingDevice.ringsEvents(context)) return
                if (!isDone()) {
                    val text = describe(item.startMin, item.allDay, day, reminder.offsetMin, snoozed)
                    if (reminder.type == AlertType.ALARM) {
                        val svc = Intent(context, AlarmService::class.java).apply {
                            putExtra(EXTRA_ITEM, item.id)
                            putExtra(EXTRA_REMINDER, reminder.id)
                            putExtra(EXTRA_DAY, day)
                            putExtra(AlarmService.EXTRA_TEXT, text)
                            putExtra(AlarmService.EXTRA_SOUND, reminder.soundUri ?: settings.defaultAlarmSound)
                        }
                        ContextCompat.startForegroundService(context, svc)
                    } else {
                        val quiet = settings.quietHoursEnabled && inQuietHours(settings.quietStart, settings.quietEnd)
                        Notifications.show(context, item, reminder.id, day, reminder.type, text, quiet, settings.snoozeMinutes)
                    }
                }
                // Queue the next occurrence of this reminder (snoozes are one-offs).
                if (!snoozed) AlarmScheduler.scheduleItem(context, item, listOf(reminder))
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
                ContextCompat.startForegroundService(context, svc)
            }
        }
    }

    private fun describe(startMin: Int?, allDay: Boolean, day: Long, offset: Int, snoozed: Boolean): String {
        val whenText = relativeDayLabel(day.toDate()) + if (!allDay && startMin != null) " at ${formatTime(startMin)}" else ""
        return when {
            snoozed -> "Snoozed · $whenText"
            offset == 0 -> whenText
            else -> "${offsetLabel(offset)} · $whenText"
        }
    }

    private fun inQuietHours(start: Int, end: Int): Boolean {
        val now = LocalTime.now().let { it.hour * 60 + it.minute }
        return if (start <= end) now in start until end else now >= start || now < end
    }
}
