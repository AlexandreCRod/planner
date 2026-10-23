package com.alex.planner.web.alarm

import android.content.Context
import android.content.Intent

/**
 * What the engine has out for each reminder: its notification in the shade, the upcoming-alarm notice,
 * or a snooze waiting to ring again, each for one occurrence (its day and original time). Kept so they
 * can be taken back once they no longer apply: the task was ticked, the item moved, deleted, or started
 * ([AlarmScheduler.noLongerApplies], [AlarmReceiver]'s start). Phone-only, like [AlarmOverrides].
 */
object Shown {
    private const val PREFS = "alarm-shown"
    const val NOTIFICATION = "n:"
    const val UPCOMING = "u:"
    const val SNOOZE = "s:"
    private val KINDS = listOf(NOTIFICATION, UPCOMING, SNOOZE)

    data class Occ(val day: Long, val original: Long)

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun put(context: Context, kind: String, reminderId: Long, day: Long, original: Long) {
        prefs(context).edit().putString(kind + reminderId, "$day|$original").apply()
    }

    fun get(context: Context, kind: String, reminderId: Long): Occ? {
        val v = prefs(context).getString(kind + reminderId, null) ?: return null
        val day = v.substringBefore('|').toLongOrNull() ?: return null
        return Occ(day, v.substringAfter('|').toLongOrNull() ?: 0L)
    }

    fun remove(context: Context, kind: String, reminderId: Long) {
        prefs(context).edit().remove(kind + reminderId).apply()
    }

    /** Takes back what's out for [reminderId] (of whichever kind) and forgets it. */
    fun takeBack(context: Context, kind: String, reminderId: Long) {
        when (kind) {
            NOTIFICATION -> Notifications.cancel(context, smallId(reminderId))
            UPCOMING -> Notifications.cancelUpcoming(context, reminderId)
            SNOOZE -> AlarmScheduler.cancelSnooze(context, reminderId)
        }
        remove(context, kind, reminderId)
    }

    /**
     * Takes back what's out for [item]'s reminders that no longer applies (see [AlarmScheduler.noLongerApplies]),
     * and stops its alarm if it's ringing for a day that's now ticked. Runs with every scheduling of the item.
     */
    fun tidy(context: Context, item: Item, reminders: List<Reminder>) {
        val done = Mirror.doneDays(context, item.id)
        val defaultTime = Mirror.settings(context).defaultTaskTime
        val old = System.currentTimeMillis() - 3 * 24 * 3_600_000L
        for (r in reminders) for (kind in KINDS) {
            val occ = get(context, kind, r.id) ?: continue
            when {
                AlarmScheduler.noLongerApplies(item, r, occ.day, occ.original, done, defaultTime) -> takeBack(context, kind, r.id)
                // Long past: only the record goes (whatever it was about is over).
                occ.original in 1 until old -> remove(context, kind, r.id)
            }
        }
        val ringing = AlarmService.ringing
        if (ringing != null && ringing.itemId == item.id && item.type == ItemType.TASK) {
            val day = if (item.isRecurring) ringing.day else item.startDay
            if (day in done) stopRinging(context)
        }
    }

    /** The reminder is gone (deleted, or its item): whatever it has out goes with it. */
    fun forget(context: Context, reminderId: Long) {
        for (kind in KINDS) if (get(context, kind, reminderId) != null) takeBack(context, kind, reminderId)
        if (AlarmService.ringing?.reminderId == reminderId) stopRinging(context)
    }

    private fun stopRinging(context: Context) {
        runCatching { context.startService(Intent(context, AlarmService::class.java).setAction(AlarmService.ACTION_DISMISS)) }
    }
}
