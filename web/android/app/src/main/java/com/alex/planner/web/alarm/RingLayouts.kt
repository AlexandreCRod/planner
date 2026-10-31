package com.alex.planner.web.alarm

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalTime
import kotlin.math.roundToInt

// The ringing screen's layouts (246): views inside the one AlarmActivity, all sharing its stop and snooze
// code through [RingActions]. A, B and the plain one it falls back on. Always dark, in the app's colours.

private val Background = Color(0xFF131314)
private val Raised = Color(0xFF1B1B1D)
private val Hairline = Color(0xFF38393C)
private val TextColour = Color(0xFFE5E5E7)
private val Muted = Color(0xFFA9AAAE)
private val Faint = Color(0xFF6A6C70)
private val Primary = Color(0xFFA4B9DF)
private val OnPrimary = Color(0xFF0E1120)
private val Container = Color(0xFF263452)
private val OnContainer = Color(0xFFDFE6F5)

val ringColours = darkColorScheme(
    primary = Primary, onPrimary = OnPrimary, primaryContainer = Container, onPrimaryContainer = OnContainer,
    secondaryContainer = Container, onSecondaryContainer = OnContainer,
    background = Background, surface = Background, onBackground = TextColour, onSurface = TextColour,
    surfaceVariant = Raised, onSurfaceVariant = Muted, outline = Hairline,
)

/** What each layout draws. */
data class RingContent(
    val look: RingLook,
    val title: String,
    /** Under the title: the date on a clock alarm, "10:00 – 10:45 · starts in 30 min" on an event. */
    val sub: String,
    val weather: Pair<ImageVector, String>?,
    val snooze: String,
    val bundle: RingBundle?,
    val today: TodayCard?,
    val next: String?,
)

/** What the buttons do: the Activity's own stop and snooze code, whichever layout shows. */
data class RingActions(val stop: () -> Unit, val snooze: () -> Unit, val done: (() -> Unit)?, val stopRest: () -> Unit)

private fun vector(name: String, path: String): ImageVector = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
    addPath(PathParser().parsePathString(path).toNodes(), fill = SolidColor(Color.Black))
}.build()

private const val ALARM = "M22 5.72l-4.6 -3.86l-1.29 1.53l4.6 3.86L22 5.72ZM7.88 3.39L6.6 1.86L2 5.71l1.29 1.53l4.59 -3.85ZM12.5 8L11 8v6l4.75 2.85l0.75 -1.23l-4 -2.37L12.5 8ZM12 4c-4.97 0 -9 4.03 -9 9s4.02 9 9 9c4.97 0 9 -4.03 9 -9s-4.03 -9 -9 -9ZM12 20c-3.87 0 -7 -3.13 -7 -7s3.13 -7 7 -7s7 3.13 7 7s-3.13 7 -7 7Z"

private val AlarmIcon by lazy { vector("Alarm", ALARM) }

