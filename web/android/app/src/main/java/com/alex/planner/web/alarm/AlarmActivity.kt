package com.alex.planner.web.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.core.content.ContextCompat
import java.time.LocalDate

/**
 * Full-screen alarm UI shown over the lock screen. The ringing itself lives in [AlarmService]. One Activity
 * whichever look was chosen (246): the layouts are views inside it (RingLayouts.kt), and all of them stop and
 * snooze through [send]. A look that's missing or odd shows the plain layout ([RingLook.of]), and a failure
 * reading what else the screen says only makes it say less: the alarm can always be stopped from here, and
 * with a volume button or the notification's Stop whatever happens here.
 */
class AlarmActivity : ComponentActivity() {
    companion object {
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val ACTION_CLOSE = "com.alex.planner.web.ALARM_CLOSE"
        /** Clock alarm colour (index into the Alarms page palette), or -1. */
        const val EXTRA_COLOR = "color"

        /** Whether the ringing screen is on screen (a second alarm then updates it: AlarmService). */
        @Volatile var showing = false
            private set
    }

    /** What the screen shows: read from the intent it was opened with, and again from a new one ([onNewIntent]). */
    private data class ScreenState(
        val title: String, val text: String, val itemId: Long, val isClock: Boolean, val isTimer: Boolean,
        val completable: Boolean, val weather: Pair<ImageVector, String>?,
        val look: RingLook, val whenText: String, val snoozeMinutes: Int, val bundle: RingBundle?, val today: TodayCard?, val next: String?,
    )

    private var shown by mutableStateOf<ScreenState?>(null)

    /** For the tests (AlarmActivityTest): whether Mark done shows, and for which item. */
    internal val offersMarkDone get() = shown?.completable == true
    internal val shownItem get() = shown?.itemId ?: 0L
    internal val look get() = shown?.look
    internal val bundleLine get() = shown?.bundle?.line
    internal val todayCard get() = shown?.today

    private fun read(intent: Intent): ScreenState {
        val isClock = intent.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0) != 0L
        val isTimer = intent.getLongExtra(ClockTools.EXTRA_TIMER, 0) != 0L
        val itemId = intent.getLongExtra(AlarmReceiver.EXTRA_ITEM, 0)
        // Only what's ticked off (a task, or an event that's a routine) offers "Mark done", as its notifications do (247).
        val completable = !isClock && !isTimer && Mirror.item(this, itemId)?.completable == true
        // A clock alarm shows the weather at this hour, from the forecast the page last pushed (Forecast.kt).
        val now = System.currentTimeMillis()
        val weather = if (isClock) runCatching { Forecast.at(this, now)?.let { (t, code) -> Forecast.icon(code, now) to "${Math.round(t)}°C" } }.getOrNull() else null
        val look = runCatching { RingLook.of(Mirror.settings(this)) }.getOrDefault(RingLook.PLAIN)
        val text = intent.getStringExtra(EXTRA_TEXT).orEmpty()
        val clockId = intent.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0)
        val reminderId = intent.getLongExtra(AlarmReceiver.EXTRA_REMINDER, 0)
        val day = intent.getLongExtra(AlarmReceiver.EXTRA_DAY, 0)
        val bundle = RingInfo.bundle(this, clockId, reminderId, itemId, day)
        val whenText = when {
            isClock -> listOf(text, formatDate(LocalDate.now())).filter { it.isNotBlank() }.joinToString(" · ")
            else -> runCatching { RingInfo.whenLine(Mirror.item(this, itemId), day, now) }.getOrNull() ?: text
        }
        val today = if (look.coming) RingInfo.today(this, clockId, reminderId, bundle) else null
        val next = if (look.coming && look.layout == RingLayout.B && !isTimer) RingInfo.nextLine(this, clockId, reminderId, bundle) else null
        val snoozeMinutes = runCatching { Mirror.settings(this).snoozeMinutes }.getOrDefault(10)
        return ScreenState(intent.getStringExtra(EXTRA_TITLE).orEmpty(), text, itemId, isClock, isTimer, completable, weather, look, whenText, snoozeMinutes, bundle, today, next)
    }

    /** Another alarm took over while this one rang (194): the screen shows it, so "Mark done" ticks the right item. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        shown = read(intent)
    }

    override fun onStart() { super.onStart(); showing = true }
    override fun onStop() { showing = false; super.onStop() }

    private val closeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        // On screen the whole time it rings: the screen stays on, and Back doesn't hide it (Stop or Snooze do).
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {}
        })
        ContextCompat.registerReceiver(this, closeReceiver, IntentFilter(ACTION_CLOSE), ContextCompat.RECEIVER_NOT_EXPORTED)
        shown = read(intent)
        setContent {
            MaterialTheme(colorScheme = ringColours) {
                val s = shown ?: return@MaterialTheme
                RingScreen(
                    RingContent(
                        look = s.look, title = s.title,
                        // The plain layout says what it always said.
                        sub = if (s.look.layout == RingLayout.PLAIN) s.text else s.whenText,
                        weather = s.weather,
                        snooze = when {
                            s.isTimer -> "+1 min"
                            s.look.layout == RingLayout.PLAIN -> "Snooze"
                            else -> "Snooze · ${s.snoozeMinutes} min"
                        },
                        bundle = s.bundle, today = s.today, next = s.next,
                    ),
                    RingActions(
                        stop = { send(AlarmService.ACTION_DISMISS) },
                        snooze = { send(AlarmService.ACTION_SNOOZE) },
                        // Clock alarms, timers and plain events have nothing to tick off.
                        done = if (!s.completable) null else { { send(AlarmService.ACTION_COMPLETE) } },
                        stopRest = { send(AlarmService.ACTION_DISMISS_REST) },
                    ),
                )
            }
        }
    }

    /**
     * A volume button stops it, either one. Caught before the views see the key (a focused button could
     * keep it from onKeyDown), and on the release too, in case the press itself went elsewhere.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!VolumeKeys.isVolumeKey(event.keyCode)) return super.dispatchKeyEvent(event)
        if (VolumeKeys.keyStops(event.keyCode, event.repeatCount, isFinishing)) send(AlarmService.ACTION_DISMISS)
        return true
    }

    private fun send(action: String) {
        // Says which item it showed, so a complete meant for one alarm never ticks the one that took over.
        startService(Intent(this, AlarmService::class.java).setAction(action).putExtra(AlarmReceiver.EXTRA_ITEM, shown?.itemId ?: 0L))
        finish()
    }

    override fun onDestroy() {
        unregisterReceiver(closeReceiver)
        super.onDestroy()
    }
}
