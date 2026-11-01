package com.alex.planner.web.alarm

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import java.time.LocalDate

/**
 * The ringing screen's look, full screen, from Settings > Looks to try (311): the layouts of the real screen
 * with sample text. Nothing else of an alarm is here, on purpose: its own Activity, so it has no way to the
 * service. No sound, no vibration, nothing armed or changed; every control only closes it, as Back does.
 * It sits in the app's task, so anything that covers it closes it, and a real alarm then has the screen
 * (AlarmService opens the ringing screen over it).
 */
class RingPreviewActivity : ComponentActivity() {
    companion object {
        private const val EXTRA_LAYOUT = "ringLayout"
        private const val EXTRA_STOP = "ringStop"
        private const val EXTRA_COMING = "ringComing"
        private const val EXTRA_ICONS = "ringIcons"

        /** Whether it's on screen: a real alarm opens the ringing screen over it (AlarmService). */
        @Volatile var showing = false
            private set

        /** Shows the look the page has chosen: its own four numbers, so it needn't be saved yet. */
        fun intent(context: Context, layout: Int, stop: Int, coming: Boolean, icons: Int): Intent =
            Intent(context, RingPreviewActivity::class.java)
                .putExtra(EXTRA_LAYOUT, layout).putExtra(EXTRA_STOP, stop).putExtra(EXTRA_COMING, coming).putExtra(EXTRA_ICONS, icons)

        /** The bundle the sample rings in: "Alarm 2 of 4 · next 07:20". */
        private val BUNDLE = RingBundle(listOf(420, 430, 440, 450), 1, 440, listOf(StillToRing(440), StillToRing(450)), "preview")

        /** What the sample says, in the look [look]. */
        fun content(look: RingLook, snoozeMinutes: Int): RingContent = RingContent(
            look = look, title = "Wake up", sub = formatDate(LocalDate.now()), weather = null,
            snooze = if (look.layout == RingLayout.PLAIN) "Snooze" else "Snooze · $snoozeMinutes min",
            bundle = BUNDLE,
            today = if (look.coming) TodayCard(listOf(TodayRow(formatTime(600), "Dentist", false), TodayRow(formatTime(750), "Lunch with Ana", true)), "2 routines, 3 tasks") else null,
            next = if (look.coming && look.layout == RingLayout.B) "Next: Lunch with Ana rings at ${formatTime(750)}" else null,
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val look = RingLook.of(
            AlarmSettings(
                ringLayout = intent.getIntExtra(EXTRA_LAYOUT, 0), ringStop = intent.getIntExtra(EXTRA_STOP, 0),
                ringComing = intent.getBooleanExtra(EXTRA_COMING, false), ringIcons = intent.getIntExtra(EXTRA_ICONS, 1),
            ),
        )
        val snoozeMinutes = runCatching { Mirror.settings(this).snoozeMinutes }.getOrDefault(10)
        val close = { finish() }
        setContent {
            MaterialTheme(colorScheme = ringColours) {
                RingScreen(content(look, snoozeMinutes), RingActions(stop = close, snooze = close, done = null, stopRest = close))
            }
        }
    }

    override fun onStart() { super.onStart(); showing = true }

    override fun onStop() {
        showing = false
        super.onStop()
        finish()
    }
}
