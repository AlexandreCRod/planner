package com.alex.planner.web.alarm

import android.content.Context
import android.util.AtomicFile
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

// The alarm engine's own copy of the records it needs. In this app the data lives in the WebView, so
// the page pushes the alarm-relevant records here on start, after every change and after every sync
// (web/src/alarms/mirror.ts). The engine reads only this copy, so alarms keep working, after a reboot
// too, even when the page never runs. The shapes are the native app's Room entities (app/.../data/
// Entities.kt), cut down to the fields scheduling uses; the page sends the same JSON field names.

@Serializable enum class ItemType { TASK, EVENT, NOTE }
@Serializable enum class Freq { NONE, DAILY, WEEKLY, MONTHLY, YEARLY }
@Serializable enum class AlertType { NOTIFICATION, REMINDER, ALARM }

@Serializable
data class Item(
    val id: Long,
    val type: ItemType = ItemType.TASK,
    val title: String = "",
    val startDay: Long? = null,
    val startMin: Int? = null,
    val endDay: Long? = null,
    /** Its end, for the notification card (218); missing from pages before 2.9.2. */
    val endMin: Int? = null,
    val allDay: Boolean = false,
    val freq: Freq = Freq.NONE,
    val interval: Int = 1,
    val weekDays: Int = 0,
    val monthDays: String = "",
    val months: Int = 0,
    val untilDay: Long? = null,
    val excludedDays: String = "",
    val deletedAt: Long? = null,
    /** A routine: a task, or an event (2.4), ticked off each day it comes round. */
    val routine: Boolean? = null,
) {
    val isRecurring get() = freq != Freq.NONE
    /** Whether its days are ticked off (a task, or an event that's a routine): a ticked day says nothing more. */
    val completable get() = type == ItemType.TASK || (type == ItemType.EVENT && routine == true)
}

@Serializable
data class Reminder(
    val id: Long,
    val itemId: Long,
    /** Minutes before the occurrence time. */
    val offsetMin: Int,
    val type: AlertType,
    /** Ringtone URI for alarms; null uses the default from settings. */
    val soundUri: String? = null,
)

@Serializable
data class Completion(val itemId: Long, val day: Long)

/** The settings the engine needs (native AppSettings' alarm part, plus the clock and date formats). */
@Serializable
data class AlarmSettings(
    /** Time used for reminders on untimed tasks and all-day events. */
    val defaultTaskTime: Int = 9 * 60,
    val defaultAlarmSound: String? = null,
    val quietHoursEnabled: Boolean = false,
    val quietStart: Int = 22 * 60,
    val quietEnd: Int = 7 * 60,
    val snoozeMinutes: Int = 10,
    /** Notice with Snooze / Stop buttons 2 hours before each alarm. */
    val upcomingAlarms: Boolean = true,
    /** 0 follow the phone's setting, 1 24-hour, 2 12-hour. */
    val clockFormat: Int = 0,
    /** See [TimeFormat.dateStyle]. */
    val dateFormat: Int = 0,
    /** Index into [accents], for the ringing screen. */
    val accent: Int = 0,
    /** How long an event or task alarm rings before it stops by itself, in minutes. */
    val alarmRingMinutes: Int = 1,
    /** The same for clock alarms and timers. */
    val clockRingMinutes: Int = 10,
    /** The notification card's look (Looks to try, 254): 1 Android's group, 2 one plain list. */
    val notificationCard: Int = 1,
    /** Which icon set the card's lines use, 1 to 3. */
    val notificationIcons: Int = 1,
    /** Clock alarms with the same days this many minutes apart share a line (the Clock page's bundles). */
    val bundleWindow: Int = 19,
)

@Serializable
data class MirrorData(
    val items: List<Item> = emptyList(),
    val reminders: List<Reminder> = emptyList(),
    val completions: List<Completion> = emptyList(),
    val settings: AlarmSettings = AlarmSettings(),
    /** Ticked from a notification or the ringing screen, waiting for the page to save them (synced). */
    val pendingDone: List<Completion> = emptyList(),
    /** Reminders that may have something set with AlarmManager, so ones that disappear get cancelled. */
    val scheduled: List<Long> = emptyList(),
)

