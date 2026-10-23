package com.alex.planner.web.device

import android.content.ActivityNotFoundException
import android.content.Intent
import android.location.Address
import android.location.Geocoder
import android.net.Uri
import android.os.Build
import android.text.format.DateFormat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.Locale

/**
 * Small things only Android knows, for the page (web/src/ui/phone/device.ts): whether the phone shows
 * 24-hour time, places matching a typed location (Android's own geocoder, as the original app's
 * Places.search), a place opened in the maps app (Places.openMap: shown, no directions started), and
 * the touch feel (Feel.kt, from web/src/ui/phone/haptics.ts).
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

    /** One soft pulse of the named strength: "tick", "pickup", "settle" or "confirm" (Feel.kt). */
    @PluginMethod
    fun feel(call: PluginCall) {
        Feel.play(context, call.getString("kind") ?: "tick")
        call.resolve()
    }
}
