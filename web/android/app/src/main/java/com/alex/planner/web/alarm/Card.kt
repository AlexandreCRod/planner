package com.alex.planner.web.alarm

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Bundle
import android.service.notification.StatusBarNotification
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StyleSpan
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.alex.planner.web.R
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** One of a line's alerts: still to come, or gone off ([fired]). A clock alarm's has no reminder (0). */
@Serializable
data class LineAlert(
    val reminderId: Long,
    val type: AlertType,
    val at: Long,
    val original: Long,
    val offsetMin: Int = 0,
    val fired: Boolean = false,
    val snoozed: Boolean = false,
)

/** One item, or one clock alarm, in Planner's card: at most one line each, updated in place (218). */
@Serializable
data class Line(
    /** "i" + the item's id, or "c" + the clock alarm's. */
    val key: String,
    val itemId: Long = 0,
    val clockId: Long = 0,
    /** The occurrence's day. */
    val day: Long = 0,
    val name: String,
    /** When it starts, or when a clock alarm rings: the card's order. */
    val start: Long,
    val allDay: Boolean = false,
    val routine: Boolean = false,
    /** A task or routine: it stays until ticked. */
    val completable: Boolean = false,
    /** When an event ends (null: it stays). */
    val expires: Long? = null,
    val alerts: List<LineAlert> = emptyList(),
    val started: Boolean = false,
    /** A clock alarm's days as a key, as daysKey in clockList.ts: only the same days bundle. */
    val bundle: String = "",
)

/**
 * Planner's one card in the shade (218): every task, event and clock alarm coming up in the next 2 hours, in
 * time order, and what each will do. [Line]s are kept here (so a restart brings them back, and a line goes
 * through its stages without stacking) and drawn by [render], in the look the page chose ([AlarmSettings.notificationCard]):
 * 1, Android's group, a notification per row with a summary carrying "Next ring 09:30"; 2, one notification with
 * a plain list. The ringing alarm is never part of it: it has its own card on top (AlarmService). Nothing here may
 * ever get in the way of ringing, so every entry point swallows its own failures.
 */
object Card {
    const val GROUP = "planner"
    const val SUMMARY_ID = 776_000
    private const val LIST_ID = 776_001
    private const val TAG_LINE = "line"
    private const val PREFS = "notification-card"
    private const val KEY = "lines"
    private const val EXTRA_SIG = "plannerSig"
    /** Comes round at most this long after its time: past it, an alert that never went off is dropped. */
    private const val LATE_MS = 10 * 60_000L
    private const val LIST_MAX = 7
    private val lock = Any()

    enum class Kind { RING, POPS, SILENT }

    /** One row of the card: a [Line], or the clock alarms of one bundle together. */
    data class Row(val lines: List<Line>, val name: String, val time: String, val text: String, val kind: Kind, val ringAt: Long?) {
        val key get() = lines.first().key
        val title get() = if (time.isEmpty()) name else "$name · $time"
    }

    /** Which row re-alerts as it's drawn, and on which channel. */
    private data class Alert(val key: String, val channel: String)

    // ---------- What a line says (pure) ----------

    /** "09:30", or "Tomorrow 09:30" when it isn't today. */
    fun timeLabel(at: Long, zone: ZoneId = ZoneId.systemDefault(), today: LocalDate = LocalDate.now(zone)): String {
        val t = Instant.ofEpochMilli(at).atZone(zone).toLocalDateTime()
        val time = formatTime(t.hour * 60 + t.minute)
        return if (t.toLocalDate() == today) time else "${relativeDayLabel(t.toLocalDate(), today)} $time"
    }

    /** "30 min", "1 h", "1 h 5 min". */
    fun span(ms: Long): String {
        val min = (ms + 30_000) / 60_000
        val h = min / 60
        val m = min % 60
        return when {
            h == 0L -> "$m min"
            m == 0L -> "$h h"
            else -> "$h h $m min"
        }
    }

    private fun next(l: Line) = l.alerts.filter { !it.fired }.minByOrNull { it.at }

