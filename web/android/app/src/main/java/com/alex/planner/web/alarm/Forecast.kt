package com.alex.planner.web.alarm

import android.content.Context
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId

/**
 * The hourly forecast for the phone's own city, as the page last fetched it from Open-Meteo
 * (web/src/alarms/weather.ts) and pushed here, so the ringing screen of a clock alarm can show the
 * weather at that hour without asking the network. Nothing is fetched here; with no forecast for the
 * hour (or one more than a few days old) nothing is shown.
 */
@Serializable
data class HourlyForecast(val at: List<Long> = emptyList(), val t: List<Double> = emptyList(), val c: List<Int> = emptyList(), val fetched: Long = 0)

object Forecast {
    private const val PREFS = "weather"
    private const val MAX_AGE_MS = 4L * 24 * 3600 * 1000

    fun save(context: Context, text: String): Boolean {
        runCatching { json.decodeFromString(HourlyForecast.serializer(), text) }.getOrNull() ?: return false
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("hourly", text).apply()
        return true
    }

    /** Temperature (°C) and weather code for the hour holding [ts], or null. */
    fun at(context: Context, ts: Long): Pair<Double, Int>? {
        val text = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("hourly", null) ?: return null
        val f = runCatching { json.decodeFromString(HourlyForecast.serializer(), text) }.getOrNull() ?: return null
        if (System.currentTimeMillis() - f.fetched > MAX_AGE_MS) return null
        val i = f.at.indexOfFirst { ts >= it && ts < it + 3_600_000 }
        if (i < 0 || i >= f.t.size || i >= f.c.size) return null
        return f.t[i] to f.c[i]
    }

