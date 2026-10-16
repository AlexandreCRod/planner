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
                // A restart clears notifications, so upcoming-alarm notices are shown again.
                if (intent.action == Intent.ACTION_BOOT_COMPLETED) AlarmOverrides.forgetNotices(ctx)
                AlarmScheduler.rescheduleAll(ctx)
                ClockAlarms.rescheduleAll(ctx)
                ClockTools.rescheduleAll(ctx)
            } finally {
                pending.finish()
            }
        }
    }
}
