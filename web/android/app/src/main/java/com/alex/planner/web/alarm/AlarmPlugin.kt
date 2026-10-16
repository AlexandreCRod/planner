package com.alex.planner.web.alarm

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationManagerCompat
import com.alex.planner.web.widget.WidgetStore
import com.alex.planner.web.widget.Widgets
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.time.ZoneId

/**
 * The page's door to the alarm engine (web/src/alarms/native.ts). Values travel as JSON text in a
 * "json" field, decoded with the same shapes the engine stores. Every change made natively (from a
 * notification, the ringing screen or a timer running out) is announced with a "changed" event, so the
 * page shows the same state.
 */
@CapacitorPlugin(
    name = "Alarms",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class AlarmPlugin : Plugin() {
    /** What a notification or the alarm clock's icon asked to open, until the page takes it. */
    private var launchItem: Long? = null
    private var launchSection: String? = null

    override fun load() {
        Notifications.createChannels(context)
        AlarmEvents.listener = { what -> notifyListeners("changed", JSObject().put("what", what)) }
        readLaunch(activity?.intent)
        // Whatever the page last pushed is set again (e.g. the app was updated, or force-stopped).
        Thread {
            AlarmScheduler.rescheduleAll(context)
            ClockAlarms.rescheduleAll(context)
            ClockTools.rescheduleAll(context)
        }.start()
    }

    override fun handleOnNewIntent(intent: Intent) {
        if (readLaunch(intent)) notifyListeners("launch", JSObject())
    }

    override fun handleOnResume() {
        // Permissions may have been changed in the system settings meanwhile.
        notifyListeners("changed", JSObject().put("what", "resume"))
    }

    override fun handleOnDestroy() {
        AlarmEvents.listener = null
    }

    private fun readLaunch(intent: Intent?): Boolean {
        intent ?: return false
        var any = false
        if (intent.hasExtra(Notifications.EXTRA_OPEN_ITEM)) {
            launchItem = intent.getLongExtra(Notifications.EXTRA_OPEN_ITEM, 0).takeIf { it != 0L }
            intent.removeExtra(Notifications.EXTRA_OPEN_ITEM)
            any = true
        }
        if (intent.hasExtra(Notifications.EXTRA_OPEN_SECTION)) {
            launchSection = intent.getStringExtra(Notifications.EXTRA_OPEN_SECTION)
            intent.removeExtra(Notifications.EXTRA_OPEN_SECTION)
            any = true
        }
        return any
    }

    private fun ok(call: PluginCall, jsonText: String? = null) {
        if (jsonText == null) call.resolve() else call.resolve(JSObject().put("json", jsonText))
    }

    // ---------- The data mirror ----------

    /** The page's alarm-relevant records and settings; everything is set again from them. */
    @PluginMethod
    fun sync(call: PluginCall) {
        val text = call.getString("json") ?: return call.reject("json missing")
        val push = runCatching { json.decodeFromString(MirrorPush.serializer(), text) }.getOrElse { return call.reject("bad json: ${it.message}") }
        Mirror.replace(context, push)
        AlarmScheduler.rescheduleAll(context)
        ok(call)
    }

    /** Completions ticked natively (notification "Done", ringing screen "Mark done"), for the page to save. */
    @PluginMethod
    fun takeDone(call: PluginCall) = ok(call, json.encodeToString(ListSerializer(Completion.serializer()), Mirror.takePendingDone(context)))

    /** What the home-screen widgets show (web/src/alarms/widgets.ts); they're drawn again from it. */
    @PluginMethod
    fun widgets(call: PluginCall) {
        val text = call.getString("json") ?: return call.reject("json missing")
        if (!WidgetStore.replace(context, text)) return call.reject("bad json")
        Widgets.update(context)
        ok(call)
    }

    /** Tasks un-ticked on the Today widget, for the page to save (ticks come through takeDone). */
    @PluginMethod
    fun takeWidgetUndone(call: PluginCall) = ok(call, json.encodeToString(ListSerializer(Completion.serializer()), WidgetStore.takeUndone(context)))

    @PluginMethod
    fun takeLaunch(call: PluginCall) {
        val o = JSObject()
        launchItem?.let { o.put("itemId", it) }
        launchSection?.let { o.put("section", it) }
        launchItem = null
        launchSection = null
        call.resolve(o)
    }

    // ---------- State for the Alarms page ----------

    @Serializable
    data class Ring(val rings: Boolean, val explicit: Boolean?, val originalInstalled: Boolean)

    @Serializable
    data class Perms(val notifications: Boolean, val fullScreen: Boolean, val exact: Boolean, val batteryExempt: Boolean)

    @Serializable
    data class State(val alarms: List<ClockAlarm>, val tools: ClockToolsState, val ring: Ring, val perms: Perms, val zone: String, val weatherApp: String?)

    @PluginMethod
    fun state(call: PluginCall) {
        val s = State(
            alarms = ClockAlarms.all(context),
            tools = ClockTools.current(context),
            ring = Ring(RingDevice.ringsEvents(context), RingDevice.explicit(context), RingDevice.originalInstalled(context)),
            perms = perms(),
            zone = ZoneId.systemDefault().id,
            weatherApp = weatherApp()?.second,
        )
        ok(call, json.encodeToString(State.serializer(), s))
    }

    private fun perms(): Perms {
        val nm = context.getSystemService(NotificationManager::class.java)
        val am = context.getSystemService(AlarmManager::class.java)
        val pm = context.getSystemService(PowerManager::class.java)
        return Perms(
            notifications = NotificationManagerCompat.from(context).areNotificationsEnabled(),
            fullScreen = Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent(),
            exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms(),
            batteryExempt = pm.isIgnoringBatteryOptimizations(context.packageName),
        )
    }

    // ---------- An event's or task's alarms (the item view's early controls) ----------

    /** One line of the item view's alarm controls (native EarlyAlarmControls). */
    @Serializable
    data class Control(
        /** "soon": rings within 23 h; "skipped": set not to ring; "rang": snoozed from the ringing screen. */
        val kind: String,
        val reminderId: Long,
        /** When it rings (or would have, for "skipped"). */
        val at: Long,
        /** When it was due before any early snooze ("soon", "skipped"); 0 for "rang". */
        val original: Long,
        val canSnooze: Boolean,
    )

    @PluginMethod
    fun controls(call: PluginCall) {
        val itemId = call.num("itemId") ?: return call.reject("itemId missing")
        val out = ArrayList<Control>()
        val item = Mirror.item(context, itemId)
        if (item != null && RingDevice.ringsEvents(context)) {
            val alarms = Mirror.current(context).reminders.filter { it.itemId == itemId && it.type == AlertType.ALARM }
            val now = System.currentTimeMillis()
            alarms.forEach { r -> AlarmOverrides.ringSnooze(context, r.id)?.let { out += Control("rang", r.id, it, 0, false) } }
            alarms.forEach { r ->
                val fire = AlarmScheduler.nextFireNow(context, item, r) ?: return@forEach
                if (fire.atMillis - now <= AlarmScheduler.EARLY_CONTROL_MS) {
                    out += Control("soon", r.id, fire.atMillis, fire.originalMillis, AlarmScheduler.canSnoozeEarly(fire.atMillis))
                }
            }
            alarms.forEach { r -> AlarmOverrides.stoppedAhead(context, r.id).forEach { out += Control("skipped", r.id, it, it, false) } }
        }
        ok(call, json.encodeToString(ListSerializer(Control.serializer()), out))
    }

    private fun itemAndReminder(call: PluginCall): Pair<Item, Reminder>? {
        val r = call.num("reminderId")?.let { Mirror.reminder(context, it) } ?: return null
        val item = Mirror.item(context, r.itemId) ?: return null
        return item to r
    }

    /** From the task or event view, up to 23 hours ahead: ring this occurrence later (PlannerViewModel.earlySnooze). */
    @PluginMethod
    fun earlySnooze(call: PluginCall) {
        val (item, r) = itemAndReminder(call) ?: return call.reject("unknown reminder")
        val original = call.num("original") ?: return call.reject("original missing")
        val current = AlarmOverrides.adjusted(context, r.id, original) ?: return ok(call)
        if (!AlarmScheduler.canSnoozeEarly(current)) return ok(call)
        AlarmOverrides.delay(context, r.id, original, current + Mirror.settings(context).snoozeMinutes * 60_000L)
        Notifications.cancelUpcoming(context, r.id)
        AlarmScheduler.scheduleItem(context, item, listOf(r))
        ok(call)
    }

    /** From the task or event view: don't ring this occurrence (a repeating alarm still rings next time). */
    @PluginMethod
    fun earlyStop(call: PluginCall) {
        val (item, r) = itemAndReminder(call) ?: return call.reject("unknown reminder")
        val original = call.num("original") ?: return call.reject("original missing")
        AlarmOverrides.stop(context, r.id, original)
        Notifications.cancelUpcoming(context, r.id)
        AlarmScheduler.scheduleItem(context, item, listOf(r))
        ok(call)
    }

    /** Undoes an early snooze or "don't ring", and a snooze from the ringing screen: back to the original time. */
    @PluginMethod
    fun resetAlarm(call: PluginCall) {
        val (item, r) = itemAndReminder(call) ?: return call.reject("unknown reminder")
        val original = call.num("original")?.takeIf { it != 0L }
        if (original != null) AlarmOverrides.reset(context, r.id, original)
        AlarmScheduler.cancelSnooze(context, r.id)
        Notifications.cancelUpcoming(context, r.id)
        AlarmOverrides.forgetNotice(context, r.id, original)
        AlarmScheduler.scheduleItem(context, item, listOf(r))
        ok(call)
    }

    // ---------- Clock alarms, timers, stopwatch, world clock ----------

    @PluginMethod
    fun saveClock(call: PluginCall) {
        val text = call.getString("json") ?: return call.reject("json missing")
        var a = runCatching { json.decodeFromString(ClockAlarm.serializer(), text) }.getOrElse { return call.reject("bad json") }
        if (a.id == 0L) a = a.copy(id = System.currentTimeMillis())
        ClockAlarms.save(context, a)
        call.resolve(JSObject().put("id", a.id))
    }

    @PluginMethod
    fun deleteClock(call: PluginCall) {
        ClockAlarms.delete(context, call.num("id") ?: return call.reject("id missing"))
        ok(call)
    }

    @PluginMethod
    fun timer(call: PluginCall) {
        val now = System.currentTimeMillis()
        val action = call.getString("action") ?: return call.reject("action missing")
        if (action == "start") {
            val ms = call.num("durationMs") ?: return call.reject("durationMs missing")
            ClockTools.startTimer(context, ms, call.getString("label") ?: "")
            return ok(call)
        }
        val id = call.num("id") ?: return call.reject("id missing")
        val t = ClockTools.timer(context, id) ?: return ok(call)
        when (action) {
            "pause" -> ClockTools.saveTimer(context, t.pause(now))
            "resume" -> ClockTools.saveTimer(context, t.start(now))
            "plus" -> ClockTools.saveTimer(context, t.plusMinute())
            "reset" -> ClockTools.saveTimer(context, t.reset())
            "delete" -> ClockTools.deleteTimer(context, id)
        }
        ok(call)
    }

    @PluginMethod
    fun stopwatch(call: PluginCall) {
        val now = System.currentTimeMillis()
        val sw = ClockTools.current(context).stopwatch
        ClockTools.saveStopwatch(
            context,
            when (call.getString("action")) {
                "start" -> sw.start(now)
                "pause" -> sw.pause(now)
                "lap" -> sw.lap(now)
                else -> Stopwatch()
            },
        )
        ok(call)
    }

    @PluginMethod
    fun zone(call: PluginCall) {
        val z = call.getString("zone") ?: return call.reject("zone missing")
        if (call.getString("action") == "remove") ClockTools.removeZone(context, z) else ClockTools.addZone(context, z)
        ok(call)
    }

    // ---------- Ring on this phone ----------

    /** true / false, or null to follow whether the original app is installed. */
    @PluginMethod
    fun setRingEvents(call: PluginCall) {
        val v = if (call.data.isNull("value") || !call.data.has("value")) null else call.getBoolean("value")
        RingDevice.set(context, v)
        if (RingDevice.ringsEvents(context)) AlarmScheduler.rescheduleAll(context) else AlarmScheduler.cancelAll(context)
        AlarmEvents.changed("ring")
        ok(call)
    }

    // ---------- Sounds ----------

    @PluginMethod
    fun pickSound(call: PluginCall) {
        val current = call.getString("current")
        val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, call.getString("title") ?: "Alarm sound")
            .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, current?.let(Uri::parse))
        startActivityForResult(call, intent, "soundPicked")
    }

    @ActivityCallback
    private fun soundPicked(call: PluginCall?, result: ActivityResult) {
        call ?: return
        if (result.resultCode != android.app.Activity.RESULT_OK) return call.resolve(JSObject().put("picked", false))
        @Suppress("DEPRECATION")
        val uri = result.data?.getParcelableExtra<Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
        val o = JSObject().put("picked", true)
        // The "Default" entry means no sound of its own.
        val own = uri?.takeUnless { RingtoneManager.isDefault(it) }
        o.put("uri", own?.toString())
        o.put("name", own?.let { soundTitle(it) })
        call.resolve(o)
    }

    @PluginMethod
    fun soundName(call: PluginCall) {
        val uri = call.getString("uri")?.let(Uri::parse)
        call.resolve(JSObject().put("name", uri?.let { soundTitle(it) }))
    }

    private fun soundTitle(uri: Uri): String? = runCatching { RingtoneManager.getRingtone(context, uri)?.getTitle(context) }.getOrNull()

    // ---------- Weather app ----------

    private fun weatherPrefs() = context.getSharedPreferences("weather-app", Context.MODE_PRIVATE)

    /** The app picked in Settings: its component and the name shown for it. */
    private fun weatherApp(): Pair<ComponentName, String>? {
        val p = weatherPrefs()
        val c = p.getString("component", null)?.let(ComponentName::unflattenFromString) ?: return null
        return c to (p.getString("label", null) ?: c.packageName)
    }

    /**
     * Lets the user pick the weather app in Android's own app picker, so this app never lists the
     * installed apps itself; only the one picked is remembered.
     */
    @PluginMethod
    fun pickWeatherApp(call: PluginCall) {
        val pick = Intent(Intent.ACTION_PICK_ACTIVITY)
            .putExtra(Intent.EXTRA_INTENT, Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER))
            .putExtra(Intent.EXTRA_TITLE, "Weather app")
        try {
            startActivityForResult(call, pick, "weatherPicked")
        } catch (_: ActivityNotFoundException) {
            call.reject("No app picker on this phone")
        }
    }

    @ActivityCallback
    private fun weatherPicked(call: PluginCall?, result: ActivityResult) {
        call ?: return
        val c = result.data?.component
        if (result.resultCode != android.app.Activity.RESULT_OK || c == null) return call.resolve(JSObject().put("picked", false))
        // Android hides other apps from this one (no app list is asked for), so the picked app's own name
        // usually can't be read; a name made from its package stands in ("com.google.android.deskclock": "Deskclock").
        val label = runCatching { context.packageManager.getActivityInfo(c, 0).loadLabel(context.packageManager).toString() }.getOrNull()
            ?: nameFromPackage(c.packageName)
        weatherPrefs().edit().putString("component", c.flattenToString()).putString("label", label).apply()
        call.resolve(JSObject().put("picked", true).put("label", label))
    }

    @PluginMethod
    fun clearWeatherApp(call: PluginCall) {
        weatherPrefs().edit().clear().apply()
        ok(call)
    }

    /** Opens the picked weather app, else [url] (a weather page for the city) in the browser. */
    @PluginMethod
    fun openWeather(call: PluginCall) {
        val app = weatherApp()
        val activity = activity ?: return call.reject("no activity")
        if (app != null) {
            val open = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(app.first).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (runCatching { activity.startActivity(open) }.isSuccess) return call.resolve(JSObject().put("opened", "app"))
        }
        val url = call.getString("url") ?: return call.reject("url missing")
        runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { return call.reject("can't open") }
        call.resolve(JSObject().put("opened", "web"))
    }

    // ---------- Permissions ----------

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            return call.resolve(JSObject().put("granted", NotificationManagerCompat.from(context).areNotificationsEnabled()))
        }
        requestPermissionForAlias("notifications", call, "notificationsAnswered")
    }

    @PermissionCallback
    private fun notificationsAnswered(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState("notifications") == PermissionState.GRANTED))
    }

    /** Opens the system screen for "notifications", "fullScreen", "battery" or "exact". */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        val pkg = context.packageName
        val intent = when (call.getString("which")) {
            "fullScreen" -> if (Build.VERSION.SDK_INT >= 34) Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$pkg")) else null
            "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            "exact" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$pkg")) else null
            else -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
        } ?: return ok(call)
        runCatching { activity?.startActivity(intent) }
        ok(call)
    }
}

/** A whole number argument, whether JavaScript sent it as an Int or a Long (getLong only takes a Long). */
private fun PluginCall.num(name: String): Long? = (data.opt(name) as? Number)?.toLong()

private val GENERIC_SEGMENTS = setOf("com", "org", "net", "io", "de", "fr", "co", "uk", "android", "app", "apps", "google", "mobile", "free", "pro", "lite", "client")

/** A readable stand-in for an app's name: the most specific part of its package that isn't generic. */
internal fun nameFromPackage(pkg: String): String {
    val part = pkg.split('.').lastOrNull { it.isNotBlank() && it.lowercase() !in GENERIC_SEGMENTS } ?: return pkg
    return part.replaceFirstChar { it.uppercase() }
}