    /** The symbol for a weather code (weatherSymbol in domain/alarms.ts), day or night by the hour. */
    fun icon(code: Int, ts: Long): ImageVector {
        val h = Instant.ofEpochMilli(ts).atZone(ZoneId.systemDefault()).hour
        val day = h in 6..19
        val name = when {
            code == 0 -> if (day) "oWbSunny" else "oNightsStay"
            code <= 2 -> if (day) "oFilterDrama" else "oNightsStay"
            code == 3 -> "oCloud"
            code == 45 || code == 48 -> "oWbCloudy"
            code in 51..57 -> "oGrain"
            code in 61..67 || code in 80..82 -> "oUmbrella"
            code in 71..77 || code == 85 || code == 86 -> "oAcUnit"
            code >= 95 -> "oThunderstorm"
            else -> "oCloud"
        }
        return ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            addPath(PathParser().parsePathString(PATHS.getValue(name)).toNodes(), fill = SolidColor(Color.Black))
        }.build()
    }

    private val PATHS = mapOf(
    "oWbSunny" to "M6.76 4.84l-1.8 -1.79l-1.41 1.41l1.79 1.79ZM1 10.5h3v2L1 12.5ZM11 0.55h2L13 3.5h-2ZM19.04 3.045l1.408 1.407l-1.79 1.79l-1.407 -1.408ZM17.24 18.16l1.79 1.8l1.41 -1.41l-1.8 -1.79ZM20 10.5h3v2h-3ZM12 5.5c-3.31 0 -6 2.69 -6 6s2.69 6 6 6s6 -2.69 6 -6s-2.69 -6 -6 -6ZM12 15.5c-2.21 0 -4 -1.79 -4 -4s1.79 -4 4 -4s4 1.79 4 4s-1.79 4 -4 4ZM11 19.5h2v2.95h-2ZM3.55 18.54l1.41 1.41l1.79 -1.8l-1.41 -1.41Z",
    "oNightsStay" to "M19.78 17.51c-2.47 0 -6.57 -1.33 -8.68 -5.43C8.77 7.57 10.6 3.6 11.63 2.01C6.27 2.2 1.98 6.59 1.98 12c0 0.14 0.02 0.28 0.02 0.42C2.61 12.16 3.28 12 3.98 12c0 0 0 0 0 0c0 -3.09 1.73 -5.77 4.3 -7.1C7.78 7.09 7.74 9.94 9.32 13c1.57 3.04 4.18 4.95 6.8 5.86c-1.23 0.74 -2.65 1.15 -4.13 1.15c-0.5 0 -1 -0.05 -1.48 -0.14c-0.37 0.7 -0.94 1.27 -1.64 1.64c0.98 0.32 2.03 0.5 3.11 0.5c3.5 0 6.58 -1.8 8.37 -4.52C20.18 17.5 19.98 17.51 19.78 17.51Z M7 16l-0.18 0C6.4 14.84 5.3 14 4 14c-1.66 0 -3 1.34 -3 3s1.34 3 3 3c0.62 0 2.49 0 3 0c1.1 0 2 -0.9 2 -2C9 16.9 8.1 16 7 16Z",
    "oFilterDrama" to "M19.35 10.04C18.67 6.59 15.64 4 12 4C9.11 4 6.61 5.64 5.36 8.04C2.35 8.36 0 10.9 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5 -2.24 5 -5c0 -2.64 -2.05 -4.78 -4.65 -4.96ZM19 18H6c-2.21 0 -4 -1.79 -4 -4s1.79 -4 4 -4s4 1.79 4 4h2c0 -2.76 -1.86 -5.08 -4.4 -5.78C8.61 6.88 10.2 6 12 6c3.03 0 5.5 2.47 5.5 5.5v0.5H19c1.65 0 3 1.35 3 3s-1.35 3 -3 3Z",
    "oCloud" to "M12 6c2.62 0 4.88 1.86 5.39 4.43l0.3 1.5l1.53 0.11c1.56 0.1 2.78 1.41 2.78 2.96c0 1.65 -1.35 3 -3 3H6c-2.21 0 -4 -1.79 -4 -4c0 -2.05 1.53 -3.76 3.56 -3.97l1.07 -0.11l0.5 -0.95C8.08 7.14 9.94 6 12 6m0 -2C9.11 4 6.6 5.64 5.35 8.04C2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5 -2.24 5 -5c0 -2.64 -2.05 -4.78 -4.65 -4.96C18.67 6.59 15.64 4 12 4Z",
    "oWbCloudy" to "M12.01 6c2.61 0 4.89 1.86 5.4 4.43l0.3 1.5l1.52 0.11c1.56 0.11 2.78 1.41 2.78 2.96c0 1.65 -1.35 3 -3 3h-13c-2.21 0 -4 -1.79 -4 -4c0 -2.05 1.53 -3.76 3.56 -3.97l1.07 -0.11l0.5 -0.95C8.08 7.14 9.95 6 12.01 6m0 -2C9.12 4 6.6 5.64 5.35 8.04C2.35 8.36 0.01 10.91 0.01 14c0 3.31 2.69 6 6 6h13c2.76 0 5 -2.24 5 -5c0 -2.64 -2.05 -4.78 -4.64 -4.96C18.68 6.59 15.65 4 12.01 4Z",
    "oGrain" to "M10 12c-1.1 0 -2 0.9 -2 2s0.9 2 2 2s2 -0.9 2 -2s-0.9 -2 -2 -2ZM6 8c-1.1 0 -2 0.9 -2 2s0.9 2 2 2s2 -0.9 2 -2s-0.9 -2 -2 -2ZM6 16c-1.1 0 -2 0.9 -2 2s0.9 2 2 2s2 -0.9 2 -2s-0.9 -2 -2 -2ZM18 8c1.1 0 2 -0.9 2 -2s-0.9 -2 -2 -2s-2 0.9 -2 2s0.9 2 2 2ZM14 16c-1.1 0 -2 0.9 -2 2s0.9 2 2 2s2 -0.9 2 -2s-0.9 -2 -2 -2ZM18 12c-1.1 0 -2 0.9 -2 2s0.9 2 2 2s2 -0.9 2 -2s-0.9 -2 -2 -2ZM14 8c-1.1 0 -2 0.9 -2 2s0.9 2 2 2s2 -0.9 2 -2s-0.9 -2 -2 -2ZM10 4c-1.1 0 -2 0.9 -2 2s0.9 2 2 2s2 -0.9 2 -2s-0.9 -2 -2 -2Z",
    "oUmbrella" to "M14.5 6.92L13 5.77V3.88V3.4c0 -0.26 0.22 -0.48 0.5 -0.48c0.28 0 0.5 0.21 0.5 0.48V4h2V3.4C16 2.07 14.88 1 13.5 1C12.12 1 11 2.07 11 3.4v0.48v1.89L9.5 6.92L6 6.07l5.05 15.25C11.2 21.77 11.6 22 12 22s0.8 -0.23 0.95 -0.69L18 6.07L14.5 6.92ZM13.28 8.5l0.76 0.58l0.92 -0.23L13 14.8V8.29L13.28 8.5ZM9.96 9.09l0.76 -0.58L11 8.29v6.51L9.03 8.86L9.96 9.09Z",
    "oAcUnit" to "M22 11h-4.17l3.24 -3.24l-1.41 -1.42L15 11h-2V9l4.66 -4.66l-1.42 -1.41L13 6.17V2h-2v4.17L7.76 2.93L6.34 4.34L11 9v2H9L4.34 6.34L2.93 7.76L6.17 11H2v2h4.17l-3.24 3.24l1.41 1.42L9 13h2v2l-4.66 4.66l1.42 1.41L11 17.83V22h2v-4.17l3.24 3.24l1.42 -1.41L13 15v-2h2l4.66 4.66l1.41 -1.42L17.83 13H22v-2Z",
    "oThunderstorm" to "M17.92 7.02C17.45 4.18 14.97 2 12 2C9.82 2 7.83 3.18 6.78 5.06C4.09 5.41 2 7.74 2 10.5C2 13.53 4.47 16 7.5 16h10c2.48 0 4.5 -2.02 4.5 -4.5C22 9.16 20.21 7.23 17.92 7.02ZM17.5 14h-10C5.57 14 4 12.43 4 10.5c0 -1.74 1.31 -3.23 3.04 -3.46l0.99 -0.13l0.49 -0.87C9.23 4.78 10.56 4 12 4c1.94 0 3.63 1.44 3.95 3.35l0.25 1.52l1.54 0.14C19.01 9.13 20 10.22 20 11.5C20 12.88 18.88 14 17.5 14Z M14.8 17l-2.9 3.32l2 1l-2.35 2.68l2.65 0l2.9 -3.32l-2 -1l2.35 -2.68Z M8.8 17l-2.9 3.32l2 1l-2.35 2.68l2.65 0l2.9 -3.32l-2 -1l2.35 -2.68Z",
    )
}
