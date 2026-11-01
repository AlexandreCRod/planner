package com.alex.planner.web.alarm

import android.app.AlarmManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlarmManager

/** Undo of a timer the app really deleted (review of 2.9.5, finding 3): it comes back exactly as it was. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TimerUndoTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val am get() = ctx.getSystemService(AlarmManager::class.java)

    @Before fun setUp() {
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        ClockTools.reload()
        Notifications.createChannels(ctx)
    }

    @After fun tearDown() { ClockTools.reload() }

    private fun timerAlarms() = shadowOf(am).scheduledAlarms.filter { shadowOf(it.operation).savedIntent.action == AlarmReceiver.ACTION_TIMER }

    // Written as the page writes it: JSON.stringify of the timer it read.
    private fun page(t: ClockTimer) =
        """{"id":${t.id},"durationMs":${t.durationMs},"label":"${t.label}","endAt":${t.endAt},"remainingMs":${t.remainingMs}}"""

    @Test fun aPausedTimerComesBackPausedWithItsTimeLengthAndName() {
        val t = ClockTimer(id = 5, durationMs = 600_000, label = "Pasta", endAt = null, remainingMs = 390_000)
        ClockTools.saveTimer(ctx, t)
        ClockTools.deleteTimer(ctx, t.id)
        ClockTools.restoreTimer(ctx, page(t))
        assertEquals(listOf(t), ClockTools.current(ctx).timers)
        assertTrue(timerAlarms().isEmpty())
    }

    @Test fun aRunningTimerComesBackEndingWhenItWould() {
        val end = System.currentTimeMillis() + 300_000
        val t = ClockTimer(id = 6, durationMs = 600_000, label = "Focus", endAt = end, remainingMs = 600_000)
        ClockTools.saveTimer(ctx, t)
        ClockTools.deleteTimer(ctx, t.id)
        ClockTools.restoreTimer(ctx, page(t))
        assertEquals(listOf(t), ClockTools.current(ctx).timers)
        assertEquals(end, timerAlarms().single().triggerAtMs)
    }
}
