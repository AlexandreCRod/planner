package com.alex.planner.web.update

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * App updates from the project's GitHub releases (web/src/ui/phone/update.ts decides when to offer one):
 * the installed version, the release's .apk downloaded into the app's cache, and Android's own installer
 * opened on it. Android asks the person to confirm every install; nothing installs silently.
 */
@CapacitorPlugin(name = "Updates")
class UpdatePlugin : Plugin() {
    @Volatile private var downloading = false

    /** {versionName, versionCode, debug}: debug builds may pretend to be older, to test the update popup. */
    @PluginMethod
    fun appVersion(call: PluginCall) {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        val debug = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        call.resolve(JSObject().put("versionName", info.versionName ?: "").put("versionCode", code).put("debug", debug))
    }

    /** Whether this app may open the installer ("Install unknown apps" allowed for it). */
    @PluginMethod
    fun canInstall(call: PluginCall) {
        call.resolve(JSObject().put("allowed", allowed()))
    }

    private fun allowed() = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()

    /** Opens Android's "Install unknown apps" page for this app ("Allow from this source"). */
    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        val activity = activity ?: return call.reject("no activity")
        try {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
            call.resolve()
        } catch (_: ActivityNotFoundException) {
            call.reject("can't open")
        }
    }

    /**
     * Downloads [url] (an https .apk) into the cache as updates/planner.apk, sending "progress" events
     * ({received, total}; total is -1 when unknown). Resolves {size} when the file is complete.
     */
    @PluginMethod
    fun download(call: PluginCall) {
        val url = call.getString("url").orEmpty()
        if (!url.startsWith("https://")) return call.reject("not an https address")
        if (downloading) return call.reject("already downloading")
        downloading = true
        Thread {
            val dir = File(context.cacheDir, "updates").apply { mkdirs() }
            val part = File(dir, "planner.apk.part")
            val done = File(dir, "planner.apk")
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                // GitHub sends the file from another https host; HttpURLConnection follows that itself.
                conn.instanceFollowRedirects = true
                conn.connectTimeout = 15_000
                conn.readTimeout = 30_000
                val status = conn.responseCode
                if (status !in 200..299) throw IllegalStateException("HTTP $status")
                val total = conn.contentLengthLong
                var received = 0L
                var lastSent = 0L
                conn.inputStream.use { input ->
                    part.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            received += n
                            if (received - lastSent >= 256 * 1024) {
                                lastSent = received
                                notifyListeners("progress", JSObject().put("received", received).put("total", total))
                            }
                        }
                    }
                }
                conn.disconnect()
                if (total > 0 && received != total) throw IllegalStateException("incomplete")
                done.delete()
                if (!part.renameTo(done)) throw IllegalStateException("can't save")
                notifyListeners("progress", JSObject().put("received", received).put("total", total))
                call.resolve(JSObject().put("size", received))
            } catch (e: Exception) {
                part.delete()
                call.reject(e.message ?: "download failed")
            } finally {
                downloading = false
            }
        }.start()
    }

    /** Opens Android's installer on the downloaded file (the person confirms there). */
    @PluginMethod
    fun install(call: PluginCall) {
        val activity = activity ?: return call.reject("no activity")
        val file = File(File(context.cacheDir, "updates"), "planner.apk")
        if (!file.exists()) return call.reject("nothing downloaded")
        if (!allowed()) return call.reject("not allowed")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(intent)
            call.resolve()
        } catch (_: ActivityNotFoundException) {
            call.reject("no installer")
        }
    }
}