    /** Rings if an alarm's still to come; pops up if a reminder is, or was; else silent. */
    fun kind(l: Line): Kind = when {
        l.alerts.any { !it.fired && it.type == AlertType.ALARM } -> Kind.RING
        l.alerts.isEmpty() || l.alerts.any { it.type == AlertType.REMINDER } -> Kind.POPS
        else -> Kind.SILENT
    }

    /** The line under the title: "Rings at 09:30, 30 min before", "in 30 min · Rings", "Routine · Silent · not ticked yet". */
    fun lineText(l: Line, now: Long): String {
        val parts = ArrayList<String>()
        if (l.routine) parts += "Routine"
        val next = next(l)
        val anyFired = l.alerts.any { it.fired }
        if (anyFired && !l.started && !l.allDay && l.start - now >= 60_000) parts += "in " + span(l.start - now)
        when (next?.type) {
            AlertType.ALARM -> parts += when {
                next.snoozed -> "Snoozed to ${timeLabel(next.at)}"
                anyFired && next.at == l.start -> "Rings"
                next.offsetMin > 0 -> "Rings at ${timeLabel(next.at)}, ${span(next.offsetMin * 60_000L)} before"
                else -> "Rings at ${timeLabel(next.at)}"
            }
            AlertType.REMINDER -> parts += "Notifies at ${timeLabel(next.at)}"
            AlertType.NOTIFICATION -> parts += "Silent"
            null -> {
                if (l.started && now - l.start < LATE_MS) parts += "Starting now"
                else if (l.started && !l.completable) parts += "Started"
                if (kind(l) == Kind.SILENT) parts += "Silent"
            }
        }
        if (next?.type != AlertType.ALARM && l.completable && now >= l.start) parts += "not ticked yet"
        return parts.joinToString(" · ").replaceFirstChar { it.uppercase() }
    }

    /** The lines in time order as rows: clock alarms of the same days within [window] minutes are one row. */
    fun rows(lines: List<Line>, window: Int, now: Long): List<Row> {
        val groups = ArrayList<MutableList<Line>>()
        val open = HashMap<String, MutableList<Line>>()
        for (l in lines.sortedWith(compareBy({ it.start }, { it.key }))) {
            val b = open[l.bundle]
            if (l.bundle.isNotEmpty() && b != null && window > 0 && (l.start - b.last().start) / 60_000 <= window) { b += l; continue }
            val fresh = mutableListOf(l)
            groups += fresh
            if (l.bundle.isNotEmpty()) open[l.bundle] = fresh
        }
        return groups.map { g ->
            val first = g.first()
            val ringAt = g.mapNotNull { l -> l.alerts.filter { !it.fired && it.type == AlertType.ALARM }.minOfOrNull { it.at } }.minOrNull()
            when {
                g.size > 1 -> Row(g, first.name, "${timeLabel(first.start)}–${timeLabel(g.last().start)}", "${g.size} alarms · Rings", Kind.RING, ringAt)
                first.clockId != 0L -> Row(g, first.name, timeLabel(first.start), "Rings", Kind.RING, ringAt)
                else -> Row(g, first.name, if (first.allDay) "" else timeLabel(first.start), lineText(first, now), kind(first), ringAt)
            }
        }
    }

    /** "Next ring 09:30", or null with no alarm in the card. */
    fun header(rows: List<Row>, now: Long): String? = rows.mapNotNull { it.ringAt }.filter { it > now }.minOrNull()?.let { "Next ring ${timeLabel(it)}" }

    /** What's left of [lines] at [now]: ended events go, and alerts long past that never went off. */
    fun prune(lines: List<Line>, now: Long): List<Line> = lines.mapNotNull { l ->
        if (l.expires != null && now >= l.expires) return@mapNotNull null
        val alerts = l.alerts.filter { it.fired || it.at + LATE_MS > now }
        if (alerts.isEmpty() && !l.started) null else l.copy(alerts = alerts)
    }

