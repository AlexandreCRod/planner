package com.alex.planner.web.alarm

import android.media.AudioManager
import android.view.KeyEvent

/**
 * The decisions behind "a volume button stops a ringing alarm" (195), kept apart from the Android
 * plumbing in [AlarmService] and [AlarmActivity] so they're table-tested (VolumeKeysTest).
 */
object VolumeKeys {
    /** A volume change in the first moments after listening began is a late echo of the alarm before (a takeover), not a press. */
    const val IGNORE_FIRST_MS = 700L

    /**
     * Where the media volume is put while it rings: one step off its ends, so a press of either button
     * changes something and is heard (volume-down at 0 and volume-up at max change nothing otherwise).
     */
    fun nudgeTarget(now: Int, min: Int, max: Int): Int = when {
        max - min < 2 -> now
        now <= min -> min + 1
        now >= max -> max - 1
        else -> now
    }

    /**
     * Whether a VOLUME_CHANGED broadcast stops the alarm: not the app's own nudge ([musicSet] from
     * [musicWas] on the media stream), not a "change" to the same value, and not in the first
     * [IGNORE_FIRST_MS] after listening began ([sinceMs]).
     */
    fun changeStops(stream: Int, value: Int, prev: Int, musicSet: Int, musicWas: Int, sinceMs: Long): Boolean {
        if (stream == AudioManager.STREAM_MUSIC && musicSet >= 0 && value == musicSet && prev == musicWas) return false
        if (value == prev) return false
        return sinceMs >= IGNORE_FIRST_MS
    }

    /** Whether the remote media session's volume request stops it (any press, either way). */
    fun adjustStops(direction: Int): Boolean = direction != 0
    fun setStops(volume: Int, current: Int): Boolean = volume != current

    /** Whether a key on the ringing screen is a volume key (the screen takes it either way). */
    fun isVolumeKey(keyCode: Int): Boolean =
        keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_MUTE

    /** Whether that key stops it: the first press (no held-key repeats), while the screen isn't already closing. */
    fun keyStops(keyCode: Int, repeatCount: Int, finishing: Boolean): Boolean =
        isVolumeKey(keyCode) && repeatCount == 0 && !finishing
}
