package com.alex.planner.web.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import com.alex.planner.web.MainActivity
import com.alex.planner.web.R
import com.alex.planner.web.alarm.AlarmEvents
import com.alex.planner.web.alarm.AlarmScheduler
import com.alex.planner.web.alarm.Completion
import com.alex.planner.web.alarm.Mirror
import com.alex.planner.web.alarm.Notifications
import com.alex.planner.web.alarm.smallId
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.time.LocalDate
import java.time.ZoneId

// The home-screen widgets: Today (today's tasks, tick them right there) and Upcoming (the next two
// weeks' events). The page works out what they show with the same rules as the app
// (web/src/domain/widgets.ts) and pushes it here; these draw it without the page running. Today's and
// tomorrow's tasks both come, so the Today widget turns over at midnight by itself. A tick made here is
// done at once in the widget and in the alarm engine (so its alarm stays quiet), and the page saves and
// syncs it when it next runs: ticks through the alarm engine's queue (Mirror.markDone), un-ticks
// through this file's own queue.

@Serializable data class WidgetTask(val id: Long, val day: Long, val title: String, val done: Boolean, val label: String, val overdue: Boolean, val color: String)
@Serializable data class WidgetDay(val day: Long, val tasks: List<WidgetTask>)
@Serializable data class WidgetEvent(val id: Long, val day: Long, val date: String, val time: String, val title: String, val color: String)
@Serializable data class WidgetPush(val days: List<WidgetDay> = emptyList(), val events: List<WidgetEvent> = emptyList())

private val wjson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

/** What the page last pushed, and the un-ticks made here that it hasn't taken yet. */
object WidgetStore {
    private const val PREFS = "widgets"
    private val lock = Any()
    @Volatile private var cache: WidgetPush? = null

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun data(context: Context): WidgetPush {
        cache?.let { return it }
        val text = prefs(context).getString("data", null) ?: return WidgetPush()
        return runCatching { wjson.decodeFromString(WidgetPush.serializer(), text) }.getOrDefault(WidgetPush()).also { cache = it }
    }

    /** Takes the page's push (JSON text); false if it can't be read. */
    fun replace(context: Context, text: String): Boolean {
        val push = runCatching { wjson.decodeFromString(WidgetPush.serializer(), text) }.getOrNull() ?: return false
        synchronized(lock) {
            prefs(context).edit().putString("data", text).apply()
            cache = push
        }
        return true
    }

    fun undone(context: Context): List<Completion> = synchronized(lock) {
        val text = prefs(context).getString("undone", null) ?: return emptyList()
        runCatching { wjson.decodeFromString(ListSerializer(Completion.serializer()), text) }.getOrDefault(emptyList())
    }

    private fun saveUndone(context: Context, list: List<Completion>) =
        prefs(context).edit().putString("undone", wjson.encodeToString(ListSerializer(Completion.serializer()), list)).apply()

    fun setUndone(context: Context, c: Completion, on: Boolean) = synchronized(lock) {
        val list = undone(context).filter { it != c }
        saveUndone(context, if (on) list + c else list)
    }

    /** Hands the un-ticks to the page (which saves and syncs them). */
    fun takeUndone(context: Context): List<Completion> = synchronized(lock) {
        val list = undone(context)
        if (list.isNotEmpty()) saveUndone(context, emptyList())
        list
    }
}

object Widgets {
    const val ACTION_TOGGLE = "com.alex.planner.web.widget.TOGGLE"
    const val ACTION_MIDNIGHT = "com.alex.planner.web.widget.MIDNIGHT"
    private const val EXTRA_ITEM = "itemId"
    private const val EXTRA_DAY = "day"
    private const val EXTRA_DONE = "done"

    private const val ROW_DP = 36
    private const val EVENT_ROW_DP = 44
    private const val CHROME_DP = 58 // padding and the title line

    /** Draws every placed widget again (after a push, a tick, midnight or a clock change). */
    fun update(context: Context) {
        val ctx = context.applicationContext
        val manager = AppWidgetManager.getInstance(ctx) ?: return
        for (id in manager.getAppWidgetIds(ComponentName(ctx, TodayWidget::class.java))) manager.updateAppWidget(id, today(ctx, manager.getAppWidgetOptions(id)))
        for (id in manager.getAppWidgetIds(ComponentName(ctx, UpcomingWidget::class.java))) manager.updateAppWidget(id, upcoming(ctx, manager.getAppWidgetOptions(id)))
        scheduleMidnight(ctx)
    }

