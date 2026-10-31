package com.alex.planner.web.alarm

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate

/**
 * The engine's copy of the native recurrence rules gives the same days as the native app and the web
 * app: the "days" cases of shared/schedule-cases.json (on the test classpath, see app/build.gradle).
 * Also checks that the page's JSON (web record shapes, with fields the engine ignores) decodes.
 */
class AlarmDomainTest {
    /** 245: wake-up alarms are reminders, so moving the event takes all of them along. */
    @org.junit.Test fun wakeUpAlarmsMoveWithTheEvent() {
        val zone = java.time.ZoneId.of("Europe/Lisbon")
        val day = java.time.LocalDate.of(2026, 11, 3)
        val start = day.minusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        val wakes = listOf(120, 110, 100, 90).mapIndexed { i, o -> Reminder(10L + i, 1, o, AlertType.ALARM, wake = true) }
        fun ringsAt(min: Int) = AlarmScheduler.upcoming(
            listOf(Item(1, ItemType.EVENT, "Flight", startDay = day.toEpochDay(), startMin = min)), wakes, { _, _ -> false }, start, 540, { _, at -> at }, 3, zone,
        ).map { java.time.Instant.ofEpochMilli(it.at).atZone(zone).toLocalTime().toString() }
        org.junit.Assert.assertEquals(listOf("06:00", "06:10", "06:20", "06:30"), ringsAt(8 * 60))
        org.junit.Assert.assertEquals(listOf("07:30", "07:40", "07:50", "08:00"), ringsAt(9 * 60 + 30))
    }

    @Test fun sharedRecurrenceCases() {
        val text = javaClass.classLoader!!.getResourceAsStream("schedule-cases.json")!!.bufferedReader().use { it.readText() }
        val cases = Json.parseToJsonElement(text).jsonObject["cases"]!!.jsonArray.map { it.jsonObject }
            .filter { (it["fn"] as JsonPrimitive).content == "days" }
        assertTrue(cases.size >= 10)
        for (c in cases) {
            val item = toItem(c["items"]!!.jsonArray.first().jsonObject)
            val got = Recurrence.occurrences(item, LocalDate.parse(c.str("from")), LocalDate.parse(c.str("to"))).map { it.toString() }
            assertEquals(c.str("name"), c["expect"]!!.jsonArray.map { it.jsonPrimitive.content }, got)
        }
    }

    /** The engine's task and event alarm times (194): reminder times, DST changes, skips by local time. */
    @Test fun sharedAlarmTimeCases() {
        val text = javaClass.classLoader!!.getResourceAsStream("schedule-cases.json")!!.bufferedReader().use { it.readText() }
        val cases = Json.parseToJsonElement(text).jsonObject["cases"]!!.jsonArray.map { it.jsonObject }
            .filter { (it["fn"] as JsonPrimitive).content == "alarmTimes" }
        assertTrue(cases.size >= 4)
        for (c in cases) {
            val zone = java.time.ZoneId.of(c.str("zone"))
            val local = { s: String -> java.time.LocalDateTime.parse(s).atZone(zone).toInstant().toEpochMilli() }
            val items = c["items"]!!.jsonArray.map { toItem(it.jsonObject) }
            val reminders = c["reminders"]!!.jsonArray.map { it.jsonObject }.map {
                Reminder(it["id"]!!.jsonPrimitive.long, it["itemId"]!!.jsonPrimitive.long, it["offsetMin"]!!.jsonPrimitive.int,
                    AlertType.valueOf(it.str("type") ?: "ALARM"))
            }
            val done = (c["done"]?.jsonArray ?: JsonArray(emptyList())).map { it.jsonObject }
                .map { it["itemId"]!!.jsonPrimitive.long to LocalDate.parse(it.str("day")).toEpochDay() }.toSet()
            // Skips are given by local wall time, and looked up by OverrideKey, as AlarmOverrides does.
            val skips = (c["skips"]?.jsonArray ?: JsonArray(emptyList())).map { it.jsonObject }
                .map { OverrideKey.of(it["reminderId"]!!.jsonPrimitive.long, local(it.str("at")!!), zone) }.toSet()
            val got = AlarmScheduler.upcoming(
                items, reminders, { id, d -> (id to d) in done }, local(c.str("now")!!), hhmm(c.str("defaultTime")!!),
                { r, o -> if (OverrideKey.of(r, o, zone) in skips) null else o }, c["days"]!!.jsonPrimitive.int, zone,
            ).map { u ->
                val at = java.time.Instant.ofEpochMilli(u.at).atZone(zone).toLocalDateTime().toString()
                "${u.reminderId} ${LocalDate.ofEpochDay(u.day)} $at${if (u.skipped) " skipped" else ""}"
            }
            val want = c["expect"]!!.jsonArray.map { it.jsonObject }.map {
                "${it["reminderId"]!!.jsonPrimitive.long} ${it.str("day")} ${it.str("at")}${if (it["skipped"]?.jsonPrimitive?.boolean == true) " skipped" else ""}"
            }
            assertEquals(c.str("name"), want, got)
        }
    }

