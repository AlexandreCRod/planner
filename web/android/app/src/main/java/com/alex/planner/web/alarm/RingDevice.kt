package com.alex.planner.web.alarm

import android.content.Context
import android.content.pm.PackageManager

/**
 * Whether event and task alerts ring on this phone, from this app. The original Planner app
 * (com.alex.planner) sees the same synced reminders and rings them itself, so while it's installed
 * this app stays quiet for them unless told otherwise; once it's gone, this app rings them. An
 * explicit choice in Settings always wins. Kept on this phone only (never synced). Clock alarms,
 * timers and the stopwatch belong to this app alone and are not affected.
 *
 * The original app is found with a single <queries> entry for its package (AndroidManifest.xml), which
 * shows this app that one package and nothing else.
 */
object RingDevice {
    const val ORIGINAL = "com.alex.planner"
    private const val PREFS = "ring-device"
    private const val KEY = "ringEvents"

    fun originalInstalled(context: Context): Boolean = try {
        context.packageManager.getPackageInfo(ORIGINAL, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    /** The choice made in Settings, or null to follow whether the original app is installed. */
    fun explicit(context: Context): Boolean? {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return if (p.contains(KEY)) p.getBoolean(KEY, true) else null
    }

    fun ringsEvents(context: Context): Boolean = explicit(context) ?: !originalInstalled(context)

    fun set(context: Context, value: Boolean?) {
        val e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        if (value == null) e.remove(KEY) else e.putBoolean(KEY, value)
        e.commit()
    }
}