/** The stop and snooze icons of each set (254). */
private val STOP_ICONS by lazy {
    listOf(
        vector("AlarmOff", "M12 6c3.87 0 7 3.13 7 7c0 0.84 -0.16 1.65 -0.43 2.4l1.52 1.52c0.58 -1.19 0.91 -2.51 0.91 -3.92c0 -4.97 -4.03 -9 -9 -9c-1.41 0 -2.73 0.33 -3.92 0.91L9.6 6.43C10.35 6.16 11.16 6 12 6ZM22 5.72l-4.6 -3.86l-1.29 1.53l4.6 3.86L22 5.72ZM2.92 2.29L1.65 3.57L2.98 4.9l-1.11 0.93l1.42 1.42l1.11 -0.94l0.8 0.8C3.83 8.69 3 10.75 3 13c0 4.97 4.02 9 9 9c2.25 0 4.31 -0.83 5.89 -2.2l2.2 2.2l1.27 -1.27L3.89 3.27L2.92 2.29ZM16.47 18.39C15.26 19.39 13.7 20 12 20c-3.87 0 -7 -3.13 -7 -7c0 -1.7 0.61 -3.26 1.61 -4.47L16.47 18.39ZM8.02 3.28L6.6 1.86l-0.86 0.71l1.42 1.42L8.02 3.28Z"),
        vector("Close", "M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12Z"),
        vector("BellOff", "M20 18.69L7.84 6.14L5.27 3.49L4 4.76l2.8 2.8v0.01C6.28 8.56 6 9.73 6 10.99v5l-2 2v1h13.73l2 2L21 19.72L20 18.69ZM12 22c1.11 0 2 -0.89 2 -2h-4C10 21.11 10.89 22 12 22ZM18 14.68V10.99c0 -3.08 -1.64 -5.64 -4.5 -6.32V4c0 -0.83 -0.67 -1.5 -1.5 -1.5S10.5 3.17 10.5 4v0.68c-0.15 0.03 -0.29 0.08 -0.42 0.12c-0.1 0.03 -0.2 0.07 -0.3 0.11h-0.01c-0.2 0.08 -0.4 0.17 -0.59 0.27c-0.01 0 -0.01 0 -0.02 0.01L18 14.68Z"),
    )
}
private val SNOOZE_ICONS by lazy {
    listOf(
        vector("Snooze", "M9 11h3.63L9 15.2V17h6v-2h-3.63L15 10.8V9H9V11ZM16.06 3.35l1.28 -1.54l4.61 3.85l-1.28 1.54L16.06 3.35ZM3.34 7.19L2.06 5.65L6.66 1.81l1.28 1.54L3.34 7.19ZM12 6c3.86 0 7 3.14 7 7s-3.14 7 -7 7s-7 -3.14 -7 -7S8.14 6 12 6M12 4c-4.97 0 -9 4.03 -9 9s4.03 9 9 9s9 -4.03 9 -9S16.97 4 12 4Z"),
        vector("Moon", "M12.34 2.02C6.59 1.82 2 6.42 2 12c0 5.52 4.48 10 10 10c3.71 0 6.93 -2.02 8.66 -5.02C13.15 16.73 8.57 8.55 12.34 2.02Z"),
        vector("Hourglass", "M6 2v6h0.01L6 8.01L10 12l-4 4l0.01 0.01L6 16.01V22h12v-5.99h-0.01L18 16l-4 -4l4 -3.99l-0.01 -0.01H18V2H6Z"),
    )
}

private fun stopIcon(set: Int) = STOP_ICONS.getOrElse(set - 1) { STOP_ICONS[0] }
private fun snoozeIcon(set: Int) = SNOOZE_ICONS.getOrElse(set - 1) { SNOOZE_ICONS[0] }

/** The time now, a second at a time. */
@Composable
private fun rememberClock(): String {
    var now by remember { mutableStateOf(LocalTime.now()) }
    LaunchedEffect(Unit) { while (true) { now = LocalTime.now(); delay(1000) } }
    return formatTime(now.hour * 60 + now.minute)
}

/** The layout the look asks for. */
@Composable
fun RingScreen(c: RingContent, a: RingActions) {
    when (c.look.layout) {
        RingLayout.A -> LayoutA(c, a)
        RingLayout.B -> LayoutB(c, a)
        RingLayout.PLAIN -> PlainLayout(c, a)
    }
}

/** A top part that scrolls if it must (a big font, a small screen) over controls that are always on screen. */
@Composable
private fun Frame(top: @Composable ColumnScope.() -> Unit, topCentred: Boolean, bottom: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().systemBarsPadding().padding(horizontal = 24.dp, vertical = 16.dp)) {
            // At least as tall as the room there is, so a short top part can sit in the middle of it.
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                Column(
                    Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = maxHeight),
                    horizontalAlignment = if (topCentred) Alignment.CenterHorizontally else Alignment.Start,
                    verticalArrangement = if (topCentred) Arrangement.Center else Arrangement.Top,
                    content = top,
                )
            }
            Spacer(Modifier.height(16.dp))
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, content = bottom)
        }
    }
}

// ---------- The plain layout: what anything missing or odd falls back on ----------

@Composable
private fun PlainLayout(c: RingContent, a: RingActions) {
    val time = rememberClock()
    // A slow pulse around the icon, like Google's Clock.
    val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(
        initialValue = 1f, targetValue = 1.12f,
        animationSpec = infiniteRepeatable(tween(1000), RepeatMode.Reverse), label = "pulse",
    )
    Frame(topCentred = true, top = {
        Text(c.title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        if (c.sub.isNotBlank()) Text(c.sub, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center, color = Muted)
        Spacer(Modifier.height(12.dp))
        Text(time, fontSize = 80.sp, fontWeight = FontWeight.Normal, maxLines = 1)
        c.weather?.let { Weather(it) }
        Spacer(Modifier.height(40.dp))
        Box(Modifier.size(112.dp).scale(pulse).clip(CircleShape).background(Container), contentAlignment = Alignment.Center) {
            Icon(AlarmIcon, null, Modifier.size(48.dp), tint = OnContainer)
        }
    }, bottom = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            FilledTonalButton(onClick = a.snooze, modifier = Modifier.weight(1f).height(56.dp)) { Text(c.snooze, fontSize = 16.sp) }
            Button(onClick = a.stop, modifier = Modifier.weight(1f).height(56.dp).testTag("stop")) { Text("Stop", fontSize = 16.sp) }
        }
        a.done?.let {
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = it, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Mark done") }
        }
    })
}