    /** When [item]'s occurrence on [day] ends: null for a task or routine (it stays until ticked). */
    fun expiry(item: Item, day: Long, zone: ZoneId = ZoneId.systemDefault()): Long? {
        if (item.completable) return null
        val span = (item.endDay ?: item.startDay ?: day) - (item.startDay ?: day)
        val endDate = (day + span.coerceAtLeast(0)).toDate()
        if (item.allDay || item.startMin == null) return endDate.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        // Without an end of its own, an event lasts an hour.
        val end = item.endMin ?: (item.startMin + 60)
        return endDate.atStartOfDay(zone).plusMinutes(end.toLong()).toInstant().toEpochMilli()
    }

    /** A clock alarm's days as a key: daysKey in clockList.ts. */
    fun daysKey(a: ClockAlarm, at: Long, zone: ZoneId = ZoneId.systemDefault()): String = when {
        a.dates.isNotEmpty() -> "d:" + a.dates.sorted().joinToString(",")
        a.days != 0 -> "w:${a.days}"
        else -> "o:" + Instant.ofEpochMilli(at).atZone(zone).toLocalDate().toEpochDay()
    }

    // ---------- The stored lines ----------

    private fun prefs(context: Context) = AlarmStore.prefs(context, PREFS)

    fun lines(context: Context): List<Line> {
        val raw = prefs(context).getString(KEY, null) ?: return emptyList()
        return runCatching { json.decodeFromString(ListSerializer(Line.serializer()), raw) }.getOrDefault(emptyList())
    }

    private fun write(context: Context, lines: List<Line>) {
        prefs(context).edit().putString(KEY, json.encodeToString(ListSerializer(Line.serializer()), lines)).commit()
    }

    private fun change(context: Context, alert: Alert? = null, fn: (List<Line>) -> List<Line>) {
        runCatching {
            synchronized(lock) {
                val before = lines(context)
                val after = fn(before)
                if (after != before) write(context, after)
                render(context, alert)
            }
        }
    }

    private fun itemKey(id: Long) = "i$id"
    private fun clockKey(id: Long) = "c$id"

    /** [item]'s line, for its occurrence on [day]: the one there is (a day before's is replaced), or a new one. */
    private fun itemLine(context: Context, list: List<Line>, item: Item, day: Long): Line {
        val old = list.firstOrNull { it.key == itemKey(item.id) }?.takeIf { it.day == day }
        val settings = Mirror.settings(context)
        return Line(
            key = itemKey(item.id), itemId = item.id, day = day, name = item.title.ifBlank { "Untitled" },
            start = AlarmScheduler.originalAt(item, day.toDate(), 0, settings.defaultTaskTime),
            allDay = item.allDay || item.startMin == null, routine = item.routine == true, completable = item.completable,
            expires = expiry(item, day), alerts = old?.alerts.orEmpty(), started = old?.started == true,
        )
    }

    private fun put(list: List<Line>, line: Line) = list.filterNot { it.key == line.key } + line

    private fun withAlert(line: Line, a: LineAlert) = line.copy(alerts = line.alerts.filterNot { it.reminderId == a.reminderId } + a)

    // ---------- What the engine tells it ----------

    /** Its 2-hour notice came: the line shows, quietly, saying what will happen. */
    fun notice(context: Context, item: Item, r: Reminder, day: Long, at: Long, original: Long, snoozed: Boolean) = change(context) { list ->
        put(list, withAlert(itemLine(context, list, item, day), LineAlert(r.id, r.type, at, original, r.offsetMin, snoozed = snoozed)))
    }

    /** A reminder (not an alarm) came due: the same line says so, and pops up unless it's silent or [quiet]. */
    fun fired(context: Context, item: Item, r: Reminder, day: Long, original: Long, quiet: Boolean) {
        val pops = r.type == AlertType.REMINDER && !quiet
        change(context, if (pops) Alert(itemKey(item.id), Notifications.CH_REMIND) else null) { list ->
            put(list, withAlert(itemLine(context, list, item, day), LineAlert(r.id, r.type, original, original, r.offsetMin, fired = true)))
        }
    }

