package com.alex.planner.web.alarm

import android.media.AudioManager
import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Test

/** Every volume-key way to stop a ringing alarm, as tables (195). */
class VolumeKeysTest {
    private val music = AudioManager.STREAM_MUSIC
    private val alarm = AudioManager.STREAM_ALARM

    @Test fun theMediaVolumeIsNudgedOffItsEnds() {
        // now, min, max -> target
        val table = listOf(
            Triple(0, 0, 15) to 1,   // volume-down at 0 would change nothing
            Triple(15, 0, 15) to 14, // volume-up at max would change nothing
            Triple(7, 0, 15) to 7,   // in between: left alone
            Triple(1, 1, 15) to 2,   // a phone whose minimum isn't 0
            Triple(0, 0, 1) to 0,    // no room for a step either way: left alone
        )
        for ((args, want) in table) assertEquals(args.toString(), want, VolumeKeys.nudgeTarget(args.first, args.second, args.third))
    }

    private data class Change(val name: String, val stream: Int, val value: Int, val prev: Int, val musicSet: Int, val musicWas: Int, val since: Long, val stops: Boolean)

    @Test fun whichVolumeChangesStopIt() {
        val table = listOf(
            Change("volume-down from the nudged step", music, 0, 1, 1, 0, 5_000, true),
            Change("volume-up from the nudged step", music, 15, 14, 14, 15, 5_000, true),
            Change("the app's own nudge is ignored", music, 1, 0, 1, 0, 5_000, false),
            Change("the own nudge arriving late is still ignored", music, 1, 0, 1, 0, 60_000, false),
            Change("a press on the alarm stream", alarm, 5, 6, 1, 0, 5_000, true),
            Change("no change is no press", music, 7, 7, -1, -1, 5_000, false),
            Change("the first 700 ms are ignored", music, 6, 7, -1, -1, 699, false),
            Change("from 700 ms it counts", music, 6, 7, -1, -1, 700, true),
            Change("the same values on another stream aren't the nudge", alarm, 1, 0, 1, 0, 5_000, true),
        )
        for (c in table) assertEquals(c.name, c.stops, VolumeKeys.changeStops(c.stream, c.value, c.prev, c.musicSet, c.musicWas, c.since))
    }

    @Test fun theRemoteSessionStopsOnAnyPress() {
        assertEquals(true, VolumeKeys.adjustStops(AudioManager.ADJUST_LOWER))
        assertEquals(true, VolumeKeys.adjustStops(AudioManager.ADJUST_RAISE))
        assertEquals(false, VolumeKeys.adjustStops(AudioManager.ADJUST_SAME))
        assertEquals(true, VolumeKeys.setStops(4, 5))
        assertEquals(false, VolumeKeys.setStops(5, 5))
    }

    @Test fun keysOnTheRingingScreen() {
        // key, repeat, finishing -> stops
        val table = listOf(
            Triple(KeyEvent.KEYCODE_VOLUME_DOWN, 0, false) to true,
            Triple(KeyEvent.KEYCODE_VOLUME_UP, 0, false) to true,
            Triple(KeyEvent.KEYCODE_VOLUME_MUTE, 0, false) to true,
            Triple(KeyEvent.KEYCODE_VOLUME_DOWN, 3, false) to false, // held: only the first press
            Triple(KeyEvent.KEYCODE_VOLUME_UP, 0, true) to false,    // already closing
            Triple(KeyEvent.KEYCODE_BACK, 0, false) to false,
            Triple(KeyEvent.KEYCODE_POWER, 0, false) to false,
        )
        for ((args, want) in table) assertEquals(args.toString(), want, VolumeKeys.keyStops(args.first, args.second, args.third))
        assertEquals(false, VolumeKeys.isVolumeKey(KeyEvent.KEYCODE_BACK))
    }
}
