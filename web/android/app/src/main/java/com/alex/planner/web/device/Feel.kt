package com.alex.planner.web.device

import android.content.Context
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * The app's touch feel, in four named strengths (web/src/ui/phone/haptics.ts picks and spaces them):
 * "tick" for each value or slot passed, "pickup" when something is grabbed, "settle" when it lands,
 * "confirm" for a done. Each is one short, soft pulse: the phone's own haptic primitives where it has
 * them (scaled down), its predefined tick or click otherwise, and a brief low buzz only on phones with
 * neither. Played as touch feedback, so the phone's "Touch feedback" setting turns them off.
 */
object Feel {
    @Volatile private var vibrator: Vibrator? = null

    private fun vibrator(context: Context): Vibrator? = vibrator ?: run {
        val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION") context.getSystemService(Vibrator::class.java)
        }
        vibrator = v
        v
    }

    /** Primitive and scale (API 30+), and the predefined effect to fall back on. */
    private class Strength(val primitive: Int, val scale: Float, val predefined: Int, val fallbackMs: Long, val fallbackAmp: Int)

    private val strengths = mapOf(
        "tick" to Strength(VibrationEffect.Composition.PRIMITIVE_TICK, 0.38f, VibrationEffect.EFFECT_TICK, 6, 40),
        "pickup" to Strength(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.42f, VibrationEffect.EFFECT_TICK, 10, 70),
        "settle" to Strength(VibrationEffect.Composition.PRIMITIVE_TICK, 0.7f, VibrationEffect.EFFECT_TICK, 8, 60),
        "confirm" to Strength(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.55f, VibrationEffect.EFFECT_CLICK, 10, 80),
    )

    fun play(context: Context, kind: String) {
        val s = strengths[kind] ?: return
        val v = vibrator(context) ?: return
        if (!v.hasVibrator()) return
        val effect = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && v.areAllPrimitivesSupported(s.primitive) ->
                VibrationEffect.startComposition().addPrimitive(s.primitive, s.scale).compose()
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> VibrationEffect.createPredefined(s.predefined)
            v.hasAmplitudeControl() -> VibrationEffect.createOneShot(s.fallbackMs, s.fallbackAmp)
            else -> VibrationEffect.createOneShot(s.fallbackMs, VibrationEffect.DEFAULT_AMPLITUDE)
        }
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
            } else {
                v.vibrate(effect)
            }
        }
    }
}