    /** [item] started; [popUp]: its line re-alerts as "Starting now". */
    fun started(context: Context, item: Item, day: Long, show: Boolean, popUp: Boolean) {
        change(context, if (popUp) Alert(itemKey(item.id), Notifications.CH_STARTING) else null) { list ->
            val line = itemLine(context, list, item, day)
            if (show || list.any { it.key == line.key }) put(list, line.copy(started = true)) else list
        }
    }

    private fun dropAlerts(list: List<Line>, drop: (LineAlert) -> Boolean) = list.mapNotNull { l ->
        if (l.alerts.none(drop)) return@mapNotNull l
        val alerts = l.alerts.filterNot(drop)
        if (alerts.isEmpty() && !l.started) null else l.copy(alerts = alerts)
    }

    /** A notice's alert no longer stands (it rang, was skipped, the item moved). What already went off stays. */
    fun dropUpcoming(context: Context, reminderId: Long) = change(context) { list ->
        dropAlerts(list) { it.reminderId == reminderId && !it.fired }
    }

    /** A reminder that went off is over (snoozed, ticked, taken back). */
    fun dropFired(context: Context, reminderId: Long) = change(context) { list ->
        dropAlerts(list) { it.reminderId == reminderId && it.fired }
    }

    /** [itemId]'s line goes: it was ticked. */
    fun dropItem(context: Context, itemId: Long) = change(context) { list -> list.filterNot { it.key == itemKey(itemId) } }

    fun clockNotice(context: Context, a: ClockAlarm, at: Long) = change(context) { list ->
        put(list, Line(
            key = clockKey(a.id), clockId = a.id, name = a.label.trim().ifBlank { "Alarm" }, start = at, bundle = daysKey(a, at),
            alerts = listOf(LineAlert(0, AlertType.ALARM, at, at)),
        ))
    }

    fun dropClock(context: Context, id: Long) = change(context) { list -> list.filterNot { it.key == clockKey(id) } }

    /** Swiped away: those lines go. "*": the whole card. */
    fun dismissed(context: Context, keys: String) = change(context) { list ->
        if (keys == "*") emptyList() else keys.split(',').toSet().let { gone -> list.filterNot { it.key in gone } }
    }

    /** Draws it again, as it is now (a tick, a setting changed, after a restart, after a ring). */
    fun refresh(context: Context) = change(context) { prune(it, System.currentTimeMillis()) }

    // ---------- Drawing ----------

    private fun sortKey(at: Long) = "%014d".format(at)

    private fun intent(context: Context, action: String, data: String) = Intent(context, AlarmReceiver::class.java).setAction(action).setData(Uri.parse("planner-alarm://card/$data"))

