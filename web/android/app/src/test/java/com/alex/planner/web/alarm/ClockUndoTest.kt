package com.alex.planner.web.alarm

import android.app.AlarmManager
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import java.time.LocalDateTime
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlarmManager

/**
 * Undo of a deleted alarm on the Clock page (review of 2.9.5, finding 2), the engine's side. The page keeps what it
 * deleted and saves it back; the snooze isn't in that record, so the delete hands it back and the save sets it again.
 * What's looked at is what AlarmManager holds, and a snooze is delivered as Android delivers it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ClockUndoTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val am get() = ctx.getSystemService(AlarmManager::class.java)

    @Before fun setUp() {
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        Mirror.reload(); ClockAlarms.reload(); ClockTools.reload()
        Notifications.createChannels(ctx)
    }

    @After fun tearDown() { Mirror.reload(); ClockAlarms.reload(); ClockTools.reload() }

    private fun clockIn(fromNow: Long, days: Int, id: Long): ClockAlarm {
        val t = LocalDateTime.now().plusMinutes(fromNow)
        return ClockAlarm(id, t.hour, t.minute, label = "Wake up", days = days)
    }

    private fun queued(id: Long, snooze: Boolean) = shadowOf(am).scheduledAlarms.firstOrNull {
        val i = shadowOf(it.operation).savedIntent
        i.action == AlarmReceiver.ACTION_CLOCK && i.getBooleanExtra(AlarmReceiver.EXTRA_SNOOZE, false) == snooze &&
            i.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0) == id
    }

    /** What the page does for Undo: the record as it read it, then its snooze. */
    private fun undo(a: ClockAlarm, snoozedUntil: Long?) {
        ClockAlarms.save(ctx, a)
        snoozedUntil?.let { ClockAlarms.restoreSnooze(ctx, a.id, it) }
    }

    /** Delivers the snooze queued for [id] as Android does, and says whether the alarm service was started for it. */
    private fun ringsWhenDue(id: Long): Boolean {
        val op = queued(id, snooze = true)?.operation ?: return false
        val app = shadowOf(ctx as Application)
        while (app.nextStartedService != null) { /* earlier ones */ }
        // Through the system's queue, so the receiver has its async result, as on a phone.
        ctx.registerReceiver(AlarmReceiver(), IntentFilter(AlarmReceiver.ACTION_CLOCK).apply { addDataScheme("planner-alarm") }, Context.RECEIVER_NOT_EXPORTED)
        ctx.sendBroadcast(Intent(shadowOf(op).savedIntent).setComponent(null))
        val until = System.currentTimeMillis() + 3_000
        while (System.currentTimeMillis() < until) {
            shadowOf(Looper.getMainLooper()).idle()
            val started: Intent? = app.nextStartedService
            if (started != null) return started.getLongExtra(ClockAlarms.EXTRA_CLOCK, 0) == id
            Thread.sleep(10)
        }
        return false
    }

    @Test fun aOneOffWhoseSnoozeIsItsOnlyRingLeftRingsAfterUndo() {
        val once = clockIn(60, days = 0, id = 21)
        ClockAlarms.save(ctx, once)
        ClockAlarms.afterRing(ctx, once.id)
        ClockAlarms.snooze(ctx, once.id, 10)
        val before = ClockAlarms.get(ctx, once.id)!!
        assertFalse(before.enabled)
        val until = ClockAlarms.snoozes(ctx).getValue(once.id)

        assertEquals(until, ClockAlarms.delete(ctx, once.id))
        assertNull(queued(once.id, snooze = true))
        assertNull(ClockAlarms.snoozes(ctx)[once.id])

        undo(before, until)
        assertEquals(until, queued(once.id, snooze = true)?.triggerAtMs)
        assertFalse(ClockAlarms.get(ctx, once.id)!!.enabled)
        assertTrue(ringsWhenDue(once.id))
    }

    @Test fun theSnoozeSurvivesARestartAfterUndo() {
        val once = clockIn(60, days = 0, id = 22)
        ClockAlarms.save(ctx, once)
        ClockAlarms.afterRing(ctx, once.id)
        ClockAlarms.snooze(ctx, once.id, 10)
        val before = ClockAlarms.get(ctx, once.id)!!
        undo(before, ClockAlarms.delete(ctx, once.id))
        shadowOf(am).scheduledAlarms.toList().forEach { am.cancel(it.operation!!) }
        ClockAlarms.reload()
        ClockAlarms.rescheduleAll(ctx)
        assertNotNull(queued(once.id, snooze = true))
    }

    @Test fun aRepeatingAlarmGetsBothItsNextRingAndItsSnooze() {
        val daily = clockIn(120, days = 127, id = 23)
        ClockAlarms.save(ctx, daily)
        ClockAlarms.snooze(ctx, daily.id, 10)
        val until = ClockAlarms.snoozes(ctx).getValue(daily.id)
        undo(daily, ClockAlarms.delete(ctx, daily.id))
        assertEquals(until, queued(daily.id, snooze = true)?.triggerAtMs)
        assertEquals(ClockAlarms.nextRingAt(daily), queued(daily.id, snooze = false)?.triggerAtMs)
    }

    @Test fun oneSnoozedAheadFromTheNoticeRingsThatDayAfterUndo() {
        val daily = clockIn(60, days = 127, id = 24)
        ClockAlarms.save(ctx, daily)
        val at = ClockAlarms.nextRingAt(daily)!!
        ClockAlarms.snoozeEarly(ctx, daily.id, at, 10)
        val before = ClockAlarms.get(ctx, daily.id)!!
        undo(before, ClockAlarms.delete(ctx, daily.id))
        assertEquals(at + 10 * 60_000L, queued(daily.id, snooze = true)?.triggerAtMs)
    }

    @Test fun everyAlarmOfASeriesGetsItsOwnSnoozeBackAndOnlyThose() {
        val series = (0..2L).map { clockIn(60 + it * 10, days = 127, id = 30 + it) }
        series.forEach { ClockAlarms.save(ctx, it) }
        ClockAlarms.snooze(ctx, 30, 5)
        ClockAlarms.snooze(ctx, 32, 15)
        val snoozed = series.map { ClockAlarms.delete(ctx, it.id) }
        assertNotNull(snoozed[0])
        assertNull(snoozed[1])
        series.forEachIndexed { i, a -> undo(a, snoozed[i]) }
        assertEquals(snoozed[0], queued(30, snooze = true)?.triggerAtMs)
        assertNull(queued(31, snooze = true))
        assertEquals(snoozed[2], queued(32, snooze = true)?.triggerAtMs)
    }

    @Test fun aSnoozeThatCameDueDuringTheUndoRingsAtOnceNotNever() {
        val once = clockIn(60, days = 0, id = 25)
        ClockAlarms.save(ctx, once)
        ClockAlarms.afterRing(ctx, once.id)
        ClockAlarms.snooze(ctx, once.id, 10)
        val before = ClockAlarms.get(ctx, once.id)!!
        ClockAlarms.delete(ctx, once.id)
        val now = System.currentTimeMillis()
        undo(before, now - 2_000)
        val at = queued(once.id, snooze = true)?.triggerAtMs
        assertNotNull(at)
        assertTrue(at!! - now < 5_000)
        assertNotNull(ClockAlarms.snoozes(ctx)[once.id]) // and a restart doesn't drop it for being late
    }

    @Test fun anAlarmThatWasntSnoozedComesBackWithoutOne() {
        val daily = clockIn(60, days = 127, id = 26)
        ClockAlarms.save(ctx, daily)
        assertNull(ClockAlarms.delete(ctx, daily.id))
        undo(daily, null)
        assertNull(queued(daily.id, snooze = true))
        assertNotNull(queued(daily.id, snooze = false))
    }
}