    private fun hhmm(s: String) = s.substringBefore(':').toInt() * 60 + s.substringAfter(':').toInt()

    @Test fun pagePushDecodes() {
        val push = json.decodeFromString(
            MirrorPush.serializer(),
            """{"items":[{"id":1099511627776123,"type":"EVENT","title":"Dentist","content":"<p>x</p>","categoryId":null,"color":null,
               "startDay":20740,"startMin":900,"endDay":20740,"endMin":960,"allDay":false,"freq":"NONE","interval":1,"weekDays":0,
               "monthDays":"","months":0,"untilDay":null,"excludedDays":"","overduePolicy":"SHOW_OVERDUE","deletedAt":null,"priority":0}],
               "reminders":[{"id":1099511627776999,"itemId":1099511627776123,"offsetMin":15,"type":"ALARM","soundUri":null}],
               "completions":[{"itemId":5,"day":20740,"completedAt":1}],
               "settings":{"defaultTaskTime":480,"snoozeMinutes":5,"upcomingAlarms":true,"clockFormat":1}}""",
        )
        assertEquals(1099511627776123L, push.items.single().id)
        assertEquals(ItemType.EVENT, push.items.single().type)
        assertEquals(AlertType.ALARM, push.reminders.single().type)
        assertEquals(480, push.settings.defaultTaskTime)
        assertEquals(5, push.settings.snoozeMinutes)
        assertEquals(22 * 60, push.settings.quietStart)
    }

    private fun toItem(j: JsonObject): Item {
        val weekDays = when (val w = j["weekDays"]) {
            null -> 0
            is JsonArray -> w.fold(0) { mask, d -> mask or DayOfWeek.entries.first { it.name.startsWith(d.jsonPrimitive.content) }.bit() }
            else -> w.jsonPrimitive.int
        }
        val months = when (val m = j["months"]) {
            null -> 0
            is JsonArray -> m.fold(0) { mask, v -> mask or (1 shl (v.jsonPrimitive.int - 1)) }
            else -> m.jsonPrimitive.int
        }
        val monthDays = when (val m = j["monthDays"]) {
            null -> ""
            is JsonArray -> m.joinToString(",") { it.jsonPrimitive.content }
            else -> m.jsonPrimitive.content
        }
        val excluded = when (val x = j["excludedDays"]) {
            null -> ""
            is JsonArray -> x.joinToString(",") { LocalDate.parse(it.jsonPrimitive.content).toEpochDay().toString() }
            else -> x.jsonPrimitive.content
        }
        return Item(
            id = j["id"]!!.jsonPrimitive.long,
            type = ItemType.valueOf(j.str("type") ?: "TASK"),
            title = j.str("title") ?: "",
            startMin = j.str("startMin")?.let { hhmm(it) },
            startDay = j.str("startDay")?.let { LocalDate.parse(it).toEpochDay() },
            allDay = j["allDay"]?.jsonPrimitive?.boolean ?: false,
            freq = Freq.valueOf(j.str("freq") ?: "NONE"),
            interval = j["interval"]?.jsonPrimitive?.int ?: 1,
            weekDays = weekDays,
            monthDays = monthDays,
            months = months,
            untilDay = j.str("untilDay")?.let { LocalDate.parse(it).toEpochDay() },
            excludedDays = excluded,
        )
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
}