/** What the page sends: everything but the engine's own bookkeeping. */
@Serializable
data class MirrorPush(
    val items: List<Item> = emptyList(),
    val reminders: List<Reminder> = emptyList(),
    val completions: List<Completion> = emptyList(),
    val settings: AlarmSettings = AlarmSettings(),
)

val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true }

/** The engine's copy of the data, in one JSON file in the app's private storage. */
object Mirror {
    private val lock = Any()
    @Volatile private var cache: MirrorData? = null

    /** In device-protected storage, so it can be read before the phone is unlocked (AlarmStore). */
    private fun file(context: Context) = AtomicFile(AlarmStore.file(context, AlarmStore.MIRROR_FILE))

    /** Forgets what was read, so it's read again (after AlarmStore moved the file). */
    fun reload() { cache = null }

    fun current(context: Context): MirrorData {
        cache?.let { return it }
        synchronized(lock) {
            cache?.let { return it }
            val loaded = runCatching {
                json.decodeFromString(MirrorData.serializer(), String(file(context).readFully(), Charsets.UTF_8))
            }.getOrDefault(MirrorData())
            cache = loaded
            TimeFormat.apply(context, loaded.settings.clockFormat, loaded.settings.dateFormat)
            return loaded
        }
    }

    /** Changes the copy and saves it at once (atomically, so a crash never leaves half a file). */
    fun update(context: Context, change: (MirrorData) -> MirrorData): MirrorData = synchronized(lock) {
        val next = change(current(context))
        val f = file(context)
        val out = f.startWrite()
        try {
            out.write(json.encodeToString(MirrorData.serializer(), next).toByteArray(Charsets.UTF_8))
            f.finishWrite(out)
        } catch (e: Exception) {
            f.failWrite(out)
            throw e
        }
        cache = next
        TimeFormat.apply(context, next.settings.clockFormat, next.settings.dateFormat)
        next
    }

    /**
     * Takes what the page sent. Completions ticked here that the page hasn't picked up yet are kept,
     * so a push that crosses one doesn't make a done task ring again.
     */
    fun replace(context: Context, push: MirrorPush): MirrorData = update(context) { old ->
        val done = (push.completions + old.pendingDone).distinct()
        old.copy(items = push.items, reminders = push.reminders, completions = done, settings = push.settings)
    }

    fun settings(context: Context) = current(context).settings
    fun item(context: Context, id: Long) = current(context).items.firstOrNull { it.id == id }
    fun reminder(context: Context, id: Long) = current(context).reminders.firstOrNull { it.id == id }
    fun doneDays(context: Context, itemId: Long): Set<Long> =
        current(context).completions.asSequence().filter { it.itemId == itemId }.map { it.day }.toSet()

    /** A task ticked from a notification or the ringing screen: done here at once, and queued for the page. */
    fun markDone(context: Context, itemId: Long, day: Long) {
        val c = Completion(itemId, day)
        update(context) { it.copy(completions = (it.completions + c).distinct(), pendingDone = (it.pendingDone + c).distinct()) }
        AlarmEvents.changed("done")
        // The Today widget shows it ticked at once.
        com.alex.planner.web.widget.Widgets.update(context)
    }

    /** Hands the queued ticks to the page (which saves and syncs them). */
    fun takePendingDone(context: Context): List<Completion> {
        var taken = emptyList<Completion>()
        update(context) { taken = it.pendingDone; it.copy(pendingDone = emptyList()) }
        return taken
    }
}

/** Tells the page (when it's running) that alarm state changed natively. */
object AlarmEvents {
    @Volatile var listener: ((String) -> Unit)? = null
    fun changed(what: String) { runCatching { listener?.invoke(what) } }
}

/** A stable notification / request number for a 53-bit record id. */
fun smallId(id: Long): Int = (id xor (id ushr 32)).toInt() and 0x3fffffff
