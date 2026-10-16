package com.alex.planner.web.alarm

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.alex.planner.web.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Rings an alarm on the alarm audio stream (audible in silent mode) until dismissed or snoozed,
 * showing [AlarmActivity] full screen. Gives up after [TIMEOUT_MS] and leaves a missed-alarm notice.
 * (Copied from the native app's AlarmService.)
 */
class AlarmService : Service() {
    companion object {
        const val EXTRA_TEXT = "text"
        const val EXTRA_SOUND = "sound"
        const val ACTION_DISMISS = "com.alex.planner.web.ALARM_DISMISS"
        const val ACTION_SNOOZE = "com.alex.planner.web.ALARM_SNOOZE"
        const val ACTION_COMPLETE = "com.alex.planner.web.ALARM_COMPLETE"
        private const val NOTIF_ID = 777_000
        private const val TIMEOUT_MS = 5 * 60_000L

        fun stopIntent(context: Context, action: String) =
            PendingIntent.getService(
                context, action.hashCode(), Intent(context, AlarmService::class.java).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
    }

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private var itemId = 0L
    private var reminderId = 0L
    private var day = 0L
    private var title = ""
    /** Set when a clock alarm (Alarms page) is ringing rather than a task or event's alarm. */
    private var clockId = 0L
    /** Set when a timer (Alarms page) is up. */
    private var timerId = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_DISMISS -> { finishAlarm(); return START_NOT_STICKY }
            ACTION_SNOOZE -> { snoozeAndStop(); return START_NOT_STICKY }
            ACTION_COMPLETE -> { completeAndStop(); return START_NOT_STICKY }
        }
        stopRinging()
        itemId = intent?.getLongExtra(AlarmReceiver.EXTRA_ITEM, 0) ?: 0
        reminderId = intent?.getLongExtra(AlarmReceiver.EXTRA_REMINDER, 0) ?: 0
        day = intent?.getLongExtra(AlarmReceiver.EXTRA_DAY, 0) ?: 0
        clockId = intent?.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0) ?: 0
        timerId = intent?.getLongExtra(ClockTools.EXTRA_TIMER, 0) ?: 0
        val text = intent?.getStringExtra(EXTRA_TEXT).orEmpty()
        val sound = intent?.getStringExtra(EXTRA_SOUND)

        val clock = if (clockId != 0L) ClockAlarms.get(this, clockId) else null
        title = when {
            timerId != 0L -> "Time's up"
            clockId != 0L -> "Alarm"
            else -> Mirror.item(this, itemId)?.title?.ifBlank { "Alarm" } ?: "Alarm"
        }
        val full = Intent(this, AlarmActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            putExtra(AlarmActivity.EXTRA_TITLE, title)
            putExtra(AlarmActivity.EXTRA_TEXT, text)
            putExtra(AlarmReceiver.EXTRA_ITEM, itemId)
            putExtra(ClockAlarms.EXTRA_CLOCK, clockId)
            putExtra(ClockTools.EXTRA_TIMER, timerId)
            putExtra(AlarmActivity.EXTRA_COLOR, clock?.color ?: -1)
        }
        val fullPi = PendingIntent.getActivity(this, 0, full, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, Notifications.CH_ALARM)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setFullScreenIntent(fullPi, true)
            .setContentIntent(fullPi)
            .addAction(0, "Dismiss", stopIntent(this, ACTION_DISMISS))
            .addAction(0, if (timerId != 0L) "+1 min" else "Snooze", stopIntent(this, ACTION_SNOOZE))
            .build()
        // Started from the foreground-service start the receiver made, so this must come straight away.
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
        ServiceCompat.startForeground(this, NOTIF_ID, notification, type)
        startRinging(sound)
        handler.postDelayed({ timeout(text) }, TIMEOUT_MS)
        return START_NOT_STICKY
    }

    private fun startRinging(sound: String?) {
        val fallback = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        // A chosen sound that can't be played (deleted, or from an app that's gone) falls back to the default.
        player = (sound?.let(Uri::parse)?.let(::play) ?: fallback?.let(::play))

        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION") getSystemService(Vibrator::class.java)
        }
        vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 600), 0))
    }

    private fun play(uri: Uri): MediaPlayer? = runCatching {
        MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            setDataSource(this@AlarmService, uri)
            isLooping = true
            prepare()
            start()
        }
    }.getOrNull()

    private fun stopRinging() {
        handler.removeCallbacksAndMessages(null)
        player?.runCatching { stop(); release() }
        player = null
        vibrator?.cancel()
    }

    private fun timeout(text: String) {
        stopRinging()
        val b = NotificationCompat.Builder(this, Notifications.CH_REMIND)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Missed alarm: $title")
            .setContentText(text)
            .setContentIntent(if (itemId != 0L) Notifications.openItemIntent(this, itemId) else Notifications.openSectionIntent(this, if (timerId != 0L) "timer" else "alarm", 4))
            .setAutoCancel(true)
        Notifications.notify(this, if (reminderId != 0L) smallId(reminderId) else 777_001, b)
        finishAlarm()
    }

    private fun snoozeAndStop() {
        val ctx = applicationContext
        val (i, r, d) = Triple(itemId, reminderId, day)
        val clock = clockId
        val timer = timerId
        CoroutineScope(Dispatchers.IO).launch {
            // A timer's "snooze" gives it one more minute.
            if (timer != 0L) {
                ClockTools.timer(ctx, timer)?.let { t ->
                    val now = System.currentTimeMillis()
                    ClockTools.saveTimer(ctx, t.copy(remainingMs = 60_000, endAt = null).start(now))
                }
                return@launch
            }
            if (clock != 0L) {
                ClockAlarms.snooze(ctx, clock, Mirror.settings(ctx).snoozeMinutes)
                return@launch
            }
            val item = Mirror.item(ctx, i)
            val reminder = Mirror.reminder(ctx, r)
            if (item != null && reminder != null) {
                AlarmScheduler.snooze(ctx, item, reminder, d, Mirror.settings(ctx).snoozeMinutes)
            }
        }
        finishAlarm()
    }

    private fun completeAndStop() {
        val ctx = applicationContext
        val (i, d) = itemId to day
        CoroutineScope(Dispatchers.IO).launch {
            val item = Mirror.item(ctx, i) ?: return@launch
            Mirror.markDone(ctx, i, if (item.isRecurring) d else (item.startDay ?: d))
        }
        finishAlarm()
    }

    private fun finishAlarm() {
        stopRinging()
        sendBroadcast(Intent(AlarmActivity.ACTION_CLOSE).setPackage(packageName))
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopRinging()
        super.onDestroy()
    }
}
