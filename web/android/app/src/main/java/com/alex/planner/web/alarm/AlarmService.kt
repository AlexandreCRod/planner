package com.alex.planner.web.alarm

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.media.VolumeProvider
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationAttributes
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
 * Rings an alarm on the alarm audio stream (audible in silent and vibrate mode) until stopped or snoozed,
 * showing [AlarmActivity] full screen. It can always be stopped: Stop on the screen and in the
 * notification, a volume button (on the screen, and through a media session while only the notification
 * shows), swiping the notification away, or the item's own window ([ringing], AlarmPlugin.stopRinging).
 * Gives up after the minutes set in Settings ([AlarmSettings.alarmRingMinutes] for events and tasks,
 * [AlarmSettings.clockRingMinutes] for clock alarms and timers) and leaves a missed-alarm notice.
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

        /** What's ringing now (ids are 0 when not that kind), for the page's item window. */
        data class Ringing(val itemId: Long, val reminderId: Long, val day: Long, val clockId: Long, val timerId: Long)

        @Volatile var ringing: Ringing? = null
            private set

        /** How long it rings before it stops by itself, from Settings. */
        fun ringMillis(settings: AlarmSettings, clockOrTimer: Boolean): Long =
            (if (clockOrTimer) settings.clockRingMinutes else settings.alarmRingMinutes).coerceIn(1, 60) * 60_000L

        fun stopIntent(context: Context, action: String) =
            PendingIntent.getService(
                context, action.hashCode(), Intent(context, AlarmService::class.java).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
    }

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var session: MediaSession? = null
    private var focus: AudioFocusRequest? = null
    private val handler = Handler(Looper.getMainLooper())
    private var itemId = 0L
    private var reminderId = 0L
    private var day = 0L
    private var original = 0L
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
        original = intent?.getLongExtra(AlarmReceiver.EXTRA_ORIGINAL, 0) ?: 0
        clockId = intent?.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0) ?: 0
        timerId = intent?.getLongExtra(ClockTools.EXTRA_TIMER, 0) ?: 0
        val text = intent?.getStringExtra(EXTRA_TEXT).orEmpty()
        val sound = intent?.getStringExtra(EXTRA_SOUND)

        val clock = if (clockId != 0L) ClockAlarms.get(this, clockId) else null
        title = when {
            timerId != 0L -> "Time's up"
            clockId != 0L -> clock?.label?.trim()?.ifBlank { null } ?: "Alarm"
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
            .addAction(0, "Stop", stopIntent(this, ACTION_DISMISS))
            .addAction(0, if (timerId != 0L) "+1 min" else "Snooze", stopIntent(this, ACTION_SNOOZE))
            // Newer Androids let a ringing alarm's notification be swiped away: that stops it, so it
            // never rings on with nothing left to stop it with.
            .setDeleteIntent(stopIntent(this, ACTION_DISMISS))
            .build()
        // Started from the foreground-service start the receiver made, so this must come straight away.
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
        ServiceCompat.startForeground(this, NOTIF_ID, notification, type)
        startRinging(sound)
        listenToVolumeKeys()
        handler.postDelayed({ timeout(text) }, ringMillis(Mirror.settings(this), clockId != 0L || timerId != 0L))
        ringing = Ringing(itemId, reminderId, day, clockId, timerId)
        AlarmEvents.changed("ringing")
        return START_NOT_STICKY
    }

    /**
     * A volume button stops it while only the notification shows (the full screen handles its own keys):
     * an active media session with its own volume control takes the presses.
     */
    private fun listenToVolumeKeys() {
        session = runCatching {
            MediaSession(this, "PlannerAlarm").apply {
                setPlaybackToRemote(object : VolumeProvider(VOLUME_CONTROL_RELATIVE, 10, 5) {
                    override fun onAdjustVolume(direction: Int) {
                        if (direction != 0) handler.post { finishAlarm() }
                    }
                })
                setPlaybackState(PlaybackState.Builder().setState(PlaybackState.STATE_PLAYING, 0, 1f).build())
                isActive = true
            }
        }.getOrNull()
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
        // As an alarm, so it buzzes in silent mode too.
        val wave = VibrationEffect.createWaveform(longArrayOf(0, 800, 600), 0)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator?.vibrate(wave, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        } else {
            @Suppress("DEPRECATION") vibrator?.vibrate(wave, alarmAudio)
        }
    }

    /** The alarm stream: it plays at alarm volume whatever the ringer mode (silent, vibrate). */
    private val alarmAudio: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .setLegacyStreamType(AudioManager.STREAM_ALARM)
        .build()

    private fun play(uri: Uri): MediaPlayer? = runCatching {
        if (focus == null) {
            // Other sound (music, a video) pauses while it rings.
            focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(alarmAudio).build()
                .also { getSystemService(AudioManager::class.java)?.requestAudioFocus(it) }
        }
        MediaPlayer().apply {
            setAudioAttributes(alarmAudio)
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
        session?.runCatching { isActive = false; release() }
        session = null
        focus?.let { f -> getSystemService(AudioManager::class.java)?.runCatching { abandonAudioFocusRequest(f) } }
        focus = null
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
        val o = original
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
                AlarmScheduler.snooze(ctx, item, reminder, d, Mirror.settings(ctx).snoozeMinutes, o)
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
            // Its other reminders for that day go too.
            AlarmScheduler.refreshItem(ctx, i)
        }
        finishAlarm()
    }

    private fun finishAlarm() {
        stopRinging()
        if (ringing != null) { ringing = null; AlarmEvents.changed("ringing") }
        sendBroadcast(Intent(AlarmActivity.ACTION_CLOSE).setPackage(packageName))
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopRinging()
        if (ringing != null) { ringing = null; AlarmEvents.changed("ringing") }
        super.onDestroy()
    }
}
