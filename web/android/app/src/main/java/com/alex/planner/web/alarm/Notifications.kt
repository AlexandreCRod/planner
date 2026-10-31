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
                NotificationChannel(CH_UPCOMING, "Coming up", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Planner's card: what's coming up in the next 2 hours, without a sound"
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

    /** The line for a reminder that came due (Card): a pop-up unless it's silent or [quiet]. */
    fun show(context: Context, item: Item, r: Reminder, day: Long, original: Long, quiet: Boolean) = Card.fired(context, item, r, day, original, quiet)

    /** The line for what's coming, 2 hours before (Card). */
    fun showUpcoming(context: Context, item: Item, r: Reminder, day: Long, at: Long, original: Long, snoozed: Boolean) {
        Card.notice(context, item, r, day, at, original, snoozed)
        Shown.put(context, Shown.UPCOMING, r.id, day, original)
    }

    fun cancelUpcoming(context: Context, reminderId: Long) = Card.dropUpcoming(context, reminderId)

    fun clockActionIntent(context: Context, action: String, id: Long, at: Long): PendingIntent {
        val i = Intent(context, AlarmReceiver::class.java).apply {
            this.action = action
            data = Uri.parse("planner-alarm://clock/$id/${action.substringAfterLast('.')}")
            putExtra(ClockAlarms.EXTRA_CLOCK, id)
            putExtra(AlarmReceiver.EXTRA_AT, at)
        }
        return PendingIntent.getBroadcast(context, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /**
     * [item] starts: its line says so, as a quiet pop-up while the phone is in use and otherwise (locked,
     * screen off, or quiet hours) silently. [show]: a line appears even if it had none.
     */
    fun showStarting(context: Context, item: Item, day: Long, quiet: Boolean, show: Boolean) {
        val power = context.getSystemService(android.os.PowerManager::class.java)
        val keyguard = context.getSystemService(android.app.KeyguardManager::class.java)
        val inUse = power?.isInteractive == true && keyguard?.isKeyguardLocked != true
        Card.started(context, item, day, show, popUp = show && inUse && !quiet)
    }

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

    /** A timer's or a missed alarm's notification, in the card's group, sorted by [at] (218). */
    fun notify(context: Context, id: Int, b: NotificationCompat.Builder, at: Long = System.currentTimeMillis()) {
        val nm = NotificationManagerCompat.from(context)
        if (nm.areNotificationsEnabled()) {
            try {
                Card.join(context, b, at)
                nm.notify(id, b.build())
            } catch (_: SecurityException) {
            }
            Card.refresh(context)
        }
    }

    fun cancel(context: Context, id: Int) {
        NotificationManagerCompat.from(context).cancel(id)
        Card.refresh(context)
    }
}
