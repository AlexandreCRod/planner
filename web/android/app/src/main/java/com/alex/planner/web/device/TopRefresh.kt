package com.alex.planner.web.device

import android.app.Activity
import android.os.Build
import android.util.Log
import android.view.Display

/**
 * The screen's top refresh rate for the app (363b). Some phones (HyperOS on the user's POCO among them) run
 * apps at 60 Hz unless they ask for more, which makes scrolling and dragging less smooth than the screen
 * can be. The activity asks for the display's fastest mode at its current resolution; the system may still
 * lower it (battery saver, the user's own refresh setting), which is its call. The chosen mode is logged
 * once per start ("Planner" tag).
 */
object TopRefresh {
    /** A display mode, as much of it as the choice needs. */
    data class Mode(val id: Int, val width: Int, val height: Int, val fps: Float)

    /**
     * The fastest of [modes] at [current]'s resolution (null only when there's none at it). It's asked for
     * even when the screen already runs at it: the mode at start is whatever the launcher or the opening
     * animation left (often the top rate), and HyperOS lowers the app to 60 Hz a moment later unless the
     * app has asked (review of 2.10.3, finding 2).
     */
    fun fastest(current: Mode, modes: List<Mode>): Mode? =
        modes.filter { it.width == current.width && it.height == current.height }.maxByOrNull { it.fps }

    private var logged = false

    fun apply(activity: Activity) {
        try {
            @Suppress("DEPRECATION")
            val display: Display = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) activity.display else activity.windowManager.defaultDisplay) ?: return
            val m = display.mode
            val current = Mode(m.modeId, m.physicalWidth, m.physicalHeight, m.refreshRate)
            val all = display.supportedModes.map { Mode(it.modeId, it.physicalWidth, it.physicalHeight, it.refreshRate) }
            val pick = fastest(current, all)
            if (pick != null) {
                val attrs = activity.window.attributes
                attrs.preferredDisplayModeId = pick.id
                attrs.preferredRefreshRate = pick.fps
                activity.window.attributes = attrs
            }
            if (!logged) {
                logged = true
                Log.i("Planner", (if (pick == null) "Display mode not asked (none at ${current.width}x${current.height}" else
                    "Display mode ${pick.id} asked: ${pick.width}x${pick.height} at ${"%.0f".format(pick.fps)} Hz (now ${"%.0f".format(current.fps)} Hz") +
                    ", modes: ${all.joinToString { "${it.width}x${it.height}@${"%.0f".format(it.fps)}" }})")
            }
        } catch (e: Throwable) {
            Log.w("Planner", "Display mode not set", e)
        }
    }
}