@Composable
private fun Weather(w: Pair<ImageVector, String>) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(w.first, null, Modifier.size(18.dp), tint = Muted)
        Text(w.second, fontSize = 14.sp, color = Muted)
    }
}

// ---------- A: the calm clock ----------

@Composable
private fun LayoutA(c: RingContent, a: RingActions) {
    val time = rememberClock()
    Frame(topCentred = true, top = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(AlarmIcon, null, Modifier.size(20.dp), tint = Primary)
            Text(c.title, fontSize = 20.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        }
        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (c.sub.isNotBlank()) Text(c.sub, fontSize = 14.sp, color = Muted, textAlign = TextAlign.Center)
            c.weather?.let { Weather(it) }
        }
        Text(time, fontSize = if (time.length > 5) 72.sp else 104.sp, fontWeight = FontWeight.Light, letterSpacing = (-2).sp, maxLines = 1, modifier = Modifier.padding(vertical = 12.dp))
        c.bundle?.let { b ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Dots(b)
                Text(b.line, fontSize = 14.sp, color = Muted)
            }
        }
        c.today?.let { Spacer(Modifier.height(24.dp)); Today(it) }
    }, bottom = {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill(snoozeIcon(c.look.icons), c.snooze, a.snooze)
            a.done?.let { Pill(null, "Done", it) }
        }
        Spacer(Modifier.height(20.dp))
        Box(Modifier.widthIn(max = 360.dp).fillMaxWidth()) { Stopper(c.look, a.stop) }
    })
}

@Composable
private fun Dots(b: RingBundle) {
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        b.times.indices.forEach { i ->
            val mod = Modifier.size(8.dp).clip(CircleShape)
            Box(when {
                i == b.index -> mod.background(Primary)
                i < b.index -> mod.background(Color(0xFF4A4C50))
                else -> mod.border(1.dp, Faint, CircleShape)
            })
        }
    }
}

@Composable
private fun Pill(icon: ImageVector?, label: String, onClick: () -> Unit) {
    Button(
        onClick = onClick, modifier = Modifier.height(48.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Container, contentColor = OnContainer),
    ) {
        icon?.let { Icon(it, null, Modifier.size(20.dp), tint = Primary); Spacer(Modifier.width(8.dp)) }
        Text(label, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

/** C's card: the first event, what rings later, what's left to do. */
@Composable
private fun Today(t: TodayCard) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Raised).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Today", fontSize = 13.sp, color = Muted)
        t.rows.forEach { r ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(r.time, fontSize = 15.sp, fontWeight = FontWeight.Medium, modifier = Modifier.width(64.dp), maxLines = 1)
                Text(r.title, fontSize = 15.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (r.rings) Text("rings", fontSize = 13.sp, color = Muted, modifier = Modifier.padding(start = 8.dp))
            }
        }
        t.summary?.let { Text(it, fontSize = 14.sp, color = Muted) }
    }
}

// ---------- B: two big buttons ----------

