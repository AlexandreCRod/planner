package com.alex.planner.web.alarm

import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
import android.os.SystemClock
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.alex.planner.web.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Rings an alarm on the alarm audio stream (audible in silent and vibrate mode) until stopped or snoozed,
 * showing [AlarmActivity] full screen. It can always be stopped: Stop on the screen and in the
 * notification, a volume button (on the screen, and while only the notification shows: see
 * [listenToVolumeKeys]), swiping the notification away (its delete intent, and [watchNotification]), or the item's own window ([ringing], AlarmPlugin.stopRinging).
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
        /** When it began ringing (a restart after the app was killed carries on from then). */
        const val EXTRA_STARTED = "startedAt"
        private const val NOTIF_ID = 777_000
        private const val NOTIFICATION_CHECK_MS = 1_000L

        /** What's ringing now (ids are 0 when not that kind), for the page's item window. */
        data class Ringing(val itemId: Long, val reminderId: Long, val day: Long, val clockId: Long, val timerId: Long)

        @Volatile var ringing: Ringing? = null
            private set

        /** How long it rings before it stops by itself, from Settings. */
        fun ringMillis(settings: AlarmSettings, clockOrTimer: Boolean): Long =
            (if (clockOrTimer) settings.clockRingMinutes else settings.alarmRingMinutes).coerceIn(1, 60) * 60_000L

        /** Whether it rings as long as a clock alarm: clock alarms (a series can choose less: 244), timers and wake-up alarms (245). */
        fun ringsLong(clockId: Long, timerId: Long, clock: ClockAlarm?, reminder: Reminder?) =
            timerId != 0L || (clockId != 0L && clock?.shortRing != true) || reminder?.wake == true

        fun stopIntent(context: Context, action: String) =
            PendingIntent.getService(
                context, action.hashCode(), Intent(context, AlarmService::class.java).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
    }

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var session: MediaSession? = null
    /** The fallback session on the media stream, and what [listenToVolumeKeys] did to that stream. */
    private var localSession: MediaSession? = null
    private var volumeReceiver: BroadcastReceiver? = null
    private var musicWas = -1
    private var musicSet = -1
    private var listeningSince = 0L
    private var focus: AudioFocusRequest? = null
    private val handler = Handler(Looper.getMainLooper())
    private var itemId = 0L
    private var reminderId = 0L
    private var day = 0L
    private var original = 0L
    private var title = ""
    private var ringText = ""
    /** Set when a clock alarm (Alarms page) is ringing rather than a task or event's alarm. */
    private var clockId = 0L
    /** Set when a timer (Alarms page) is up. */
    private var timerId = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(startIntent: Intent?, flags: Int, startId: Int): Int {
        // Restarted by Android after the app was killed while it rang (194): carry on from what was saved.
        var intent = startIntent
        if (intent == null) {
            val saved = RingState.load(this) ?: run { stopSelf(); return START_NOT_STICKY }
            val long = ringsLong(saved.clockId, saved.timerId, ClockAlarms.get(this, saved.clockId), Mirror.reminder(this, saved.reminderId))
            val left = RingState.left(saved.startedAt, ringMillis(Mirror.settings(this), long), System.currentTimeMillis())
            if (left <= 0L) {
                itemId = saved.itemId; reminderId = saved.reminderId; clockId = saved.clockId; timerId = saved.timerId; ringText = saved.text
                title = titleFor(if (clockId != 0L) ClockAlarms.get(this, clockId) else null)
                missedNotice()
                RingState.clear(this)
                stopSelf()
                return START_NOT_STICKY
            }
            intent = saved.intent(this)
        }
        when (intent.action) {
            ACTION_DISMISS -> { finishAlarm(); return START_NOT_STICKY }
            ACTION_SNOOZE -> { snoozeAndStop(); return START_NOT_STICKY }
            ACTION_COMPLETE -> {
                // Only for the item the screen showed: if another alarm took over meanwhile, nothing is ticked.
                val shown = intent.getLongExtra(AlarmReceiver.EXTRA_ITEM, itemId)
                if (shown == itemId) completeAndStop()
                return START_NOT_STICKY
            }
        }
        // A second alarm while one rings (194): the first isn't silently replaced, it gets a missed notice,
        // and the ringing screen moves on to the new one (AlarmActivity.onNewIntent).
        val takeover = ringing != null
        // The next alarm of a series, or of an event's wake-up alarms, taking over isn't a missed alarm: it's the same wake-up.
        if (takeover && !sameWakeUp(intent)) missedNotice()
        stopRinging()
        itemId = intent.getLongExtra(AlarmReceiver.EXTRA_ITEM, 0)
        reminderId = intent.getLongExtra(AlarmReceiver.EXTRA_REMINDER, 0)
        day = intent.getLongExtra(AlarmReceiver.EXTRA_DAY, 0)
        original = intent.getLongExtra(AlarmReceiver.EXTRA_ORIGINAL, 0)
        clockId = intent.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0)
        timerId = intent.getLongExtra(ClockTools.EXTRA_TIMER, 0)
        val text = intent.getStringExtra(EXTRA_TEXT).orEmpty()
        ringText = text
        val sound = intent.getStringExtra(EXTRA_SOUND)
        val now = System.currentTimeMillis()
        val startedAt = intent.getLongExtra(EXTRA_STARTED, now)

        val clock = if (clockId != 0L) ClockAlarms.get(this, clockId) else null
        title = titleFor(clock)
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
            // Not marked ongoing (295): Android keeps a foreground service's notification out of "Clear all"
            // anyway, and a phone's own shade may refuse the swipe on an ongoing one.
            .setFullScreenIntent(fullPi, true)
            .setContentIntent(fullPi)
            .addAction(0, "Stop", stopIntent(this, ACTION_DISMISS))
            .addAction(0, if (timerId != 0L) "+1 min" else "Snooze", stopIntent(this, ACTION_SNOOZE))
            // Newer Androids let a ringing alarm's notification be swiped away: that stops it, so it
            // never rings on with nothing left to stop it with.
            .setDeleteIntent(stopIntent(this, ACTION_DISMISS))
            .also { Card.ringingStyle(this, it, title) }
            .build()
        // Started from the foreground-service start the receiver made, so this must come straight away.
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
        val started = runCatching { ServiceCompat.startForeground(this, NOTIF_ID, notification, type) }.isSuccess
        if (!started) {
            // Android refused (a restart from the background on a newer Android): it can't ring, so say so.
            missedNotice()
            RingState.clear(this)
            RingWakeLock.release()
            stopSelf()
            return START_NOT_STICKY
        }
        // The ringing screen, when it's showing, shows the new alarm at once (the full-screen intent
        // only opens it the first time).
        if (takeover && AlarmActivity.showing) runCatching { startActivity(full) }
        startRinging(sound)
        listenToVolumeKeys()
        watchNotification()
        val ringMs = ringMillis(Mirror.settings(this), ringsLong(clockId, timerId, clock, Mirror.reminder(this, reminderId)))
        handler.postDelayed({ timeout() }, RingState.left(startedAt, ringMs, now).coerceAtLeast(1_000))
        // Awake while it rings (the receiver's hold covered the start), and saved in case the app is killed.
        RingWakeLock.acquire(this, ringMs + 30_000)
        RingState.save(this, RingState.Saved(itemId, reminderId, day, original, clockId, timerId, text, sound, startedAt))
        ringing = Ringing(itemId, reminderId, day, clockId, timerId)
        AlarmEvents.changed("ringing")
        redrawCard()
        return START_STICKY
    }

    /** Whether [next] is the next alarm of the series or wake-up alarms ringing now (244, 245). */
    private fun sameWakeUp(next: Intent): Boolean {
        val series = ClockAlarms.get(this, clockId)?.series
        if (series != null) return ClockAlarms.get(this, next.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0))?.series == series
        val other = Mirror.reminder(this, next.getLongExtra(AlarmReceiver.EXTRA_REMINDER, 0))
        return other?.wake == true && other.itemId == itemId && Mirror.reminder(this, reminderId)?.wake == true
    }

    /**
     * The safety net for a swipe (295). The notification's delete intent is how a swipe arrives, but it's
     * one intent, and a phone's battery rules can drop it: then the card is gone and nothing is left to stop
     * the sound with. So while it rings, the notification being gone also stops it. It must have shown first
     * (with notifications blocked it never does, and the alarm must still ring), and be missing twice in a
     * row, so a moment's doubt can't silence an alarm; an error while checking counts as still there.
     */
    private fun watchNotification() {
        var seen = false
        var missing = 0
        lateinit var check: Runnable
        check = Runnable {
            val shown = runCatching { getSystemService(NotificationManager::class.java).activeNotifications.any { it.id == NOTIF_ID } }.getOrDefault(true)
            if (shown) { seen = true; missing = 0 } else if (seen) missing++
            if (missing >= 2) finishAlarm() else handler.postDelayed(check, NOTIFICATION_CHECK_MS)
        }
        handler.postDelayed(check, NOTIFICATION_CHECK_MS)
    }

    /**
     * A volume button stops it while only the notification shows, screen on or off (the full screen
     * handles its own keys). Three layers, as phones route the buttons differently:
     * - A media session with its own (remote) volume control takes the presses where Android lets it.
     *   Pixels (Android 13+) don't: a remote session without a cast route gets no volume keys at all,
     *   which is how both buttons stopped working there (103's regression).
     * - Under it, a session playing on the media stream: the buttons then move the media volume.
     * - Any volume change while it rings stops it (VOLUME_CHANGED_ACTION). A button at the end of its
     *   range changes nothing and sends nothing (volume-down at 0, the usual media volume), so the media
     *   stream is put one step off its ends while it rings (other sound is paused by the audio focus)
     *   and set back when it stops.
     */
    private fun listenToVolumeKeys() {
        listeningSince = SystemClock.uptimeMillis()
        val audio = getSystemService(AudioManager::class.java)
        if (audio != null && !audio.isVolumeFixed) runCatching {
            val stream = AudioManager.STREAM_MUSIC
            val now = audio.getStreamVolume(stream)
            val min = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) audio.getStreamMinVolume(stream) else 0
            val max = audio.getStreamMaxVolume(stream)
            val target = VolumeKeys.nudgeTarget(now, min, max)
            musicWas = now
            if (target != now && target in min..max) {
                audio.setStreamVolume(stream, target, 0)
                musicSet = target
            }
        }
        volumeReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val stream = intent.getIntExtra("android.media.EXTRA_VOLUME_STREAM_TYPE", -1)
                val value = intent.getIntExtra("android.media.EXTRA_VOLUME_STREAM_VALUE", -1)
                val prev = intent.getIntExtra("android.media.EXTRA_PREV_VOLUME_STREAM_VALUE", -1)
                // Not our own nudge of the media stream (its broadcast can arrive after this is registered), and
                // not a late broadcast from the previous alarm setting the media volume back, when a new alarm
                // took over while one was ringing (VolumeKeys.changeStops).
                if (VolumeKeys.changeStops(stream, value, prev, musicSet, musicWas, SystemClock.uptimeMillis() - listeningSince)) handler.post { finishAlarm() }
            }
        }.also {
            ContextCompat.registerReceiver(this, it, IntentFilter("android.media.VOLUME_CHANGED_ACTION"), ContextCompat.RECEIVER_NOT_EXPORTED)
        }
        // The fallback first: the session made last is the one Android asks first.
        localSession = runCatching {
            MediaSession(this, "PlannerAlarmKeys").apply {
                setCallback(object : MediaSession.Callback() {}, handler)
                setPlaybackToLocal(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                setPlaybackState(PlaybackState.Builder().setState(PlaybackState.STATE_PLAYING, 0, 1f).build())
                isActive = true
            }
        }.getOrNull()
        session = runCatching {
            MediaSession(this, "PlannerAlarm").apply {
                // Volume adjustments reach the provider through the session's callback handler,
                // so without a callback they are silently dropped.
                setCallback(object : MediaSession.Callback() {}, handler)
                setPlaybackToRemote(object : VolumeProvider(VOLUME_CONTROL_RELATIVE, 10, 5) {
                    override fun onAdjustVolume(direction: Int) {
                        if (VolumeKeys.adjustStops(direction)) handler.post { finishAlarm() }
                    }
                    override fun onSetVolumeTo(volume: Int) {
                        if (VolumeKeys.setStops(volume, currentVolume)) handler.post { finishAlarm() }
                    }
                })
                setPlaybackState(PlaybackState.Builder().setState(PlaybackState.STATE_PLAYING, 0, 1f).build())
                isActive = true
            }
        }.getOrNull()
    }

    /** Undoes [listenToVolumeKeys]: the sessions and the receiver go, and the media volume is set back. */
    private fun stopListeningToVolumeKeys() {
        session?.runCatching { isActive = false; release() }
        session = null
        localSession?.runCatching { isActive = false; release() }
        localSession = null
        volumeReceiver?.let { runCatching { unregisterReceiver(it) } }
        volumeReceiver = null
        // Also undoes the step a button press made to stop it.
        if (musicWas >= 0) getSystemService(AudioManager::class.java)?.runCatching {
            if (getStreamVolume(AudioManager.STREAM_MUSIC) != musicWas) setStreamVolume(AudioManager.STREAM_MUSIC, musicWas, 0)
        }
        musicSet = -1
        musicWas = -1
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
        stopListeningToVolumeKeys()
        focus?.let { f -> getSystemService(AudioManager::class.java)?.runCatching { abandonAudioFocusRequest(f) } }
        focus = null
    }

    private fun timeout() {
        stopRinging()
        missedNotice()
        finishAlarm()
    }

    /** "Missed alarm" for what's ringing now (it timed out, or another alarm took its place). */
    private fun missedNotice() {
        val id = when {
            reminderId != 0L -> smallId(reminderId)
            clockId != 0L -> Missed.clockNoticeId(clockId)
            else -> 777_001
        }
        Missed.show(
            this, id, title, ringText,
            if (itemId != 0L) Notifications.openItemIntent(this, itemId) else Notifications.openSectionIntent(this, if (timerId != 0L) "timer" else "alarm", 4),
        )
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
            // A plain event has no ticks (247): nothing to save.
            if (!item.completable) return@launch
            Mirror.markDone(ctx, i, if (item.isRecurring) d else (item.startDay ?: d))
            // Its other reminders for that day go too.
            AlarmScheduler.refreshItem(ctx, i)
        }
        finishAlarm()
    }

    private fun titleFor(clock: ClockAlarm?): String = when {
        timerId != 0L -> "Time's up"
        clockId != 0L -> clock?.label?.trim()?.ifBlank { null } ?: "Alarm"
        else -> Mirror.item(this, itemId)?.title?.ifBlank { "Alarm" } ?: "Alarm"
    }

    private fun finishAlarm() {
        stopRinging()
        RingState.clear(this)
        RingWakeLock.release()
        if (ringing != null) { ringing = null; AlarmEvents.changed("ringing") }
        sendBroadcast(Intent(AlarmActivity.ACTION_CLOSE).setPackage(packageName))
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        redrawCard()
    }

    /** Off this thread: the card is never allowed to hold up the sound. */
    private fun redrawCard() {
        val ctx = applicationContext
        CoroutineScope(Dispatchers.IO).launch { Card.refresh(ctx) }
    }

    override fun onDestroy() {
        stopRinging()
        if (ringing != null) { ringing = null; AlarmEvents.changed("ringing") }
        super.onDestroy()
    }
}
