package com.alex.planner.web.alarm

import android.content.Context

/**
 * Changes made to single alarm occurrences before they ring, from the upcoming-alarm notice:
 * stopped (won't ring) or snoozed early (rings later). Kept on the phone only, since alarms only
 * ring here. Keys are "reminderId:originalTime". (Copied from the native app's AlarmOverrides; changes
 * are also announced to the page, so the item view shows the same state.)
 */
object AlarmOverrides {
    private const val PREFS = "alarm-overrides"
    private const val STOPPED = -1L
    private const val NOTICED = "noticed:"
    private const val RANG = "rang:"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun key(reminderId: Long, original: Long) = "$reminderId:$original"

    /** When this occurrence should ring now: [original], a snoozed time, or null if stopped. */
    fun adjusted(context: Context, reminderId: Long, original: Long): Long? =
        when (val v = prefs(context).getLong(key(reminderId, original), 0L)) {
            0L -> original
            STOPPED -> null
            else -> v
        }

    fun stop(context: Context, reminderId: Long, original: Long) {
        prefs(context).edit().putLong(key(reminderId, original), STOPPED).commit()
        prune(context)
        AlarmEvents.changed("overrides")
    }

    fun delay(context: Context, reminderId: Long, original: Long, newTime: Long) {
        prefs(context).edit().putLong(key(reminderId, original), newTime).commit()
        prune(context)
        AlarmEvents.changed("overrides")
    }

    /** Back to the original time: no early snooze, no "don't ring". */
    fun reset(context: Context, reminderId: Long, original: Long) {
        prefs(context).edit().remove(key(reminderId, original)).commit()
        AlarmEvents.changed("overrides")
    }

    /** Lets the upcoming notice show again for this occurrence (after a reset). */
    fun forgetNotice(context: Context, reminderId: Long, original: Long?) {
        if (original != null) prefs(context).edit().remove(NOTICED + key(reminderId, original)).commit()
    }

    /** Occurrences of this reminder set not to ring, by their original time, still ahead of [now]. */
    fun stoppedAhead(context: Context, reminderId: Long, now: Long = System.currentTimeMillis()): List<Long> =
        prefs(context).all.mapNotNull { (k, v) ->
            if (k.startsWith(NOTICED) || k.startsWith(RANG) || !k.startsWith("$reminderId:")) return@mapNotNull null
            val original = k.substringAfter(':').toLongOrNull() ?: return@mapNotNull null
            if (v == STOPPED && original > now) original else null
        }.sorted()

    /** A snooze from the ringing screen: when it rings again. */
    fun setRingSnooze(context: Context, reminderId: Long, until: Long) {
        prefs(context).edit().putLong(RANG + reminderId, until).commit()
        AlarmEvents.changed("overrides")
    }

    fun clearRingSnooze(context: Context, reminderId: Long) {
        prefs(context).edit().remove(RANG + reminderId).commit()
        AlarmEvents.changed("overrides")
    }

    /** When a snooze from the ringing screen rings again, if one is waiting. */
    fun ringSnooze(context: Context, reminderId: Long, now: Long = System.currentTimeMillis()): Long? =
        prefs(context).getLong(RANG + reminderId, 0L).takeIf { it > now }

    /** True the first time it's asked for an occurrence, so a dismissed notice doesn't come back. */
    fun firstNotice(context: Context, reminderId: Long, original: Long): Boolean {
        val k = NOTICED + key(reminderId, original)
        val p = prefs(context)
        if (p.contains(k)) return false
        p.edit().putLong(k, original).commit()
        prune(context)
        return true
    }

    fun forgetNotices(context: Context) {
        val p = prefs(context)
        p.edit().apply { p.all.keys.filter { it.startsWith(NOTICED) }.forEach { remove(it) } }.commit()
    }

    /** Forgets occurrences that are well in the past. */
    private fun prune(context: Context) {
        val p = prefs(context)
        val cutoff = System.currentTimeMillis() - 2 * 24 * 3_600_000L
        val old = p.all.keys.filter { k ->
            if (k.startsWith(RANG)) return@filter p.getLong(k, 0L) < cutoff
            val original = k.removePrefix(NOTICED).substringAfter(':').toLongOrNull() ?: return@filter true
            val v = p.getLong(k, 0L)
            maxOf(original, v) < cutoff
        }
        if (old.isNotEmpty()) p.edit().apply { old.forEach { remove(it) } }.commit()
    }
}