@Composable
private fun LayoutB(c: RingContent, a: RingActions) {
    val time = rememberClock()
    val stopSmall = if (c.bundle != null) "this one" else ""
    Frame(topCentred = false, top = {
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(AlarmIcon, null, Modifier.size(18.dp), tint = Primary)
            Text(c.title, fontSize = 16.sp, color = Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text(time, fontSize = 72.sp, letterSpacing = (-1).sp, maxLines = 1)
        Spacer(Modifier.height(12.dp))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Raised).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val b = c.bundle
            if (b != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Alarm ${b.index + 1} of ${b.times.size}", fontSize = 14.sp, color = Muted, modifier = Modifier.weight(1f))
                    c.weather?.let { Weather(it) }
                }
                // The times, as many as fit in a row: those around this one.
                val from = (b.index - 1).coerceAtLeast(0).coerceAtMost((b.times.size - CHIPS).coerceAtLeast(0))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    b.times.drop(from).take(CHIPS).forEachIndexed { i, m -> Chip(formatTime(m), from + i, b.index) }
                }
                b.next?.let { Text("Next at ${formatTime(it)}", fontSize = 14.sp) }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(c.sub.ifBlank { c.title }, fontSize = 16.sp, modifier = Modifier.weight(1f))
                    c.weather?.let { Weather(it) }
                }
            }
            if (c.look.coming) c.next?.let { Text(it, fontSize = 14.sp, color = Muted) }
        }
        c.today?.let { Spacer(Modifier.height(12.dp)); Today(it) }
    }, bottom = {
        val icons = c.look.icons
        // "Snooze · 10 min" on two lines.
        val snooze = c.snooze.substringBefore(" · ")
        val small = c.snooze.substringAfter(" · ", "")
        if (c.look.stop == StopBy.SLIDE) {
            BigButton(Modifier.fillMaxWidth().height(96.dp), snoozeIcon(icons), snooze, small, Container, TextColour, Primary, a.snooze)
            Spacer(Modifier.height(12.dp))
            Stopper(c.look, a.stop)
        } else {
            Row(Modifier.fillMaxWidth().height(160.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                BigButton(Modifier.weight(1f).height(160.dp), snoozeIcon(icons), snooze, small, Container, TextColour, Primary, a.snooze)
                BigStop(c.look, stopSmall, a.stop)
            }
        }
        a.done?.let {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = it, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Mark done") }
        }
        c.bundle?.takeIf { it.rest.isNotEmpty() }?.let { b ->
            TextButton(onClick = a.stopRest, modifier = Modifier.padding(top = 4.dp).height(48.dp)) { Text("Stop the rest · ${b.restTimes}", fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    })
}

private const val CHIPS = 4

@Composable
private fun RowScope.Chip(text: String, i: Int, current: Int) {
    val now = i == current
    Box(
        Modifier.weight(1f).height(36.dp).clip(RoundedCornerShape(10.dp))
            .background(if (now) Container else Color.Transparent)
            .then(if (i > current || now) Modifier.border(1.dp, if (now) Primary else Hairline, RoundedCornerShape(10.dp)) else Modifier),
        contentAlignment = Alignment.Center,
    ) { Text(text, fontSize = 13.sp, color = if (now) TextColour else if (i < current) Faint else Muted, fontWeight = if (now) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1) }
}

@Composable
private fun BigButton(mod: Modifier, icon: ImageVector, label: String, small: String, bg: Color, fg: Color, tint: Color, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = mod, shape = RoundedCornerShape(28.dp), colors = ButtonDefaults.buttonColors(containerColor = bg, contentColor = fg)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, Modifier.size(32.dp), tint = tint)
            Spacer(Modifier.height(6.dp))
            Text(label, fontSize = 18.sp, fontWeight = FontWeight.Medium)
            if (small.isNotEmpty()) Text(small, fontSize = 13.sp)
        }
    }
}

/** B's Stop: a big button, by a tap or a hold; the backup comes up under a hold that fails. */
@Composable
private fun RowScope.BigStop(look: RingLook, small: String, stop: () -> Unit) {
    if (look.stop == StopBy.TAP) {
        BigButton(Modifier.weight(1f).height(160.dp).testTag("stop"), stopIcon(look.icons), "Stop", small, Primary, OnPrimary, OnPrimary, stop)
    } else {
        Box(Modifier.weight(1f).fillMaxHeight()) { Stopper(look, stop, tall = true) }
    }
}

// ---------- Stopping: slide, hold or tap ----------

/**
 * The stop control. A slide or a hold has a way out: a touch that doesn't finish, or none at all for
 * [StopBackup.AFTER_MS], brings up a plain Stop button under it. The volume keys and the notification's
 * Stop work whatever happens here.
 */
@Composable
private fun Stopper(look: RingLook, stop: () -> Unit, tall: Boolean = false) {
    if (look.stop == StopBy.TAP) {
        Button(onClick = stop, modifier = Modifier.fillMaxWidth().height(64.dp).testTag("stop")) {
            Icon(stopIcon(look.icons), null, Modifier.size(22.dp)); Spacer(Modifier.width(8.dp)); Text("Stop", fontSize = 17.sp)
        }
        return
    }
    var failed by remember { mutableIntStateOf(0) }
    var late by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(StopBackup.AFTER_MS); late = true }
    Column(Modifier.then(if (tall) Modifier.fillMaxSize() else Modifier.fillMaxWidth()), horizontalAlignment = Alignment.CenterHorizontally) {
        val mod = if (tall) Modifier.fillMaxWidth().weight(1f) else Modifier.fillMaxWidth().height(if (look.stop == StopBy.SLIDE) 68.dp else 64.dp)
        if (look.stop == StopBy.SLIDE) SlideTrack(mod, stopIcon(look.icons), stop) { failed++ }
        else HoldButton(mod, stopIcon(look.icons), stop) { failed++ }
        // Its room is kept from the start: coming up, it mustn't move the track from under the next try.
        Box(Modifier.padding(top = 4.dp).height(48.dp), contentAlignment = Alignment.Center) {
            if (StopBackup.shows(if (late) StopBackup.AFTER_MS else 0L, failed)) {
                TextButton(onClick = stop, modifier = Modifier.testTag("backupStop")) { Text("Stop", fontSize = 15.sp) }
            }
        }
    }
}

