package com.alex.planner.web.alarm

import android.content.Context
import android.content.Intent
import android.view.KeyEvent
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.LocalDate

/**
 * The ringing screen (195): a volume button stops it (only the first press), Back doesn't hide it,
 * Mark done shows only for what's ticked off (247), and a second alarm updates it (194).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AlarmActivityTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val today = LocalDate.now().toEpochDay()

    @Before fun setUp() {
        // The screen pulses for ever: with animations on, Robolectric's idle() never comes back from its frames.
        android.provider.Settings.Global.putFloat(ctx.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
        Mirror.reload()
        Mirror.update(ctx) {
            MirrorData(items = listOf(
                Item(1, ItemType.EVENT, "Dentist", startDay = today, startMin = 600),
                Item(2, ItemType.TASK, "Bins", startDay = today, startMin = 600),
                Item(3, ItemType.EVENT, "Stretch", startDay = today, startMin = 600, routine = true),
            ))
        }
    }

    @After fun tearDown() = Mirror.reload()

    private fun screen(itemId: Long = 0, clockId: Long = 0, title: String = "Alarm") = Intent(ctx, AlarmActivity::class.java)
        .putExtra(AlarmActivity.EXTRA_TITLE, title).putExtra(AlarmActivity.EXTRA_TEXT, "Today at 10:00")
        .putExtra(AlarmReceiver.EXTRA_ITEM, itemId).putExtra(ClockAlarms.EXTRA_CLOCK, clockId)

    private fun look(layout: Int, stop: Int, coming: Boolean = true) =
        Mirror.update(ctx) { it.copy(settings = AlarmSettings(clockFormat = 1, ringLayout = layout, ringStop = stop, ringComing = coming)) }

    private fun open(i: Intent) = Robolectric.buildActivity(AlarmActivity::class.java, i).setup().get()

    private fun nextServiceAction(): String? = shadowOf(ctx as android.app.Application).nextStartedService?.action

    @Test fun volumeDownStopsAnEventAlarm() {
        val a = Robolectric.buildActivity(AlarmActivity::class.java, screen(itemId = 1)).setup().get()
        a.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_DOWN))
        assertEquals(AlarmService.ACTION_DISMISS, nextServiceAction())
        assertTrue(a.isFinishing)
    }

    @Test fun volumeUpStopsAClockAlarmOnceEvenIfHeld() {
        val a = Robolectric.buildActivity(AlarmActivity::class.java, screen(clockId = 77)).setup().get()
        assertTrue(a.dispatchKeyEvent(KeyEvent(0, 0, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_UP, 3))) // a held repeat: taken, nothing sent
        assertNull(nextServiceAction())
        a.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_UP))
        assertEquals(AlarmService.ACTION_DISMISS, nextServiceAction())
        a.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_VOLUME_UP)) // closing already: nothing more
        assertNull(nextServiceAction())
    }

    @Test fun backDoesntHideIt() {
        val a = Robolectric.buildActivity(AlarmActivity::class.java, screen(itemId = 1)).setup().get()
        a.onBackPressedDispatcher.onBackPressed()
        assertFalse(a.isFinishing)
    }

    @Test fun markDoneOnlyForWhatsTickedOff() {
        fun completable(i: Intent) = Robolectric.buildActivity(AlarmActivity::class.java, i).setup().get().offersMarkDone
        assertFalse(completable(screen(itemId = 1)))   // a plain event (247)
        assertTrue(completable(screen(itemId = 2)))    // a task
        assertTrue(completable(screen(itemId = 3)))    // a routine event
        assertFalse(completable(screen(clockId = 77))) // a clock alarm
    }

    /** 246: the look is read when it opens; one that's bad never gets in the way. */
    @Test fun aBadLookOpensThePlainScreenAndItStillStops() {
        look(layout = 42, stop = 1)
        val a = open(screen(clockId = 77))
        assertEquals(RingLook.PLAIN, a.look)
        a.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_DOWN))
        assertEquals(AlarmService.ACTION_DISMISS, nextServiceAction())
    }

    @Test fun theChosenLookOpensAndAVolumeButtonStopsItThereToo() {
        for ((layout, stop) in listOf(1 to 1, 1 to 2, 2 to 1, 2 to 3)) {
            look(layout, stop)
            val a = open(screen(clockId = 77))
            assertEquals(layout == 2, a.look?.layout == RingLayout.B)
            a.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_UP))
            assertEquals(AlarmService.ACTION_DISMISS, nextServiceAction())
            assertTrue(a.isFinishing)
        }
    }

    /** Over the lock screen: the screen asks to show there and to turn the display on, for every look. */
    @Test fun itShowsOverTheLockScreenInEveryLook() {
        look(1, 1)
        val a = open(screen(clockId = 77))
        assertTrue(shadowOf(a).turnScreenOn)
        assertTrue(shadowOf(a).showWhenLocked)
    }

    @Test fun theScreenSaysWhereItSitsInTheBundle() {
        look(1, 1)
        val now = java.time.LocalTime.now().let { it.hour * 60 + it.minute }.coerceIn(10, 1400)
        ClockAlarms.reload()
        val series = listOf(now - 10, now, now + 10).mapIndexed { i, m -> ClockAlarm(100L + i, m / 60, m % 60, days = 127, series = 3) }
        series.forEach { ClockAlarms.save(ctx, it) }
        val a = open(screen(clockId = 101))
        series.forEach { ClockAlarms.delete(ctx, it.id) }
        assertTrue(a.bundleLine, a.bundleLine!!.startsWith("Alarm 2 of 3 · next "))
    }

    @Test fun aSecondAlarmUpdatesTheScreen() {
        val c = Robolectric.buildActivity(AlarmActivity::class.java, screen(itemId = 1, title = "Dentist")).setup()
        assertFalse(c.get().offersMarkDone)
        c.newIntent(screen(itemId = 2, title = "Bins"))
        assertTrue(c.get().offersMarkDone)
        assertEquals(2L, c.get().shownItem)
    }
}
