package com.alex.planner.web.shortcut

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.alex.planner.web.MainActivity
import com.alex.planner.web.R
import com.alex.planner.web.alarm.Notifications

/**
 * The app icon's long-press shortcuts (375): New task, New note, Stopwatch (started) and Timer. They're set from
 * the app (not a shortcuts.xml), so Planner Test, with its own app ID, gets them too. TypeScript decides what each
 * opens (web/src/alarms/launch.ts); Android only hands the page the shortcut's name.
 */
object Shortcuts {
    const val ACTION = "com.alex.planner.web.SHORTCUT"
    const val EXTRA = "shortcut"

    private data class One(val id: String, val label: String, val icon: Int)
    private val all = listOf(
        One("task", "New task", R.drawable.ic_shortcut_task),
        One("note", "New note", R.drawable.ic_shortcut_note),
        One("stopwatch", "Stopwatch", R.drawable.ic_shortcut_stopwatch),
        One("timer", "Timer", R.drawable.ic_shortcut_timer),
    )

    fun publish(context: Context) {
        runCatching {
            val list = all.mapIndexed { i, s ->
                ShortcutInfoCompat.Builder(context, s.id)
                    .setShortLabel(s.label)
                    .setIcon(IconCompat.createWithResource(context, s.icon))
                    .setIntent(Intent(context, ShortcutActivity::class.java).setAction(ACTION).putExtra(EXTRA, s.id))
                    .setRank(i)
                    .build()
            }
            ShortcutManagerCompat.setDynamicShortcuts(context, list)
        }
    }
}

/**
 * The launcher starts a shortcut on a cleared task, which would start the app afresh. This invisible step passes it
 * on to the running app instead (as a notification does), then goes.
 */
class ShortcutActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val which = intent?.getStringExtra(Shortcuts.EXTRA)
        if (which != null) {
            startActivity(Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(Notifications.EXTRA_OPEN_SHORTCUT, which)
            })
        }
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }
}
