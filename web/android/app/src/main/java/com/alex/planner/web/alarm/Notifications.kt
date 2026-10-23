package com.alex.planner.web.alarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.alex.planner.web.MainActivity
import com.alex.planner.web.R

/** Copied from the native app's Notifications (same channels, texts and buttons). */
object Notifications {
    const val CH_NOTIFY = "notifications"
    const val CH_REMIND = "reminders"
    const val CH_QUIET = "quiet"
    const val CH_ALARM = "alarms"
    const val CH_UPCOMING = "upcoming"
    const val CH_TIMER = "timers"
    /** "Starting now" when an item starts: pops up, but without a sound. */
    const val CH_STARTING = "starting"
    private const val TAG_UPCOMING = "upcoming"
    private const val TAG_STARTING = "starting"

    const val EXTRA_OPEN_ITEM = "openItemId"
    /** Opens a section of the Alarms page ("alarm", "timer"...). */
    const val EXTRA_OPEN_SECTION = "openAlarmSection"

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CH_NOTIFY, "Notifications (silent)", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Quiet entries in the notification shade"
                },
                NotificationChannel(CH_REMIND, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Pop-up reminders with sound and snooze"
                    enableVibration(true)
                    setSound(
                        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).build(),
                    )
                },
                NotificationChannel(CH_QUIET, "Reminders during quiet hours", NotificationManager.IMPORTANCE_LOW),
                NotificationChannel(CH_ALARM, "Alarms", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Full-screen ringing alarms"
                    setSound(null, null)
                    enableVibration(false)
                    setBypassDnd(true)
                },
                // The countdown while a timer runs; the ringing itself goes through the alarm channel.
                NotificationChannel(CH_TIMER, "Timers", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Time left on running timers"
                    setSound(null, null)
                    enableVibration(false)
                },
                NotificationChannel(CH_STARTING, "Starting now", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "When a task or event that had a reminder starts; pops up quietly while you use the phone"
                    setSound(null, null)
                    enableVibration(false)
                },
                // Default importance (but silent) so Snooze / Stop show without expanding the notification.
                NotificationChannel(CH_UPCOMING, "Upcoming alarms", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Shown 2 hours before an alarm, to snooze or stop it early"
                    setSound(null, null)
                    enableVibration(false)
                },
            )
        )
    }

    fun openItemIntent(context: Context, itemId: Long): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_OPEN_ITEM, itemId)
        }
        return PendingIntent.getActivity(
            context, smallId(itemId), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Opens the app on the Alarms page, at [section]. */
    fun openSectionIntent(context: Context, section: String, code: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_OPEN_SECTION, section)
        }
        return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun show(
        context: Context,
        item: Item,
        reminderId: Long,
        day: Long,
        type: AlertType,
        text: String,
        quiet: Boolean,
        snoozeMinutes: Int,
    ) {
        val channel = when {
            type == AlertType.NOTIFICATION -> CH_NOTIFY
            quiet -> CH_QUIET
            else -> CH_REMIND
        }
        val b = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(item.title.ifBlank { "Untitled" })
            .setContentText(text)
            .setContentIntent(openItemIntent(context, item.id))
            .setAutoCancel(true)
            .setCategory(if (item.type == ItemType.EVENT) NotificationCompat.CATEGORY_EVENT else NotificationCompat.CATEGORY_REMINDER)
            .setPriority(if (type == AlertType.NOTIFICATION || quiet) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_HIGH)
        if (type == AlertType.REMINDER) {
            b.addAction(0, "Snooze ${snoozeMinutes}m", actionIntent(context, AlarmReceiver.ACTION_SNOOZE, item.id, reminderId, day))
        }
        if (item.type == ItemType.TASK) {
            b.addAction(0, "Done", actionIntent(context, AlarmReceiver.ACTION_DONE, item.id, reminderId, day))
        }
        notify(context, smallId(reminderId), b)
    }

    /** The quiet notice before an alarm: when it will ring, with Snooze and Stop buttons. */
    fun showUpcoming(context: Context, item: Item, reminderId: Long, day: Long, at: Long, original: Long, snoozed: Boolean, snoozeMinutes: Int) {
        val time = java.time.Instant.ofEpochMilli(at).atZone(java.time.ZoneId.systemDefault()).toLocalDateTime()
        val whenText = relativeDayLabel(time.toLocalDate()) + " at " + formatTime(time.hour * 60 + time.minute)
        val b = NotificationCompat.Builder(context, CH_UPCOMING)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Upcoming alarm · ${item.title.ifBlank { "Untitled" }}")
            .setContentText(if (snoozed) "Snoozed to $whenText" else whenText)
            .setContentIntent(openItemIntent(context, item.id))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setWhen(at)
            .setShowWhen(true)
        // Within 15 minutes of ringing, the alarm can only be stopped.
        if (AlarmScheduler.canSnoozeEarly(at)) {
            b.addAction(0, "Snooze ${snoozeMinutes}m", actionIntent(context, AlarmReceiver.ACTION_EARLY_SNOOZE, item.id, reminderId, day, original))
        }
        b.addAction(0, "Stop", actionIntent(context, AlarmReceiver.ACTION_EARLY_STOP, item.id, reminderId, day, original))
        val nm = NotificationManagerCompat.from(context)
        if (nm.areNotificationsEnabled()) {
            try {
                nm.notify(TAG_UPCOMING, smallId(reminderId), b.build())
                Shown.put(context, Shown.UPCOMING, reminderId, day, original)
            } catch (_: SecurityException) {
            }
        }
    }

    fun cancelUpcoming(context: Context, reminderId: Long) =
        NotificationManagerCompat.from(context).cancel(TAG_UPCOMING, smallId(reminderId))

    /**
     * "Starting now" for [item]: a quiet pop-up while the phone is in use, otherwise (locked, screen off, or
     * quiet hours) a plain entry in the shade. Goes by itself after a while.
     */
    fun showStarting(context: Context, item: Item, day: Long, quiet: Boolean) {
        val power = context.getSystemService(android.os.PowerManager::class.java)
        val keyguard = context.getSystemService(android.app.KeyguardManager::class.java)
        val inUse = power?.isInteractive == true && keyguard?.isKeyguardLocked != true
        val popUp = inUse && !quiet
        val start = item.startMin ?: return
        val b = NotificationCompat.Builder(context, if (popUp) CH_STARTING else CH_NOTIFY)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(item.title.ifBlank { "Untitled" })
            .setContentText("Starting now · ${formatTime(start)}")
            .setContentIntent(openItemIntent(context, item.id))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(STARTING_SHOWN_MS)
            .setCategory(if (item.type == ItemType.EVENT) NotificationCompat.CATEGORY_EVENT else NotificationCompat.CATEGORY_REMINDER)
            .setPriority(if (popUp) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_LOW)
        if (item.type == ItemType.TASK) {
            b.addAction(0, "Done", actionIntent(context, AlarmReceiver.ACTION_DONE, item.id, 0L, day, key = "start-${item.id}"))
        }
        val nm = NotificationManagerCompat.from(context)
        if (nm.areNotificationsEnabled()) {
            try {
                nm.notify(TAG_STARTING, smallId(item.id), b.build())
            } catch (_: SecurityException) {
            }
        }
    }

    /** How long "Starting now" stays in the shade. */
    private const val STARTING_SHOWN_MS = 30 * 60_000L

    fun cancelStarting(context: Context, itemId: Long) =
        NotificationManagerCompat.from(context).cancel(TAG_STARTING, smallId(itemId))

    /** [key] tells the buttons' intents apart (by default the reminder; "Starting now" has none). */
    fun actionIntent(context: Context, action: String, itemId: Long, reminderId: Long, day: Long, original: Long = 0L, key: String = reminderId.toString()): PendingIntent {
        val i = Intent(context, AlarmReceiver::class.java).apply {
            this.action = action
            data = Uri.parse("planner-alarm://action/$key/${action.substringAfterLast('.')}")
            putExtra(AlarmReceiver.EXTRA_ITEM, itemId)
            putExtra(AlarmReceiver.EXTRA_REMINDER, reminderId)
            putExtra(AlarmReceiver.EXTRA_DAY, day)
            putExtra(AlarmReceiver.EXTRA_ORIGINAL, original)
        }
        return PendingIntent.getBroadcast(context, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun notify(context: Context, id: Int, b: NotificationCompat.Builder) {
        val nm = NotificationManagerCompat.from(context)
        if (nm.areNotificationsEnabled()) {
            try {
                nm.notify(id, b.build())
            } catch (_: SecurityException) {
            }
        }
    }

    fun cancel(context: Context, id: Int) = NotificationManagerCompat.from(context).cancel(id)
}