@Composable
private fun SlideTrack(mod: Modifier, icon: ImageVector, stop: () -> Unit, failed: () -> Unit) {
    val scope = rememberCoroutineScope()
    val x = remember { Animatable(0f) }
    var done by remember { mutableStateOf(false) }
    val shimmer by rememberInfiniteTransition(label = "slide").animateFloat(
        initialValue = 0.3f, targetValue = 1f, animationSpec = infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "slide",
    )
    BoxWithConstraints(
        mod.clip(CircleShape).background(Raised).border(1.dp, if (done) Primary else Hairline, CircleShape)
            // A screen reader can't slide: its double tap stops it.
            .semantics(mergeDescendants = true) { contentDescription = "Slide to stop"; onClick("Stop") { if (!done) { done = true; stop() }; true } }
            .testTag("slide"),
    ) {
        val inset = 6.dp
        val knob = maxHeight - inset * 2
        val density = LocalDensity.current
        val max = with(density) { (maxWidth - knob - inset * 2).toPx() }
        Row(Modifier.align(Alignment.Center).padding(start = knob), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Slide to stop", fontSize = 15.sp, color = Muted, maxLines = 1)
            Text("›››", fontSize = 15.sp, color = Muted.copy(alpha = shimmer), maxLines = 1)
        }
        Box(
            Modifier.offset { IntOffset(x.value.roundToInt() + with(density) { inset.roundToPx() }, with(density) { inset.roundToPx() }) }
                .size(knob).clip(CircleShape).background(Primary),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, null, Modifier.size(26.dp), tint = OnPrimary) }
        // Over the whole track: a finger that lands a little off the knob still slides it.
        Box(Modifier.matchParentSize().pointerInput(max) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                var at = x.value
                var ended = false
                while (!ended) {
                    val e = awaitPointerEvent()
                    val c = e.changes.firstOrNull { it.id == down.id } ?: break
                    if (!c.pressed) break
                    val d: Offset = c.positionChange()
                    at = (at + d.x).coerceIn(0f, max)
                    c.consume()
                    scope.launch { x.snapTo(at) }
                    if (StopBackup.slideDone(at, max)) ended = true
                }
                if (ended && !done) { done = true; scope.launch { x.snapTo(max) }; stop() }
                else if (!done) { failed(); scope.launch { x.animateTo(0f, spring()) } }
            }
        })
    }
}

private const val HOLD_MS = 1200L

@Composable
private fun HoldButton(mod: Modifier, icon: ImageVector, stop: () -> Unit, failed: () -> Unit) {
    val scope = rememberCoroutineScope()
    var progress by remember { mutableStateOf(0f) }
    var done by remember { mutableStateOf(false) }
    BoxWithConstraints(
        mod.clip(RoundedCornerShape(32.dp)).background(Raised).border(1.dp, Hairline, RoundedCornerShape(32.dp))
            .semantics(mergeDescendants = true) { contentDescription = "Hold to stop"; onClick("Stop") { if (!done) { done = true; stop() }; true } }
            .testTag("hold")
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    // Counted in frames' time, not an animation: with Android's animations off that would finish at once.
                    val run = scope.launch {
                        val start = withFrameMillis { it }
                        while (progress < 1f) progress = withFrameMillis { (it - start) / HOLD_MS.toFloat() }.coerceAtMost(1f)
                        if (!done) { done = true; stop() }
                    }
                    waitForUpOrCancellation()
                    if (!done) { run.cancel(); progress = 0f; failed() }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.align(Alignment.CenterStart).fillMaxHeight().width(maxWidth * progress).background(Container))
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, Modifier.size(24.dp), tint = TextColour)
            Text("Hold to stop", fontSize = 14.sp)
        }
    }
}

