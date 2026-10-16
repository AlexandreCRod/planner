package com.alex.planner.web.alarm

import android.content.Context

/**
 * Whether event and task alerts ring on this phone (Settings, "Ring event and task alarms on this
 * phone"). On unless turned off. Kept on this phone only (never synced). Clock alarms, timers and the
 * stopwatch are not affected.
 *
 * Before 2.0 it was off by default while another Planner app was installed. The first time 2.0 reads
 * it, it's turned on once, for every install; after that only Settings changes it.
 */
object RingDevice {
    private const val PREFS = "ring-device"
    private const val KEY = "ringEvents"
    private const val MIGRATED = "onFrom2"

    fun ringsEvents(context: Context): Boolean {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!p.getBoolean(MIGRATED, false)) p.edit().putBoolean(KEY, true).putBoolean(MIGRATED, true).commit()
        return p.getBoolean(KEY, true)
    }

    fun set(context: Context, value: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY, value).putBoolean(MIGRATED, true).commit()
    }
}
