package com.alex.planner.web.alarm

import android.content.Context
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * The key of one alarm occurrence in [AlarmOverrides]: the reminder and the local day and minute it was
 * due ("12@20741T450"), not an absolute time, so a skip or early snooze still applies after a time-zone
 * change (194). The plugin calls and intents still carry the absolute time ("original"), worked out on the
 * wall clock by [AlarmScheduler.originalAt]; it's turned into the local day and minute here. Keys from
 * before 2.9.1 ("12:1792000000000") are read too, and rewritten once.
 */
object OverrideKey {
    fun of(reminderId: Long, original: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        val t = Instant.ofEpochMilli(original).atZone(zone).toLocalDateTime()
        return "$reminderId@${t.toLocalDate().toEpochDay()}T${t.hour * 60 + t.minute}"
    }

    /** The reminder and the absolute time (in [zone]) of a key, old or new; null if it isn't one. */
    fun parse(key: String, zone: ZoneId = ZoneId.systemDefault()): Pair<Long, Long>? {
        if ('@' in key) {
            val id = key.substringBefore('@').toLongOrNull() ?: return null
            val rest = key.substringAfter('@')
            val day = rest.substringBefore('T').toLongOrNull() ?: return null
            val min = rest.substringAfter('T').toIntOrNull() ?: return null
            return id to LocalDate.ofEpochDay(day).atTime(min / 60, min % 60).atZone(zone).toInstant().toEpochMilli()
        }
        val id = key.substringBefore(':').toLongOrNull() ?: return null
        val original = key.substringAfter(':').toLongOrNull() ?: return null
        return id to original
    }

    /** An old key in the new form (null: it's new already, or not a key). */
    fun upgrade(key: String, zone: ZoneId = ZoneId.systemDefault()): String? {
        if ('@' in key || ':' !in key) return null
        val (id, original) = parse(key, zone) ?: return null
        return of(id, original, zone)
    }
}

/**
 * Changes made to single alarm occurrences before they ring, from the upcoming-alarm notice:
 * stopped (won't ring) or snoozed early (rings later). Kept on the phone only, since alarms only
 * ring here. Keys are [OverrideKey]s. (Copied from the native app's AlarmOverrides; changes
 * are also announced to the page, so the item view shows the same state.)
 */
object AlarmOverrides {
    private const val PREFS = "alarm-overrides"
    private const val STOPPED = -1L
    private const val NOTICED = "noticed:"
    private const val RANG = "rang:"

    private const val KEYS_LOCAL = "keysLocal"
    @Volatile private var upgraded = false

    private fun prefs(context: Context) = AlarmStore.prefs(context, PREFS).also { if (!upgraded) upgradeKeys(it) }
    private fun key(reminderId: Long, original: Long) = OverrideKey.of(reminderId, original)

    /** Rewrites keys from before 2.9.1 (absolute times) as local day and minute, once. */
    private fun upgradeKeys(p: android.content.SharedPreferences) = synchronized(this) {
        if (upgraded) return
        if (!p.getBoolean(KEYS_LOCAL, false)) {
            val e = p.edit()
            for ((k, v) in p.all) {
                if (k.startsWith(RANG)) continue
                val prefix = if (k.startsWith(NOTICED)) NOTICED else ""
                val newKey = OverrideKey.upgrade(k.removePrefix(prefix)) ?: continue
                if (v is Long) { e.remove(k); e.putLong(prefix + newKey, v) }
            }
            e.putBoolean(KEYS_LOCAL, true).commit()
        }
        upgraded = true
    }

    /** The reminder and original time of an occurrence key (not the notice, snooze or bookkeeping ones). */
    private fun occurrence(k: String): Pair<Long, Long>? =
        if (k.startsWith(NOTICED) || k.startsWith(RANG) || k == KEYS_LOCAL) null else OverrideKey.parse(k)

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
            val (id, original) = occurrence(k) ?: return@mapNotNull null
            if (id == reminderId && v == STOPPED && original > now) original else null
        }.sorted()

    /**
     * Every occurrence changed ahead of [now], for the Alarms page: reminder, original time, and when it
     * rings now (null: set not to ring).
     */
    fun ahead(context: Context, now: Long = System.currentTimeMillis()): List<Triple<Long, Long, Long?>> =
        prefs(context).all.mapNotNull { (k, v) ->
            val (reminderId, original) = occurrence(k) ?: return@mapNotNull null
            val at = (v as? Long) ?: return@mapNotNull null
            if (original <= now && at <= now) null else Triple(reminderId, original, at.takeIf { it != STOPPED })
        }

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

    /** The ring snooze's time even if it's past (a restart checks what it missed). */
    fun ringSnoozeAny(context: Context, reminderId: Long): Long? =
        prefs(context).getLong(RANG + reminderId, 0L).takeIf { it > 0L }

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
            if (k == KEYS_LOCAL) return@filter false
            if (k.startsWith(RANG)) return@filter p.getLong(k, 0L) < cutoff
            val original = OverrideKey.parse(k.removePrefix(NOTICED))?.second ?: return@filter true
            val v = p.getLong(k, 0L)
            maxOf(original, v) < cutoff
        }
        if (old.isNotEmpty()) p.edit().apply { old.forEach { remove(it) } }.commit()
    }
}
