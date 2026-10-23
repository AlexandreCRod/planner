package com.alex.planner.web.device

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.graphics.Rect
import android.location.Address
import android.location.Geocoder
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.text.format.DateFormat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.OutputStream
import java.util.Locale
import java.util.UUID

/**
 * Small things only Android knows, for the page (web/src/ui/phone/device.ts): whether the phone shows
 * 24-hour time, places matching a typed location (Android's own geocoder, as the original app's
 * Places.search), a place opened in the maps app (Places.openMap: shown, no directions started), and
 * the touch feel (Feel.kt, from web/src/ui/phone/haptics.ts), and a note's picture or video saved to the
 * phone's gallery.
 */
@CapacitorPlugin(name = "Device")
class DevicePlugin : Plugin() {
    /** The phone's "Use 24-hour format" setting (or its locale's default when that is automatic). */
    @PluginMethod
    fun clock(call: PluginCall) {
        call.resolve(JSObject().put("is24", DateFormat.is24HourFormat(context)))
    }

    /** Up to [max] places matching [query]: {places: [{name, lat, lng}]}, empty when nothing (or no geocoder). */
    @PluginMethod
    fun geocode(call: PluginCall) {
        val query = call.getString("query")?.trim().orEmpty()
        val max = (call.getInt("max") ?: 5).coerceIn(1, 10)
        if (query.isEmpty() || !Geocoder.isPresent()) return call.resolve(places(emptyList(), query))
        val geocoder = Geocoder(context, Locale.getDefault())
        if (Build.VERSION.SDK_INT >= 33) {
            // Answered on a background thread by the system; the call is resolved from there.
            geocoder.getFromLocationName(query, max, object : Geocoder.GeocodeListener {
                override fun onGeocode(addresses: MutableList<Address>) { call.resolve(places(addresses, query)) }
                override fun onError(errorMessage: String?) { call.resolve(places(emptyList(), query)) }
            })
        } else {
            Thread {
                val found = runCatching { @Suppress("DEPRECATION") geocoder.getFromLocationName(query, max) }.getOrNull()
                call.resolve(places(found.orEmpty(), query))
            }.start()
        }
    }

    private fun places(list: List<Address>, query: String): JSObject {
        val out = JSArray()
        val seen = HashSet<String>()
        for (a in list) {
            if (!a.hasLatitude() || !a.hasLongitude()) continue
            val line = a.getAddressLine(0) ?: query
            if (!seen.add(line)) continue
            // The whole address line is what the item keeps as its location (as the original app does).
            out.put(JSObject().put("name", line).put("lat", a.latitude).put("lng", a.longitude))
        }
        return JSObject().put("places", out)
    }

    /**
     * Shows the place in the maps app without starting directions: geo:lat,lng?q=lat,lng(name) when its
     * coordinates are known, else geo:0,0?q=name; the browser's map search when no app takes geo: links.
     */
    @PluginMethod
    fun openMap(call: PluginCall) {
        val name = call.getString("name")?.trim().orEmpty()
        val lat = call.getDouble("lat")
        val lng = call.getDouble("lng")
        val activity = activity ?: return call.reject("no activity")
        val point = lat != null && lng != null
        if (!point && name.isEmpty()) return call.reject("nothing to show")
        val geo = if (point) "geo:$lat,$lng?q=$lat,$lng(${Uri.encode(name)})" else "geo:0,0?q=${Uri.encode(name)}"
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(geo)))
        } catch (_: ActivityNotFoundException) {
            val q = if (point) "$lat,$lng" else name
            runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=${Uri.encode(q)}"))) }
                .onFailure { return call.reject("can't open") }
        }
        call.resolve()
    }

    /**
     * Where the page's text selection is, in the WebView's pixels ({left, top, right, bottom}), or
     * {clear: true}: the selection toolbar is placed right above it (PlannerWebView.kt).
     */
    @PluginMethod
    fun selectionRect(call: PluginCall) {
        val r = if (call.getBoolean("clear", false) == true) null else Rect(
            call.getInt("left") ?: 0, call.getInt("top") ?: 0, call.getInt("right") ?: 0, call.getInt("bottom") ?: 0,
        )
        SelectionToolbar.set(r)
        if (r != null) activity?.runOnUiThread { runCatching { SelectionToolbar.mode.get()?.invalidateContentRect() } }
        call.resolve()
    }

    /** One soft pulse of the named strength: "tick", "pickup", "settle" or "confirm" (Feel.kt). */
    @PluginMethod
    fun feel(call: PluginCall) {
        Feel.play(context, call.getString("kind") ?: "tick")
        call.resolve()
    }

    // ---------- Saving a note's picture or video to the phone ----------
    // Sent in pieces (base64), so a large video never goes through the bridge in one message: start (a
    // new file in Pictures/Planner or Movies/Planner, hidden until finished), the pieces in order, end.
    private class Saving(val uri: Uri, val out: OutputStream)
    private val saving = HashMap<String, Saving>()

    @PluginMethod
    fun saveMediaStart(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 29) return call.reject("Saving to the phone needs Android 10 or later")
        val name = call.getString("name")?.takeIf { it.isNotBlank() } ?: "Planner"
        val mime = call.getString("mime") ?: "image/jpeg"
        val video = mime.startsWith("video/")
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, (if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES) + "/Planner")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val collection = if (video) MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            else MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val resolver = context.contentResolver
        val uri = runCatching { resolver.insert(collection, values) }.getOrNull() ?: return call.reject("Couldn't create the file")
        val out = runCatching { resolver.openOutputStream(uri) }.getOrNull()
        if (out == null) { resolver.delete(uri, null, null); return call.reject("Couldn't open the file") }
        val id = UUID.randomUUID().toString()
        synchronized(saving) { saving[id] = Saving(uri, out) }
        call.resolve(JSObject().put("id", id))
    }

    @PluginMethod
    fun saveMediaPiece(call: PluginCall) {
        val s = synchronized(saving) { saving[call.getString("id") ?: ""] } ?: return call.reject("No such save")
        val data = call.getString("data") ?: return call.reject("No data")
        runCatching { s.out.write(Base64.decode(data, Base64.DEFAULT)) }
            .onSuccess { call.resolve() }
            .onFailure { call.reject("Couldn't write the file") }
    }

    /** Finishes the file (shown in the gallery from now on), or with {cancel: true} removes it. */
    @PluginMethod
    fun saveMediaEnd(call: PluginCall) {
        val s = synchronized(saving) { saving.remove(call.getString("id") ?: "") } ?: return call.reject("No such save")
        val resolver = context.contentResolver
        runCatching { s.out.close() }
        if (call.getBoolean("cancel", false) == true) {
            runCatching { resolver.delete(s.uri, null, null) }
            return call.resolve()
        }
        runCatching { resolver.update(s.uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null) }
            .onSuccess { call.resolve() }
            .onFailure { call.reject("Couldn't finish the file") }
    }
}
