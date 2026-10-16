package com.alex.planner.web.invite

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayOutputStream

/**
 * Calendar invites opened with this app (an invite.ics in Gmail, a .ics in Files): reads the file the
 * other app shared through its content:// address, and hands the text to the page
 * (web/src/ui/phone/InviteHost.tsx), which reads the event and shows it in the editor. Only the shared
 * file is read; nothing goes over the network and no other address is opened.
 */
@CapacitorPlugin(name = "Invite")
class InvitePlugin : Plugin() {
    /** The last file opened, until the page takes it: {text, name} or {error}. */
    @Volatile private var pending: JSObject? = null

    override fun load() {
        read(activity?.intent)
    }

    override fun handleOnNewIntent(intent: Intent) {
        read(intent)
    }

    /** The file opened last, once (an empty object when there is none, or it's still being read). */
    @PluginMethod
    fun take(call: PluginCall) {
        val p = pending
        pending = null
        call.resolve(p ?: JSObject())
    }

    private fun read(intent: Intent?) {
        intent ?: return
        if (intent.action != Intent.ACTION_VIEW) return
        // Reopened from the recent apps: that file was already shown.
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        val uri = intent.data ?: return
        if (uri.scheme != "content") return
        val type = intent.type
        // Taken once: the same intent isn't read again (e.g. when the page reloads).
        intent.action = Intent.ACTION_MAIN
        intent.data = null
        // The other app may fetch the file as it's opened (Gmail does): off the main thread.
        Thread {
            val name = runCatching { displayName(uri) }.getOrNull()
            pending = try {
                val mime = (type ?: context.contentResolver.getType(uri))?.lowercase()
                if (mime !in CALENDAR_TYPES && name?.lowercase()?.endsWith(".ics") != true) {
                    JSObject().put("error", "This file isn't a calendar invitation.")
                } else {
                    val text = readText(uri)
                    if (text == null) JSObject().put("error", "This file is too large to be a calendar invitation.")
                    else JSObject().put("text", text).put("name", name)
                }
            } catch (e: Exception) {
                JSObject().put("error", "The invitation couldn't be read.")
            }
            // Kept until the page listens, so a file that opened the app is shown once it has started.
            notifyListeners("invite", JSObject(), true)
        }.start()
    }

    /** The file's text (UTF-8), or null past [MAX_BYTES]. */
    private fun readText(uri: Uri): String? {
        val input = context.contentResolver.openInputStream(uri) ?: throw IllegalStateException("no stream")
        input.use { s ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(16 * 1024)
            while (true) {
                val n = s.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
                if (out.size() > MAX_BYTES) return null
            }
            return out.toString(Charsets.UTF_8.name())
        }
    }

    private fun displayName(uri: Uri): String? =
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    private companion object {
        val CALENDAR_TYPES = setOf("text/calendar", "application/ics", "text/x-vcalendar")
        /** An invitation is a few kilobytes; a whole exported calendar isn't something to open here. */
        const val MAX_BYTES = 1024 * 1024
    }
}
