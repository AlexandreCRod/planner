package com.alex.planner.web.alarm

import android.content.Context
import android.content.SharedPreferences
import android.os.UserManager
import java.io.File

/**
 * Where the alarm engine keeps its data: Android's device-protected storage, which can be read before
 * the phone is unlocked after a restart (194). So an overnight update reboot re-arms the 07:00 alarm
 * straight away (BootReceiver on LOCKED_BOOT_COMPLETED), and it rings, with its ringing screen, before
 * anyone unlocks. Everything else of the app stays in the normal (credential-protected) storage.
 *
 * Before 2.9.1 this data lived in the normal storage; the first time the phone is unlocked with this
 * version it's moved over once ([moveOnce]). Until then (only possible in a locked boot right after the
 * update) the engine sees no data, and the unlocked boot sets everything up.
 */
object AlarmStore {
    /** The engine's preference files (ClockAlarms, ClockTools, AlarmOverrides, Shown, RingDevice, Forecast, Missed, RingState). */
    private val PREFS = listOf("clock-alarms", "clock-tools", "alarm-overrides", "alarm-shown", "ring-device", "weather")
    const val MIRROR_FILE = "alarm-mirror.json"
    private const val META = "alarm-store"
    private const val MOVED = "movedToDeviceStorage"
    private val lock = Any()
    @Volatile private var moved = false

    /** The device-protected context for [context] (works locked or unlocked). */
    fun deviceContext(context: Context): Context {
        val app = context.applicationContext ?: context
        val de = if (app.isDeviceProtectedStorage) app else app.createDeviceProtectedStorageContext()
        if (!moved) moveOnce(app, de)
        return de
    }

    fun prefs(context: Context, name: String): SharedPreferences =
        deviceContext(context).getSharedPreferences(name, Context.MODE_PRIVATE)

    fun file(context: Context, name: String): File = File(deviceContext(context).filesDir, name)

    /** Whether the phone has been unlocked since it started (the normal storage can be read). */
    fun unlocked(context: Context): Boolean =
        context.getSystemService(UserManager::class.java)?.isUserUnlocked ?: true

    private fun moveOnce(app: Context, de: Context) = synchronized(lock) {
        if (moved) return
        val meta = de.getSharedPreferences(META, Context.MODE_PRIVATE)
        if (meta.getBoolean(MOVED, false)) { moved = true; return }
        // The old storage can't be read until the first unlock: try again then.
        if (!unlocked(app)) return
        runCatching {
            for (name in PREFS) de.moveSharedPreferencesFrom(app, name)
            val old = File(app.filesDir, MIRROR_FILE)
            val new = File(de.filesDir, MIRROR_FILE)
            if (old.exists() && !new.exists()) old.copyTo(new)
            old.delete()
            File(app.filesDir, "$MIRROR_FILE.bak").delete()
        }
        meta.edit().putBoolean(MOVED, true).commit()
        moved = true
        // Anything read before the move (an empty copy in a locked boot) is read again.
        Mirror.reload()
        ClockAlarms.reload()
        ClockTools.reload()
    }
}
