package com.alex.planner.web.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Alarms are cleared on reboot and drift on clock changes, so re-register them, from the engine's own
 * copy of the data: the app's page doesn't need to run. (Copied from the native app's BootReceiver.)
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val ctx = context.applicationContext
                Notifications.createChannels(ctx)
                // A restart clears notifications, so upcoming-alarm notices are shown again. The locked boot
                // comes first (the engine's data is readable then: AlarmStore), the unlocked one after it.
                val boot = intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_LOCKED_BOOT_COMPLETED
                if (boot) AlarmOverrides.forgetNotices(ctx)
                // What should have rung while the phone was off: a missed notice each (once per restart).
                if (boot) Missed.afterBoot(ctx)
                AlarmScheduler.rescheduleAll(ctx)
                ClockAlarms.rescheduleAll(ctx)
                ClockTools.rescheduleAll(ctx)
                // The home-screen widgets go by the date, so a clock change redraws them (once unlocked).
                com.alex.planner.web.widget.Widgets.update(ctx)
            } finally {
                pending.finish()
            }
        }
    }
}
