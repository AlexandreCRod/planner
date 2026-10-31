package com.alex.planner.web.alarm

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneId

/** Planner's one card (218): what the lines say, their order, in-place updates and clearing, both looks. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CardTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val nm get() = ctx.getSystemService(NotificationManager::class.java)
    private val zone = ZoneId.systemDefault()
    private val today = LocalDate.now()
    private fun at(h: Int, m: Int = 0) = today.atTime(h, m).atZone(zone).toInstant().toEpochMilli()
    private val now = at(8, 40)

    private fun event(id: Long, title: String, min: Int, end: Int? = null) =
        Item(id, ItemType.EVENT, title, startDay = today.toEpochDay(), startMin = min, endMin = end, endDay = today.toEpochDay())

    @Before fun setUp() {
        Mirror.reload()
        look()
        Notifications.createChannels(ctx)
    }

    @After fun tearDown() { Mirror.reload() }

    private fun look(card: Int = 1, icons: Int = 1) = Mirror.update(ctx) { it.copy(settings = AlarmSettings(clockFormat = 1, notificationCard = card, notificationIcons = icons)) }

    private fun posted() = shadowOf(nm).allNotifications
    private fun lines() = posted().filter { it.flags and Notification.FLAG_GROUP_SUMMARY == 0 }
    private fun titles() = lines().map { it.extras.getString(Notification.EXTRA_TITLE) }
    private fun summary() = posted().firstOrNull { it.flags and Notification.FLAG_GROUP_SUMMARY != 0 }

    // ---- What a line says ----

    private fun line(vararg a: LineAlert, start: Long = at(10), routine: Boolean = false, completable: Boolean = false, started: Boolean = false) =
        Line("i1", itemId = 1, name = "Tese", start = start, alerts = a.toList(), routine = routine, completable = completable, started = started)

    @Test fun anAlarmBeforeTheStartSaysWhenAndHowLongBefore() {
        val l = line(LineAlert(1, AlertType.ALARM, at(9, 30), at(9, 30), offsetMin = 30))
        assertEquals("Rings at 09:30, 30 min before", Card.lineText(l, now))
        assertEquals(Card.Kind.RING, Card.kind(l))
    }

    /** 244: a series is one row however far apart it rings, even with bundles turned off; other alarms stay out. */
    @Test fun aSeriesIsOneRowWhateverTheBundleWindow() {
        fun clock(id: Long, start: Long, a: ClockAlarm) = Line("c$id", clockId = id, name = "Wake up", start = start, bundle = Card.daysKey(a, start), alerts = listOf(LineAlert(0, AlertType.ALARM, start, start)))
        val one = clock(1, at(9), ClockAlarm(1, 9, 0, series = 5, days = 31))
        val two = clock(2, at(9, 40), ClockAlarm(2, 9, 40, series = 5, days = 31))
        val other = clock(3, at(9, 30), ClockAlarm(3, 9, 30, days = 31))
        val rows = Card.rows(listOf(one, other, two), 0, now)
        assertEquals(listOf(listOf("c1", "c2"), listOf("c3")), rows.map { r -> r.lines.map { it.key } })
        assertEquals("2 alarms · Rings", rows[0].text)
    }

    @Test fun theMockupsOtherLines() {
        assertEquals("Rings at 10:00", Card.lineText(line(LineAlert(1, AlertType.ALARM, at(10), at(10))), now))
        val popUp = line(LineAlert(1, AlertType.REMINDER, at(8, 50), at(8, 50), offsetMin = 10), start = at(9))
        assertEquals("Notifies at 08:50", Card.lineText(popUp, now))
        assertEquals(Card.Kind.POPS, Card.kind(popUp))
        val routine = line(LineAlert(1, AlertType.NOTIFICATION, at(8, 30), at(8, 30), fired = true), start = at(8, 30), routine = true, completable = true)
        assertEquals("Routine · Silent · not ticked yet", Card.lineText(routine, now))
        assertEquals(Card.Kind.SILENT, Card.kind(routine))
    }

    /** The roadmap's example: the reminder came, the alarm's still to ring at the start. */
    @Test fun atReminderTimeItSaysHowLongAndThatItRings() {
        val l = line(
            LineAlert(1, AlertType.REMINDER, at(9, 30), at(9, 30), offsetMin = 30, fired = true),
            LineAlert(2, AlertType.ALARM, at(10), at(10)),
        )
        assertEquals("In 30 min · Rings", Card.lineText(l, at(9, 30)))
    }

    @Test fun spansReadPlainly() {
        assertEquals("5 min", Card.span(5 * 60_000))
        assertEquals("1 h", Card.span(60 * 60_000))
        assertEquals("1 h 5 min", Card.span(65 * 60_000))
    }

    // ---- Rows and the header ----

    private fun clockLine(id: Long, h: Int, m: Int, days: Int = 31, label: String = "Wake up") =
        Line("c$id", clockId = id, name = label, start = at(h, m), bundle = "w:$days", alerts = listOf(LineAlert(0, AlertType.ALARM, at(h, m), at(h, m))))

    @Test fun aBundleIsOneRowWithItsSpan() {
        val rows = Card.rows(listOf(clockLine(1, 7, 0), clockLine(2, 7, 10), clockLine(3, 7, 20), clockLine(4, 7, 30)), 19, at(6, 45))
        assertEquals(1, rows.size)
        assertEquals("Wake up · 07:00–07:30", rows[0].title)
        assertEquals("4 alarms · Rings", rows[0].text)
    }

    @Test fun onlyTheSameDaysWithinTheWindowBundle() {
        assertEquals(2, Card.rows(listOf(clockLine(1, 7, 0), clockLine(2, 7, 10, days = 96)), 19, now).size)
        assertEquals(2, Card.rows(listOf(clockLine(1, 7, 0), clockLine(2, 7, 30)), 19, now).size)
        assertEquals(2, Card.rows(listOf(clockLine(1, 7, 0), clockLine(2, 7, 10)), 0, now).size)
    }

    @Test fun rowsComeInTimeOrderAndTheHeaderSaysTheNextRing() {
        val rows = Card.rows(listOf(clockLine(1, 10, 30), clockLine(2, 9, 30, days = 1), line(LineAlert(1, AlertType.NOTIFICATION, at(8, 30), at(8, 30), fired = true), start = at(8, 30))), 19, now)
        assertEquals(listOf("Tese", "Wake up", "Wake up"), rows.map { it.name })
        assertEquals("Next ring 09:30", Card.header(rows, now))
        assertNull(Card.header(rows.take(1), now))
    }

    // ---- Clearing ----

    @Test fun anEventEndsItsLineATaskStays() {
        val day = today.toEpochDay()
        assertEquals(at(11), Card.expiry(event(1, "Gym", 10 * 60, 11 * 60), day))
        assertEquals("an hour without an end", at(11), Card.expiry(event(1, "Gym", 10 * 60), day))
        assertNull(Card.expiry(Item(2, ItemType.TASK, "Bins", startDay = day, startMin = 600), day))
        val allDay = Item(3, ItemType.EVENT, "Trip", startDay = day, endDay = day + 1, allDay = true)
        assertEquals(today.plusDays(2).atStartOfDay(zone).toInstant().toEpochMilli(), Card.expiry(allDay, day))
    }

    @Test fun pruneDropsEndedLinesAndAlarmsThatNeverCame() {
        val ended = line(LineAlert(1, AlertType.REMINDER, at(8), at(8), fired = true)).copy(expires = at(8, 30))
        val task = line(LineAlert(1, AlertType.REMINDER, at(8), at(8), fired = true), completable = true).copy(key = "i2")
        val stale = line(LineAlert(1, AlertType.ALARM, at(8), at(8))).copy(key = "i3")
        assertEquals(listOf("i2"), Card.prune(listOf(ended, task, stale), now).map { it.key })
    }

    // ---- In the shade ----

    private val tese = Item(1, ItemType.TASK, "Tese", startDay = today.toEpochDay(), startMin = 23 * 60 + 50)
    private val reminder = Reminder(11, 1, 20, AlertType.REMINDER)
    private val alarm = Reminder(12, 1, 0, AlertType.ALARM)
    private fun data() = Mirror.update(ctx) { it.copy(items = listOf(tese), reminders = listOf(reminder, alarm)) }

    @Test fun aStartedTasksLineGoesWhenTheTaskIsTrashed() {
        data()
        Card.started(ctx, tese, today.toEpochDay(), show = true, popUp = false)
        assertEquals(1, lines().size)
        // The page leaves a trashed item out of what it sends.
        Mirror.update(ctx) { it.copy(items = emptyList(), reminders = emptyList()) }
        AlarmScheduler.rescheduleAll(ctx)
        assertTrue(lines().isEmpty())
        assertNull(summary())
    }

    @Test fun onlyTheLineOfTheItemThatLeftGoes() {
        val other = Item(2, ItemType.TASK, "Water", startDay = today.toEpochDay(), startMin = 23 * 60 + 55)
        val otherAlarm = Reminder(21, 2, 0, AlertType.ALARM)
        Mirror.update(ctx) { it.copy(items = listOf(tese, other), reminders = listOf(reminder, alarm, otherAlarm)) }
        Card.started(ctx, tese, today.toEpochDay(), show = true, popUp = false)
        Card.started(ctx, other, today.toEpochDay(), show = true, popUp = false)
        Card.clockNotice(ctx, ClockAlarm(5, 23, 59, label = "Late"), at(23, 59))
        assertEquals(3, lines().size)
        Mirror.update(ctx) { it.copy(items = listOf(other), reminders = listOf(otherAlarm)) }
        AlarmScheduler.rescheduleAll(ctx)
        assertEquals(listOf("Late", "Water"), titles().map { it!!.substringBefore(" ·") }.sorted())
    }

    @Test fun aStartedTasksLineStaysWhileItsStillThere() {
        data()
        Card.started(ctx, tese, today.toEpochDay(), show = true, popUp = false)
        AlarmScheduler.rescheduleAll(ctx)
        assertEquals(1, lines().size)
    }

    @Test fun oneLinePerItemUpdatedInPlaceInOneGroup() {
        data()
        val due = at(23, 30)
        Card.notice(ctx, tese, reminder, today.toEpochDay(), due, due, snoozed = false)
        Card.notice(ctx, tese, alarm, today.toEpochDay(), at(23, 50), at(23, 50), snoozed = false)
        assertEquals(listOf("Tese · 23:50"), titles())
        assertEquals(Card.GROUP, lines().single().group)
        assertEquals(Card.GROUP, summary()!!.group)
        assertEquals(Notification.GROUP_ALERT_CHILDREN, lines().single().groupAlertBehavior)
        // It came due: still one line, now on the channel that pops up.
        Notifications.show(ctx, tese, reminder, today.toEpochDay(), due, quiet = false)
        assertEquals(1, lines().size)
        assertEquals(Notifications.CH_REMIND, lines().single().channelId)
        // Quiet hours: nothing pops up.
        Card.dismissed(ctx, "i1")
        Notifications.show(ctx, tese, reminder, today.toEpochDay(), due, quiet = true)
        assertEquals(Notifications.CH_UPCOMING, lines().single().channelId)
    }

    @Test fun takingBackTheNoticeLeavesWhatWentOff() {
        data()
        Notifications.show(ctx, tese, reminder, today.toEpochDay(), at(23, 30), quiet = true)
        Card.notice(ctx, tese, alarm, today.toEpochDay(), at(23, 50), at(23, 50), snoozed = false)
        Notifications.cancelUpcoming(ctx, alarm.id)
        Notifications.cancelUpcoming(ctx, reminder.id)
        assertEquals(1, lines().size)
        Card.dropFired(ctx, reminder.id)
        assertTrue(posted().isEmpty())
    }

    @Test fun tickingRemovesTheLineAndTheSummary() {
        data()
        Card.notice(ctx, tese, alarm, today.toEpochDay(), at(23, 50), at(23, 50), snoozed = false)
        Card.dropItem(ctx, tese.id)
        assertTrue(posted().isEmpty())
    }

    @Test fun aSwipedLineStaysGone() {
        data()
        Card.notice(ctx, tese, alarm, today.toEpochDay(), at(23, 50), at(23, 50), snoozed = false)
        val delete = lines().single().deleteIntent
        assertEquals(AlarmReceiver.ACTION_CARD_DISMISS, shadowOf(delete).savedIntent.action)
        Card.dismissed(ctx, shadowOf(delete).savedIntent.getStringExtra(AlarmReceiver.EXTRA_KEYS)!!)
        Card.refresh(ctx)
        assertTrue(posted().isEmpty())
    }

    @Test fun theLinesComeBackAfterARestart() {
        data()
        Card.notice(ctx, tese, alarm, today.toEpochDay(), at(23, 50), at(23, 50), snoozed = false)
        nm.cancelAll()
        Card.refresh(ctx)
        assertEquals(listOf("Tese · 23:50"), titles())
    }

    @Test fun rowsHaveTheirButtons() {
        data()
        Card.notice(ctx, tese, alarm, today.toEpochDay(), at(23, 59), at(23, 59), snoozed = false)
        // A task: Done beside Skip (Snooze goes in the last 15 minutes before it rings).
        val labels = lines().single().actions.map { it.title.toString() }
        assertEquals("Skip", labels.first())
        assertEquals("Done", labels.last())
    }

    @Test fun iconSetsChangeTheRowInPlace() {
        data()
        Card.notice(ctx, tese, alarm, today.toEpochDay(), at(23, 50), at(23, 50), snoozed = false)
        assertTrue(lines().single().getLargeIcon() != null)
        val before = lines().single().extras.getString("plannerSig")
        look(icons = 3)
        Card.refresh(ctx)
        assertEquals(1, lines().size)
        assertTrue("drawn again with the new set", lines().single().extras.getString("plannerSig") != before)
    }

    // ---- The list look ----

    @Test fun theListLookIsOneCardWithBoldTimes() {
        look(card = 2)
        data()
        Card.notice(ctx, tese, alarm, today.toEpochDay(), at(23, 50), at(23, 50), snoozed = false)
        val other = Item(2, ItemType.EVENT, "Gym", startDay = today.toEpochDay(), startMin = 23 * 60)
        Mirror.update(ctx) { it.copy(items = it.items + other) }
        Card.notice(ctx, other, Reminder(21, 2, 5, AlertType.REMINDER), today.toEpochDay(), at(22, 55), at(22, 55), snoozed = false)
        val n = posted().single()
        assertEquals("Next ring 23:50 · Tese", n.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("2 coming up in the next 2 hours", n.extras.getString(Notification.EXTRA_TEXT))
        val rows = n.extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)!!.map { it.toString() }
        assertEquals(listOf("23:00  Gym · Notifies at 22:55", "23:50  Tese · Rings at 23:50"), rows)
        assertFalse(n.flags and Notification.FLAG_GROUP_SUMMARY != 0)
        assertEquals("Skip next alarm", n.actions.first().title.toString())
    }

    private fun wakeUps(): List<ClockAlarm> {
        val first = java.time.LocalDateTime.now().plusMinutes(30)
        val list = (0..2L).map { i -> first.plusMinutes(i * 10).let { ClockAlarm(i + 1, it.hour, it.minute, label = "Wake up", days = 127) } }
        list.forEach { ClockAlarms.save(ctx, it); ClockAlarms.notice(ctx, it.id, ClockAlarms.nextRingAt(it)!!) }
        return list
    }

    @Test fun aBundlesRowSkipsOneOrAll() {
        ClockAlarms.reload()
        val alarms = wakeUps()
        val row = lines().single()
        assertEquals("3 alarms · Rings", row.extras.getString(Notification.EXTRA_TEXT))
        assertEquals("Skip all", row.actions[1].title.toString())
        // "Skip all", as Android delivers it.
        val intent = shadowOf(row.actions[1].actionIntent).savedIntent
        AlarmReceiver().onReceive(ctx, intent)
        val until = System.currentTimeMillis() + 3_000
        while ((ClockAlarms.get(ctx, 3)!!.skip.isEmpty() || lines().isNotEmpty()) && System.currentTimeMillis() < until) Thread.sleep(20)
        assertEquals(listOf(1, 1, 1), alarms.map { ClockAlarms.get(ctx, it.id)!!.skip.size })
        assertTrue(lines().isEmpty())
        ClockAlarms.reload()
    }

    @Test fun skipAllAlsoDropsASnoozeOfTheBundle() {
        ClockAlarms.reload()
        val first = java.time.LocalDateTime.now().plusMinutes(10)
        val list = (0..1L).map { i -> first.plusMinutes(i * 10).let { ClockAlarm(i + 1, it.hour, it.minute, label = "Wake up", days = 127) } }
        list.forEach { ClockAlarms.save(ctx, it); ClockAlarms.notice(ctx, it.id, ClockAlarms.nextRingAt(it)!!) }
        // It rang five minutes ago, and was snoozed.
        val rang = java.time.LocalDateTime.now().minusMinutes(5).let { ClockAlarm(9, it.hour, it.minute, label = "Wake up", days = 127) }
        ClockAlarms.save(ctx, rang)
        ClockAlarms.snooze(ctx, 9, 15)
        val intent = shadowOf(lines().single().actions[1].actionIntent).savedIntent
        AlarmReceiver().onReceive(ctx, intent)
        val until = System.currentTimeMillis() + 3_000
        while ((ClockAlarms.get(ctx, 2)!!.skip.isEmpty() || ClockAlarms.snoozes(ctx).isNotEmpty()) && System.currentTimeMillis() < until) Thread.sleep(20)
        assertEquals(1, ClockAlarms.get(ctx, 2)!!.skip.size)
        assertTrue(ClockAlarms.snoozes(ctx).isEmpty())
        ClockAlarms.reload()
    }

    @Test fun theListLooksButtonsSayWhatABundlesDo() {
        look(card = 2)
        ClockAlarms.reload()
        wakeUps()
        assertEquals("Skip all", posted().single().actions[1].title.toString())
        ClockAlarms.reload()
    }

    @Test fun switchingTheLookRedrawsIt() {
        data()
        Card.notice(ctx, tese, alarm, today.toEpochDay(), at(23, 50), at(23, 50), snoozed = false)
        assertEquals(2, posted().size)
        look(card = 2)
        Card.refresh(ctx)
        assertEquals(1, posted().size)
        look(card = 1)
        Card.refresh(ctx)
        assertEquals(2, posted().size)
    }
}