    /** A tick or un-tick from the Today widget. */
    fun toggle(context: Context, itemId: Long, day: Long, done: Boolean) {
        val c = Completion(itemId, day)
        if (done) {
            WidgetStore.setUndone(context, c, false)
            Mirror.markDone(context, itemId, day)
        } else {
            WidgetStore.setUndone(context, c, true)
            Mirror.update(context) { m -> m.copy(completions = m.completions - c, pendingDone = m.pendingDone - c) }
            AlarmEvents.changed("widget")
        }
        AlarmScheduler.rescheduleAll(context)
        update(context)
    }

    private fun today() = LocalDate.now().toEpochDay()

    /** How many rows of [rowDp] fit in the widget's height. */
    private fun rowsFitting(options: Bundle?, rowDp: Int): Int {
        val h = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)?.takeIf { it > 0 } ?: 110
        return ((h - CHROME_DP) / rowDp).coerceAtLeast(1)
    }

    private fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun toggleIntent(context: Context, t: WidgetTask, done: Boolean): PendingIntent {
        val intent = Intent(context, WidgetReceiver::class.java).setAction(ACTION_TOGGLE)
            // A data address per task and day, so each row keeps its own PendingIntent.
            .setData(Uri.parse("planner-widget://toggle/${t.id}/${t.day}"))
            .putExtra(EXTRA_ITEM, t.id).putExtra(EXTRA_DAY, t.day).putExtra(EXTRA_DONE, done)
        return PendingIntent.getBroadcast(context, smallId(t.id xor t.day), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun color(text: String, fallback: Int) = runCatching { Color.parseColor(text) }.getOrDefault(fallback)

    private fun frame(context: Context, title: String): RemoteViews = RemoteViews(context.packageName, R.layout.widget_frame).apply {
        setTextViewText(R.id.w_title, title)
        setOnClickPendingIntent(R.id.w_title, openApp(context))
        setOnClickPendingIntent(R.id.w_root, openApp(context))
        removeAllViews(R.id.w_rows)
    }

    private fun empty(views: RemoteViews, text: String) {
        views.setTextViewText(R.id.w_empty, text)
        views.setViewVisibility(R.id.w_empty, View.VISIBLE)
    }

    private fun more(context: Context, views: RemoteViews, n: Int) {
        val row = RemoteViews(context.packageName, R.layout.widget_more)
        row.setTextViewText(R.id.w_text, "$n more")
        row.setOnClickPendingIntent(R.id.w_text, openApp(context))
        views.addView(R.id.w_rows, row)
    }

    private fun today(context: Context, options: Bundle?): RemoteViews {
        val t = today()
        val data = WidgetStore.data(context)
        val day = data.days.firstOrNull { it.day == t }
        val pending = Mirror.current(context).pendingDone.toSet()
        val undone = WidgetStore.undone(context).toSet()
        val tasks = day?.tasks?.map {
            val c = Completion(it.id, it.day)
            val done = (it.done || c in pending) && c !in undone
            if (done == it.done) it else it.copy(done = done)
        }.orEmpty()
        val left = tasks.count { !it.done }
        val views = frame(context, when {
            day == null || tasks.isEmpty() -> "Today"
            left == 0 -> "Today · all done"
            else -> "Today · $left left"
        })
        views.setViewVisibility(R.id.w_empty, View.GONE)
        if (day == null) { empty(views, "Open Planner to see today’s tasks"); return views }
        if (tasks.isEmpty()) { empty(views, "Nothing due today"); return views }
        val fit = rowsFitting(options, ROW_DP)
        val shown = if (tasks.size > fit) fit - 1 else tasks.size
        for (task in tasks.take(shown.coerceAtLeast(0))) {
            val row = RemoteViews(context.packageName, R.layout.widget_task_row)
            row.setImageViewResource(R.id.w_check, if (task.done) R.drawable.widget_check_on else R.drawable.widget_check_off)
            row.setContentDescription(R.id.w_check, if (task.done) "Mark not done" else "Mark done")
            row.setOnClickPendingIntent(R.id.w_check, toggleIntent(context, task, !task.done))
            row.setTextViewText(R.id.w_text, task.title)
            row.setInt(R.id.w_text, "setPaintFlags", Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG or (if (task.done) Paint.STRIKE_THRU_TEXT_FLAG else 0))
            row.setTextColor(R.id.w_text, context.getColor(if (task.done) R.color.widget_muted else R.color.widget_text))
            row.setTextViewText(R.id.w_label, task.label)
            row.setViewVisibility(R.id.w_label, if (task.label.isEmpty()) View.GONE else View.VISIBLE)
            row.setTextColor(R.id.w_label, context.getColor(if (task.overdue && !task.done) R.color.widget_overdue else R.color.widget_muted))
            row.setOnClickPendingIntent(R.id.w_row, Notifications.openItemIntent(context, task.id))
            views.addView(R.id.w_rows, row)
        }
        if (shown < tasks.size) more(context, views, tasks.size - shown)
        return views
    }

    private fun upcoming(context: Context, options: Bundle?): RemoteViews {
        val t = today()
        val events = WidgetStore.data(context).events.filter { it.day >= t }
        val views = frame(context, "Upcoming")
        views.setViewVisibility(R.id.w_empty, View.GONE)
        if (events.isEmpty()) { empty(views, "No events in the next two weeks"); return views }
        val fit = rowsFitting(options, EVENT_ROW_DP)
        val shown = if (events.size > fit) fit - 1 else events.size
        val fallback = context.getColor(R.color.widget_muted)
        for (e in events.take(shown.coerceAtLeast(0))) {
            val row = RemoteViews(context.packageName, R.layout.widget_event_row)
            row.setInt(R.id.w_bar, "setColorFilter", color(e.color, fallback))
            row.setTextViewText(R.id.w_text, e.title)
            val whenText = when (e.day) { t -> "Today"; t + 1 -> "Tomorrow"; else -> e.date }
            row.setTextViewText(R.id.w_label, "$whenText · ${e.time}")
            row.setOnClickPendingIntent(R.id.w_row, Notifications.openItemIntent(context, e.id))
            views.addView(R.id.w_rows, row)
        }
        if (shown < events.size) more(context, views, events.size - shown)
        return views
    }

    /** Draws the widgets again just after midnight, so Today shows the new day's tasks. */
    private fun scheduleMidnight(context: Context) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val pi = PendingIntent.getBroadcast(
            context, 7301, Intent(context, WidgetReceiver::class.java).setAction(ACTION_MIDNIGHT),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val anyPlaced = listOf(TodayWidget::class.java, UpcomingWidget::class.java).any {
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, it)).isNotEmpty()
        }
        if (!anyPlaced) { am.cancel(pi); return }
        val at = LocalDate.now().plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli() + 5_000
        // Not exact: a minute or two late is fine, and it doesn't need the exact-alarm permission.
        am.set(AlarmManager.RTC, at, pi)
    }

    internal fun handle(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_TOGGLE -> {
                val id = intent.getLongExtra(EXTRA_ITEM, 0)
                val day = intent.getLongExtra(EXTRA_DAY, Long.MIN_VALUE)
                if (id != 0L && day != Long.MIN_VALUE) toggle(context, id, day, intent.getBooleanExtra(EXTRA_DONE, true))
            }
            else -> update(context)
        }
    }
}

/** Today's tasks, with ticks. */
class TodayWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = Widgets.update(context)
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) = Widgets.update(context)
    override fun onDisabled(context: Context) = Widgets.update(context)
}

/** The next two weeks' events. */
class UpcomingWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = Widgets.update(context)
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) = Widgets.update(context)
    override fun onDisabled(context: Context) = Widgets.update(context)
}

/** Ticks from the Today widget, the midnight turn-over, and clock or time-zone changes. */
class WidgetReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        Thread {
            try { Widgets.handle(context.applicationContext, intent) } finally { pending.finish() }
        }.start()
    }
}
