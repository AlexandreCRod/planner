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
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.delay
import java.time.LocalTime

/**
 * Full-screen alarm UI shown over the lock screen. The ringing itself lives in [AlarmService].
 * (Copied from the native app's AlarmActivity, with its dark theme.)
 */
class AlarmActivity : ComponentActivity() {
    companion object {
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val ACTION_CLOSE = "com.alex.planner.web.ALARM_CLOSE"
        /** Clock alarm colour (index into the Alarms page palette), or -1. */
        const val EXTRA_COLOR = "color"
    }

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
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        val text = intent.getStringExtra(EXTRA_TEXT).orEmpty()
        val isClock = intent.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0) != 0L
        val isTimer = intent.getLongExtra(ClockTools.EXTRA_TIMER, 0) != 0L
        // Only what's ticked off (a task, or an event that's a routine) offers "Mark done", as its notifications do (247).
        val completable = !isClock && !isTimer && Mirror.item(this, intent.getLongExtra(AlarmReceiver.EXTRA_ITEM, 0))?.completable == true
        val accent = Mirror.settings(this).accent
        // A clock alarm shows the weather at this hour, from the forecast the page last pushed (Forecast.kt).
        val now = System.currentTimeMillis()
        val weather = if (isClock) Forecast.at(this, now)?.let { (t, code) -> Forecast.icon(code, now) to "${Math.round(t)}°C" } else null
        setContent {
            MaterialTheme(colorScheme = darkScheme(accents[accent.coerceIn(accents.indices)])) {
                AlarmScreen(
                    title = title,
                    text = text,
                    weather = weather,
                    onDismiss = { send(AlarmService.ACTION_DISMISS) },
                    onSnooze = { send(AlarmService.ACTION_SNOOZE) },
                    snoozeLabel = if (isTimer) "+1 min" else "Snooze",
                    // Clock alarms, timers and plain events have nothing to tick off.
                    onComplete = if (!completable) null else { { send(AlarmService.ACTION_COMPLETE) } },
                )
            }
        }
    }

    /**
     * A volume button stops it, either one. Caught before the views see the key (a focused button could
     * keep it from onKeyDown), and on the release too, in case the press itself went elsewhere.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_VOLUME_MUTE -> {
                if (!isFinishing && event.repeatCount == 0) send(AlarmService.ACTION_DISMISS)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun send(action: String) {
        startService(Intent(this, AlarmService::class.java).setAction(action))
        finish()
    }

    override fun onDestroy() {
        unregisterReceiver(closeReceiver)
        super.onDestroy()
    }
}

/** The native app's accents (ui/theme/Theme.kt): name, dark primary, dark container. */
private data class Accent(val dark: Color, val darkContainer: Color)

private val accents = listOf(
    Accent(Color(0xFFA8C7FA), Color(0xFF0842A0)), // Blue
    Accent(Color(0xFF80D5C8), Color(0xFF005048)), // Teal
    Accent(Color(0xFFFFB1C5), Color(0xFF8E0F43)), // Rose
    Accent(Color(0xFFFFB870), Color(0xFF693C00)), // Amber
    Accent(Color(0xFF9ED699), Color(0xFF155219)), // Forest
    Accent(Color(0xFFD3BBFF), Color(0xFF51229E)), // Violet
    Accent(Color(0xFF9ECAFF), Color(0xFF00497D)), // Ocean
    Accent(Color(0xFFB7C8D6), Color(0xFF38444F)), // Slate
    Accent(Color(0xFFB8C3FF), Color(0xFF2B3A9A)), // Indigo
)

/** The native app's dark scheme for an accent. */
private fun darkScheme(accent: Accent) = darkColorScheme(
    primary = accent.dark,
    onPrimary = Color(0xFF0E1120),
    primaryContainer = accent.darkContainer,
    onPrimaryContainer = Color(0xFFEDEFFF),
    secondary = accent.dark.copy(alpha = 0.85f),
    secondaryContainer = accent.darkContainer.copy(alpha = 0.6f),
    onSecondaryContainer = Color(0xFFE6E6F0),
    background = Color(0xFF141318),
    surface = Color(0xFF141318),
    surfaceContainerHigh = Color(0xFF2B2A2F),
)

/** Material's filled Alarm icon (the native screen's Icons.Filled.Alarm). */
private val AlarmIcon: ImageVector by lazy {
    ImageVector.Builder("Alarm", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(
            PathParser().parsePathString(
                "M22 5.72l-4.6 -3.86l-1.29 1.53l4.6 3.86L22 5.72ZM7.88 3.39L6.6 1.86L2 5.71l1.29 1.53l4.59 -3.85ZM12.5 8L11 8v6l4.75 2.85l0.75 -1.23l-4 -2.37L12.5 8ZM12 4c-4.97 0 -9 4.03 -9 9s4.02 9 9 9c4.97 0 9 -4.03 9 -9s-4.03 -9 -9 -9ZM12 20c-3.87 0 -7 -3.13 -7 -7s3.13 -7 7 -7s7 3.13 7 7s-3.13 7 -7 7Z"
            ).toNodes(),
            fill = SolidColor(Color.Black),
        )
    }.build()
}

@Composable
private fun AlarmScreen(
    title: String,
    text: String,
    weather: Pair<ImageVector, String>?,
    onDismiss: () -> Unit,
    onSnooze: () -> Unit,
    snoozeLabel: String,
    onComplete: (() -> Unit)?,
) {
    var now by remember { mutableStateOf(LocalTime.now()) }
    LaunchedEffect(Unit) {
        while (true) { now = LocalTime.now(); delay(1000) }
    }
    // A slow pulse around the icon, like Google's Clock.
    val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(
        initialValue = 1f, targetValue = 1.12f,
        animationSpec = infiniteRepeatable(tween(1000), RepeatMode.Reverse), label = "pulse",
    )
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.fillMaxSize().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
            if (text.isNotBlank()) Text(text, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(12.dp))
            Text(formatTime(now.hour * 60 + now.minute), fontSize = 80.sp, fontWeight = FontWeight.Normal)
            if (weather != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(weather.first, null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(weather.second, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.height(40.dp))
            Box(
                Modifier.size(112.dp).scale(pulse).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) { Icon(AlarmIcon, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer) }
            Spacer(Modifier.height(48.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilledTonalButton(onClick = onSnooze, modifier = Modifier.weight(1f).height(56.dp)) { Text(snoozeLabel, fontSize = 16.sp) }
                Button(onClick = onDismiss, modifier = Modifier.weight(1f).height(56.dp)) { Text("Stop", fontSize = 16.sp) }
            }
            if (onComplete != null) {
                Spacer(Modifier.height(12.dp))
                OutlinedButton(onClick = onComplete, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Mark done") }
            }
        }
    }
}
