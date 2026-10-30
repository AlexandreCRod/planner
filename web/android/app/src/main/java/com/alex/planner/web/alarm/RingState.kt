package com.alex.planner.web.alarm

import android.content.Context
import android.content.Intent
import android.os.PowerManager

/**
 * What's ringing, saved while it rings (194), so if Android kills the app mid-ring the service restarts
 * (START_STICKY) and carries on from here, or leaves a missed notice if its time is up. In device-protected
 * storage like the rest of the engine's data.
 */
object RingState {
    private const val PREFS = "alarm-ringing"

    data class Saved(
        val itemId: Long, val reminderId: Long, val day: Long, val original: Long, val clockId: Long, val timerId: Long,
        val text: String, val sound: String?, val startedAt: Long,
    ) {
        /** The intent that started it, to start it again. */
        fun intent(context: Context): Intent = Intent(context, AlarmService::class.java)
            .putExtra(AlarmReceiver.EXTRA_ITEM, itemId).putExtra(AlarmReceiver.EXTRA_REMINDER, reminderId)
            .putExtra(AlarmReceiver.EXTRA_DAY, day).putExtra(AlarmReceiver.EXTRA_ORIGINAL, original)
            .putExtra(ClockAlarms.EXTRA_CLOCK, clockId).putExtra(ClockTools.EXTRA_TIMER, timerId)
            .putExtra(AlarmService.EXTRA_TEXT, text).putExtra(AlarmService.EXTRA_SOUND, sound)
            .putExtra(AlarmService.EXTRA_STARTED, startedAt)
    }

    /** How long is left of a ring that started at [startedAt] and lasts [ringMs]; 0 when it's over. */
    fun left(startedAt: Long, ringMs: Long, now: Long): Long = (startedAt + ringMs - now).coerceIn(0, ringMs)

    fun save(context: Context, s: Saved) {
        AlarmStore.prefs(context, PREFS).edit()
            .putLong("itemId", s.itemId).putLong("reminderId", s.reminderId).putLong("day", s.day).putLong("original", s.original)
            .putLong("clockId", s.clockId).putLong("timerId", s.timerId).putString("text", s.text).putString("sound", s.sound)
            .putLong("startedAt", s.startedAt).commit()
    }

    fun load(context: Context): Saved? {
        val p = AlarmStore.prefs(context, PREFS)
        val startedAt = p.getLong("startedAt", 0L).takeIf { it > 0 } ?: return null
        return Saved(
            p.getLong("itemId", 0), p.getLong("reminderId", 0), p.getLong("day", 0), p.getLong("original", 0),
            p.getLong("clockId", 0), p.getLong("timerId", 0), p.getString("text", "") ?: "", p.getString("sound", null), startedAt,
        )
    }

    fun clear(context: Context) { AlarmStore.prefs(context, PREFS).edit().clear().commit() }
}

/**
 * Keeps the CPU awake from the alarm's broadcast until it rings, and while it rings: in Doze the phone
 * could otherwise sleep in the gap between the receiver and the service starting (194).
 */
object RingWakeLock {
    private var lock: PowerManager.WakeLock? = null

    @Synchronized fun acquire(context: Context, ms: Long) {
        val l = lock ?: context.applicationContext.getSystemService(PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "planner:alarm")?.apply { setReferenceCounted(false) }
            ?.also { lock = it } ?: return
        runCatching { l.acquire(ms) }
    }

    @Synchronized fun release() { lock?.runCatching { if (isHeld) release() } }
}