    private fun broadcast(context: Context, i: Intent) =
        PendingIntent.getBroadcast(context, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun dismissIntent(context: Context, keys: String) =
        broadcast(context, intent(context, AlarmReceiver.ACTION_CARD_DISMISS, keys.replace('*', 'x')).putExtra(AlarmReceiver.EXTRA_KEYS, keys))

    /** A timer's or a missed alarm's notification joins the group, sorted by [at]; plain under the list look. */
    fun join(context: Context, b: NotificationCompat.Builder, at: Long) {
        if (Mirror.settings(context).notificationCard == 2) return
        b.setGroup(GROUP).setSortKey(sortKey(at)).setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setDeleteIntent(broadcast(context, intent(context, AlarmReceiver.ACTION_CARD_TICK, "gone")))
    }

    private data class Button(val label: String, val pi: PendingIntent)

    /** A row's buttons, at most 3. */
    private fun buttons(context: Context, row: Row, snoozeMinutes: Int): List<Button> {
        val out = ArrayList<Button>()
        val first = row.lines.first()
        if (first.clockId != 0L) {
            val a = first.alerts.first()
            if (row.lines.size > 1) {
                out += Button("Skip ${timeLabel(first.start)}", Notifications.clockActionIntent(context, AlarmReceiver.ACTION_CLOCK_EARLY_STOP, first.clockId, a.at))
                val all = row.lines.joinToString(",") { "${it.clockId}:${it.start}" }
                out += Button("Skip all", broadcast(context, intent(context, AlarmReceiver.ACTION_CLOCK_SKIP_ALL, "skip/${first.clockId}").putExtra(AlarmReceiver.EXTRA_KEYS, all)))
            } else {
                out += Button("Skip", Notifications.clockActionIntent(context, AlarmReceiver.ACTION_CLOCK_EARLY_STOP, first.clockId, a.at))
                if (AlarmScheduler.canSnoozeEarly(a.at)) out += Button("Snooze ${snoozeMinutes}m", Notifications.clockActionIntent(context, AlarmReceiver.ACTION_CLOCK_EARLY_SNOOZE, first.clockId, a.at))
            }
            return out
        }
        val alarm = first.alerts.filter { !it.fired && it.type == AlertType.ALARM }.minByOrNull { it.at }
        val reminder = first.alerts.firstOrNull { it.fired && it.type == AlertType.REMINDER }
        if (alarm != null) {
            out += Button("Skip", Notifications.actionIntent(context, AlarmReceiver.ACTION_EARLY_STOP, first.itemId, alarm.reminderId, first.day, alarm.original))
            if (AlarmScheduler.canSnoozeEarly(alarm.at)) out += Button("Snooze ${snoozeMinutes}m", Notifications.actionIntent(context, AlarmReceiver.ACTION_EARLY_SNOOZE, first.itemId, alarm.reminderId, first.day, alarm.original))
        } else if (reminder != null) {
            out += Button("Snooze ${snoozeMinutes}m", Notifications.actionIntent(context, AlarmReceiver.ACTION_SNOOZE, first.itemId, reminder.reminderId, first.day, reminder.original))
        }
        if (first.completable) {
            out += Button("Done", Notifications.actionIntent(context, AlarmReceiver.ACTION_DONE, first.itemId, first.alerts.firstOrNull()?.reminderId ?: 0L, first.day, key = "line-${first.itemId}"))
        }
        return out
    }

    private fun open(context: Context, l: Line) = if (l.itemId != 0L) Notifications.openItemIntent(context, l.itemId) else Notifications.openSectionIntent(context, "alarm", 3)

    private fun base(context: Context, channel: String, alert: Boolean) = NotificationCompat.Builder(context, channel)
        .setSmallIcon(R.drawable.ic_notification)
        .setCategory(NotificationCompat.CATEGORY_REMINDER)
        .setPriority(if (alert) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
        .setShowWhen(false)
        .setOnlyAlertOnce(!alert)

    private fun extras(sig: String) = Bundle().apply { putString(EXTRA_SIG, sig) }

    private fun notify(context: Context, tag: String?, id: Int, b: NotificationCompat.Builder) {
        try {
            NotificationManagerCompat.from(context).notify(tag, id, b.build())
        } catch (_: SecurityException) {
        }
    }

    private fun render(context: Context, alert: Alert?) {
        val now = System.currentTimeMillis()
        val settings = Mirror.settings(context)
        val lines = lines(context).let { all -> prune(all, now).also { if (it != all) write(context, it) } }
        val rows = rows(lines, settings.bundleWindow, now)
        armTick(context, lines, now)
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val active = context.getSystemService(NotificationManager::class.java).activeNotifications.toList()
        if (settings.notificationCard == 2) renderList(context, rows, active, alert, settings, now)
        else renderGroup(context, rows, active, alert, settings, now)
    }

    private fun sigOf(n: StatusBarNotification) = n.notification.extras.getString(EXTRA_SIG)

    private fun renderGroup(context: Context, rows: List<Row>, active: List<StatusBarNotification>, alert: Alert?, settings: AlarmSettings, now: Long) {
        val nm = NotificationManagerCompat.from(context)
        nm.cancel(LIST_ID)
        val ids = rows.associateBy { smallId(it.key.hashCode().toLong()) }
        active.filter { it.tag == TAG_LINE && it.id !in ids }.forEach { nm.cancel(TAG_LINE, it.id) }
        for ((id, row) in ids) {
            val rowAlert = alert?.takeIf { a -> row.lines.any { it.key == a.key } }
            val sig = "${row.title}|${row.text}|${row.kind}|${settings.notificationIcons}|${row.key}|${AlarmScheduler.canSnoozeEarly(row.ringAt ?: Long.MAX_VALUE)}|${row.lines.size}"
            if (rowAlert == null && active.any { it.tag == TAG_LINE && it.id == id && sigOf(it) == sig }) continue
            val first = row.lines.first()
            val b = base(context, rowAlert?.channel ?: Notifications.CH_UPCOMING, rowAlert != null)
                .setContentTitle(row.title)
                .setContentText(row.text)
                .setLargeIcon(icon(context, row.kind, settings.notificationIcons))
                .setContentIntent(open(context, first))
                .setDeleteIntent(dismissIntent(context, row.lines.joinToString(",") { it.key }))
                .setGroup(GROUP)
                .setSortKey(sortKey(first.start))
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
                .addExtras(extras(sig))
            buttons(context, row, settings.snoozeMinutes).take(3).forEach { b.addAction(0, it.label, it.pi) }
            notify(context, TAG_LINE, id, b)
        }
        // Timers and missed alarms in the group count too.
        val others = active.filter { it.tag != TAG_LINE && it.id != SUMMARY_ID && it.notification.group == GROUP }
        val count = rows.size + others.size
        if (count == 0) { nm.cancel(SUMMARY_ID); return }
        val head = header(rows, now)
        val sig = "$count|$head|${rows.joinToString { it.title }}"
        if (active.any { it.id == SUMMARY_ID && it.tag == null && sigOf(it) == sig }) return
        val style = NotificationCompat.InboxStyle().also { s -> rows.take(LIST_MAX).forEach { s.addLine("${it.title} · ${it.text}") } }
        if (head != null) style.setSummaryText(head)
        val summary = base(context, Notifications.CH_UPCOMING, false)
            .setContentTitle(head ?: "Coming up")
            .setContentText(rows.firstOrNull()?.title ?: "Coming up")
            .setStyle(style)
            .setGroup(GROUP)
            .setGroupSummary(true)
            .setSortKey(sortKey(0))
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setDeleteIntent(dismissIntent(context, "*"))
            .addExtras(extras(sig))
        if (head != null) summary.setSubText(head)
        notify(context, null, SUMMARY_ID, summary)
    }

    private fun listLine(row: Row): CharSequence {
        val time = row.time.ifEmpty { "All day" }
        val s = SpannableString("$time  ${row.name} · ${row.text}")
        s.setSpan(StyleSpan(android.graphics.Typeface.BOLD), 0, time.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        return s
    }

    private fun renderList(context: Context, rows: List<Row>, active: List<StatusBarNotification>, alert: Alert?, settings: AlarmSettings, now: Long) {
        val nm = NotificationManagerCompat.from(context)
        active.filter { it.tag == TAG_LINE }.forEach { nm.cancel(TAG_LINE, it.id) }
        nm.cancel(SUMMARY_ID)
        // While one rings, its own card takes the list's place (the same card, as the look promises).
        if (rows.isEmpty() || AlarmService.ringing != null) { nm.cancel(LIST_ID); return }
        val next = rows.firstOrNull { it.ringAt != null }
        val head = next?.let { "${header(rows, now) ?: "Next ring"} · ${it.name}" }
        val countText = "${rows.size} coming up"
        val sig = "$head|${rows.joinToString { it.title + it.text }}"
        if (alert == null && active.any { it.id == LIST_ID && sigOf(it) == sig }) return
        val b = base(context, alert?.channel ?: Notifications.CH_UPCOMING, alert != null)
            .setContentTitle(head ?: countText)
            .setContentText(if (head != null) "$countText in the next 2 hours" else rows.first().title)
            .setContentIntent(open(context, rows.first().lines.first()))
            .setDeleteIntent(dismissIntent(context, "*"))
            .setSortKey(sortKey(rows.first().lines.first().start))
            .addExtras(extras(sig))
        val style = NotificationCompat.InboxStyle().setBigContentTitle(countText)
        rows.take(LIST_MAX).forEach { style.addLine(listLine(it)) }
        b.setStyle(style)
        // The next alarm's two buttons, and the oldest task not ticked yet.
        val acts = ArrayList<Button>()
        if (next != null) buttons(context, next, settings.snoozeMinutes).filter { it.label != "Done" }.take(2).forEachIndexed { i, btn ->
            // A bundle's own buttons say what they do ("Skip 07:00", "Skip all").
            acts += if (next.lines.size > 1) btn else Button(if (i == 0) "Skip next alarm" else "Snooze it", btn.pi)
        }
        rows.firstOrNull { r -> r.lines.first().completable && now >= r.lines.first().start }?.let { r ->
            buttons(context, r, settings.snoozeMinutes).firstOrNull { it.label == "Done" }?.let { acts += Button("${r.name} done", it.pi) }
        }
        acts.take(3).forEach { b.addAction(0, it.label, it.pi) }
        notify(context, null, LIST_ID, b)
    }

    /** Under the list look, the ringing card shows what's coming up, as the list did. */
    fun ringingStyle(context: Context, b: NotificationCompat.Builder, title: String) {
        runCatching {
            if (Mirror.settings(context).notificationCard != 2) return
            val rows = rows(lines(context), Mirror.settings(context).bundleWindow, System.currentTimeMillis())
            if (rows.isEmpty()) return
            val style = NotificationCompat.InboxStyle().setBigContentTitle("$title is ringing")
            rows.take(LIST_MAX).forEach { style.addLine(listLine(it)) }
            b.setStyle(style)
        }
    }

    /** The next time the card changes by itself: an event ends, or a late alert is dropped. */
    private fun armTick(context: Context, lines: List<Line>, now: Long) {
        val i = intent(context, AlarmReceiver.ACTION_CARD_TICK, "tick")
        val at = lines.flatMap { l -> listOfNotNull(l.expires) + l.alerts.filter { !it.fired }.map { it.at + LATE_MS } }.filter { it > now }.minOrNull()
        val pi = broadcast(context, i)
        if (at != null) AlarmScheduler.setNotice(context, at, pi)
        else context.getSystemService(android.app.AlarmManager::class.java).cancel(pi)
    }

    // ---------- The right-hand icon ----------

    /** Each set: rings, pops up, silent (254). */
    private val SETS = listOf(
        listOf(R.drawable.ic_card_alarm, R.drawable.ic_card_bell, R.drawable.ic_card_bell_off),
        listOf(R.drawable.ic_card_alarm, R.drawable.ic_card_sound, R.drawable.ic_card_sound_off),
        listOf(R.drawable.ic_card_bell, R.drawable.ic_card_bubble, R.drawable.ic_card_moon),
    )

    /** The icon on a small rounded tile: filled blue for rings, filled grey for pops up, an outline for silent. */
    private fun icon(context: Context, kind: Kind, set: Int): Bitmap {
        val size = 96
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val box = RectF(6f, 6f, size - 6f, size - 6f)
        val (bg, fg) = when (kind) {
            Kind.RING -> 0xFF263452.toInt() to 0xFFA4B9DF.toInt()
            Kind.POPS -> 0xFF3A3D42.toInt() to 0xFFE3E3E6.toInt()
            Kind.SILENT -> 0 to 0xFF9A9EA5.toInt()
        }
        if (bg != 0) { p.color = bg; c.drawRoundRect(box, 28f, 28f, p) }
        else { p.color = 0xFF70747A.toInt(); p.style = Paint.Style.STROKE; p.strokeWidth = 3f; c.drawRoundRect(box, 28f, 28f, p) }
        val icons = SETS.getOrElse(set - 1) { SETS[0] }
        val d = ContextCompat.getDrawable(context, icons[kind.ordinal])!!.mutate()
        d.setTint(fg)
        d.setBounds(22, 22, size - 22, size - 22)
        d.draw(c)
        return bmp
    }
}
