package com.alex.planner.web.calendar

import android.Manifest
import android.content.ContentUris
import android.content.Intent
import android.net.Uri
import android.provider.CalendarContract
import android.provider.Settings
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.Calendar
import java.util.TimeZone

/**
 * The phone's calendars, read only (272): Google Calendar's birthdays, holidays and the user's own
 * calendars, as Android's calendar store keeps them (Google Calendar syncs into it; no Google sign-in
 * here). Asked for only when the user opens Settings → Import from Google Calendar. The page
 * (web/src/store/phoneCalendar.ts, domain/phoneCalendar.ts) turns what this returns into events.
 * Nothing is written to the phone's calendars.
 */
@CapacitorPlugin(
    name = "PhoneCalendar",
    permissions = [Permission(alias = "calendar", strings = [Manifest.permission.READ_CALENDAR])],
)
class CalendarPlugin : Plugin() {
    private fun granted() = getPermissionState("calendar") == PermissionState.GRANTED

    /** {granted}: whether the calendars may be read now. */
    @PluginMethod
    fun permission(call: PluginCall) {
        call.resolve(JSObject().put("granted", granted()))
    }

    /** Asks for the calendars (Android's own dialog, unless already answered for good), then {granted}. */
    @PluginMethod
    fun request(call: PluginCall) {
        if (granted()) return call.resolve(JSObject().put("granted", true))
        requestPermissionForAlias("calendar", call, "requestAnswered")
    }

    @PermissionCallback
    private fun requestAnswered(call: PluginCall) {
        call.resolve(JSObject().put("granted", granted()))
    }

    /** This app's page in the phone's settings (where a permission refused for good is given). */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { activity?.startActivity(intent) }
        call.resolve()
    }

    /**
     * {calendars, events}: every calendar, and every event from the start of today on. A repeating event
     * comes once per occurrence in the next [days] days (400), each with the series' rule, except a
     * yearly one (a birthday), which comes once: its next occurrence, with its rule. One-off events further
     * ahead come too. Cancelled ones are left out.
     */
    @PluginMethod
    fun read(call: PluginCall) {
        if (!granted()) return call.reject("not allowed", "denied")
        val days = call.getInt("days") ?: 400
        Thread {
            try {
                call.resolve(JSObject().put("calendars", calendars()).put("events", events(days)))
            } catch (e: Exception) {
                call.reject(e.message ?: "read failed")
            }
        }.start()
    }

    private fun calendars(): JSArray {
        val out = JSArray()
        val cols = arrayOf(
            CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.Calendars.OWNER_ACCOUNT, CalendarContract.Calendars.CALENDAR_COLOR,
        )
        context.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                out.put(
                    JSObject()
                        .put("id", c.getLong(0).toString())
                        .put("name", c.getString(1) ?: "")
                        .put("account", c.getString(2) ?: "")
                        .put("accountType", c.getString(3) ?: "")
                        .put("owner", c.getString(4) ?: "")
                        .put("color", if (c.isNull(5)) null else c.getInt(5)),
                )
            }
        }
        return out
    }

    /** Google's own id for each event (the same on every phone), by the event's id here. */
    private fun syncIds(): Map<Long, String> {
        val out = HashMap<Long, String>()
        val cols = arrayOf(CalendarContract.Events._ID, CalendarContract.Events._SYNC_ID)
        context.contentResolver.query(CalendarContract.Events.CONTENT_URI, cols, "${CalendarContract.Events.DELETED} = 0", null, null)?.use { c ->
            while (c.moveToNext()) if (!c.isNull(1)) out[c.getLong(0)] = c.getString(1)
        }
        return out
    }

    private fun events(days: Int): JSArray {
        val out = JSArray()
        val sync = syncIds()
        val from = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        // All-day events are kept in UTC: from the earlier of local and UTC midnight, so today's are in.
        val start = from - 14 * 3_600_000L
        val end = from + days * 86_400_000L
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().also {
            ContentUris.appendId(it, start)
            ContentUris.appendId(it, end)
        }.build()
        val cols = arrayOf(
            CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.CALENDAR_ID, CalendarContract.Instances.TITLE,
            CalendarContract.Instances.DESCRIPTION, CalendarContract.Instances.EVENT_LOCATION, CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.BEGIN, CalendarContract.Instances.END, CalendarContract.Instances.RRULE, CalendarContract.Instances.STATUS,
        )
        val yearlySeen = HashSet<Long>()
        val utcToday = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            val l = Calendar.getInstance()
            clear(); set(l.get(Calendar.YEAR), l.get(Calendar.MONTH), l.get(Calendar.DAY_OF_MONTH))
        }.timeInMillis
        context.contentResolver.query(uri, cols, null, null, "${CalendarContract.Instances.BEGIN} ASC")?.use { c ->
            while (c.moveToNext()) {
                if (!c.isNull(9) && c.getInt(9) == CalendarContract.Events.STATUS_CANCELED) continue
                val id = c.getLong(0)
                val allDay = c.getInt(5) != 0
                val begin = c.getLong(6)
                val stop = c.getLong(7)
                // Over before today began (local midnight; an all-day one's end is a UTC midnight, exclusive).
                if (stop <= (if (allDay) utcToday else from) && stop > begin) continue
                val rrule = c.getString(8)
                if (rrule != null && rrule.uppercase().contains("FREQ=YEARLY")) {
                    if (!yearlySeen.add(id)) continue
                }
                out.put(event(id, c.getLong(1), sync[id], c.getString(2), c.getString(3), c.getString(4), allDay, begin, stop, rrule))
            }
        }
        // One-off events beyond the window.
        val ecols = arrayOf(
            CalendarContract.Events._ID, CalendarContract.Events.CALENDAR_ID, CalendarContract.Events.TITLE, CalendarContract.Events.DESCRIPTION,
            CalendarContract.Events.EVENT_LOCATION, CalendarContract.Events.ALL_DAY, CalendarContract.Events.DTSTART, CalendarContract.Events.DTEND,
        )
        val sel = "${CalendarContract.Events.DELETED} = 0 AND ${CalendarContract.Events.RRULE} IS NULL AND ${CalendarContract.Events.DTSTART} >= ? AND " +
            "(${CalendarContract.Events.STATUS} IS NULL OR ${CalendarContract.Events.STATUS} != ${CalendarContract.Events.STATUS_CANCELED})"
        context.contentResolver.query(CalendarContract.Events.CONTENT_URI, ecols, sel, arrayOf(end.toString()), null)?.use { c ->
            while (c.moveToNext()) {
                val id = c.getLong(0)
                val begin = c.getLong(6)
                val stop = if (c.isNull(7)) begin else c.getLong(7)
                out.put(event(id, c.getLong(1), sync[id], c.getString(2), c.getString(3), c.getString(4), c.getInt(5) != 0, begin, stop, null))
            }
        }
        return out
    }

    private fun event(id: Long, calendar: Long, syncId: String?, title: String?, description: String?, location: String?, allDay: Boolean, begin: Long, end: Long, rrule: String?) =
        JSObject()
            .put("eventId", id.toString())
            .put("calendarId", calendar.toString())
            .put("syncId", syncId)
            .put("title", title ?: "")
            .put("description", description ?: "")
            .put("location", location ?: "")
            .put("allDay", allDay)
            .put("begin", begin)
            .put("end", end)
            .put("rrule", rrule)
}
