package com.alex.planner.web.health

import androidx.health.connect.client.records.*
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.*
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.math.roundToLong
import kotlin.math.sin

/**
 * Debug builds' test records (HealthConnectPlugin.insertSample), shaped like Garmin Connect's: a morning run
 * with 1 km laps, a 2-minute pause, speed and heart-rate series; the night before with sleep stages across
 * midnight; and the day's steps, resting HR, HRV, SpO2, VO2 max, a weigh-in with body fat and an hour of
 * all-day heart rate. Fixed client ids per day, so inserting again replaces rather than duplicates.
 */
object Samples {
    private val watch = Device(type = Device.TYPE_WATCH, manufacturer = "Garmin", model = "Forerunner 265")
    private val scale = Device(type = Device.TYPE_SCALE, manufacturer = "Garmin", model = "Index S2")

    fun records(daysAgo: Int): List<Record> {
        val zone = ZoneId.systemDefault()
        val day = LocalDate.now(zone).minusDays(daysAgo.toLong())
        val off: ZoneOffset = zone.rules.getOffset(day.atStartOfDay(zone).toInstant())
        fun at(d: LocalDate, h: Int, m: Int, s: Int = 0): Instant = d.atTime(LocalTime.of(h, m, s)).atZone(zone).toInstant()
        var n = 0
        fun meta(dev: Device = watch) = Metadata.activelyRecorded(dev, "planner-sample-$day-${n++}", 1L)
        val out = mutableListOf<Record>()

        // ---- The run: 8 km, 07:00, one 2-minute pause after 20 minutes of running.
        val start = at(day, 7, 0)
        val kmS = listOf(372, 365, 360, 358, 355, 350, 345, 375) // 48:00 moving
        val pauseAt = 1200L
        val pauseS = 120L
        fun wall(moving: Long): Instant = start.plusSeconds(if (moving < pauseAt) moving else moving + pauseS)
        val movingTotal = kmS.sum().toLong()
        val end = wall(movingTotal)
        val laps = mutableListOf<ExerciseLap>()
        var acc = 0L
        for (s in kmS) {
            laps += ExerciseLap(startTime = wall(acc), endTime = wall(acc + s), length = Length.meters(1000.0))
            acc += s
        }
        out += ExerciseSessionRecord(
            startTime = start, startZoneOffset = off, endTime = end, endZoneOffset = off, metadata = meta(),
            exerciseType = ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, title = "Morning run",
            segments = listOf(
                ExerciseSegment(startTime = start, endTime = start.plusSeconds(pauseAt), segmentType = ExerciseSegment.EXERCISE_SEGMENT_TYPE_RUNNING),
                ExerciseSegment(startTime = start.plusSeconds(pauseAt), endTime = start.plusSeconds(pauseAt + pauseS), segmentType = ExerciseSegment.EXERCISE_SEGMENT_TYPE_PAUSE),
                ExerciseSegment(startTime = start.plusSeconds(pauseAt + pauseS), endTime = end, segmentType = ExerciseSegment.EXERCISE_SEGMENT_TYPE_RUNNING),
            ),
            laps = laps,
        )
        // Speed every 10 s and heart rate every 5 s, by wall time; the pause reads 0 m/s and a falling HR.
        fun kmAt(moving: Long): Int { var a = 0L; for ((i, s) in kmS.withIndex()) { a += s; if (moving < a) return i }; return kmS.size - 1 }
        val elapsed = end.epochSecond - start.epochSecond
        val speeds = mutableListOf<SpeedRecord.Sample>()
        val hrs = mutableListOf<HeartRateRecord.Sample>()
        for (t in 0 until elapsed step 5) {
            val paused = t in pauseAt until pauseAt + pauseS
            val moving = if (t < pauseAt) t else if (paused) pauseAt else t - pauseS
            val i = Instant.ofEpochSecond(start.epochSecond + t)
            if (t % 10 == 0L) speeds += SpeedRecord.Sample(i, Velocity.metersPerSecond(if (paused) 0.0 else 1000.0 / kmS[kmAt(moving)]))
            val bpm = if (paused) 150 - (t - pauseAt) / 6 else 128 + 30 * moving / movingTotal + (3 * sin(t / 40.0)).roundToLong()
            hrs += HeartRateRecord.Sample(i, bpm)
        }
        out += SpeedRecord(startTime = start, startZoneOffset = off, endTime = end, endZoneOffset = off, samples = speeds, metadata = meta())
        out += HeartRateRecord(startTime = start, startZoneOffset = off, endTime = end, endZoneOffset = off, samples = hrs, metadata = meta())
        out += DistanceRecord(startTime = start, startZoneOffset = off, endTime = end, endZoneOffset = off, distance = Length.meters(8000.0), metadata = meta())
        out += StepsRecord(startTime = start, startZoneOffset = off, endTime = end, endZoneOffset = off, count = 8160, metadata = meta())
        out += ActiveCaloriesBurnedRecord(startTime = start, startZoneOffset = off, endTime = end, endZoneOffset = off, energy = Energy.kilocalories(520.0), metadata = meta())
        out += ElevationGainedRecord(startTime = start, startZoneOffset = off, endTime = end, endZoneOffset = off, elevation = Length.meters(45.0), metadata = meta())

        // ---- The night before: 23:10 to 06:50, ~90-minute cycles.
        val bed = at(day.minusDays(1), 23, 10)
        val wake = at(day, 6, 50)
        val cycle = listOf(SleepSessionRecord.STAGE_TYPE_LIGHT to 25, SleepSessionRecord.STAGE_TYPE_DEEP to 30, SleepSessionRecord.STAGE_TYPE_LIGHT to 15,
            SleepSessionRecord.STAGE_TYPE_REM to 18, SleepSessionRecord.STAGE_TYPE_AWAKE to 2)
        val stages = mutableListOf<SleepSessionRecord.Stage>()
        var t = bed
        loop@ while (t < wake) for ((stage, min) in cycle) {
            val e = t.plusSeconds(min * 60L).let { if (it > wake) wake else it }
            stages += SleepSessionRecord.Stage(startTime = t, endTime = e, stage = stage)
            t = e
            if (t >= wake) break@loop
        }
        out += SleepSessionRecord(startTime = bed, startZoneOffset = off, endTime = wake, endZoneOffset = off, metadata = meta(), stages = stages)

        // ---- The day.
        out += StepsRecord(startTime = at(day, 9, 0), startZoneOffset = off, endTime = at(day, 10, 0), endZoneOffset = off, count = 1200, metadata = meta())
        out += StepsRecord(startTime = at(day, 12, 0), startZoneOffset = off, endTime = at(day, 13, 0), endZoneOffset = off, count = 2300, metadata = meta())
        out += DistanceRecord(startTime = at(day, 12, 0), startZoneOffset = off, endTime = at(day, 13, 0), endZoneOffset = off, distance = Length.meters(1700.0), metadata = meta())
        out += TotalCaloriesBurnedRecord(startTime = at(day, 0, 0), startZoneOffset = off, endTime = at(day, 23, 59), endZoneOffset = off, energy = Energy.kilocalories(2650.0), metadata = meta())
        out += RestingHeartRateRecord(time = at(day, 6, 50), zoneOffset = off, beatsPerMinute = 51, metadata = meta())
        out += HeartRateVariabilityRmssdRecord(time = at(day, 6, 30), zoneOffset = off, heartRateVariabilityMillis = 48.0, metadata = meta())
        out += OxygenSaturationRecord(time = at(day, 4, 0), zoneOffset = off, percentage = Percentage(95.0), metadata = meta())
        out += Vo2MaxRecord(time = at(day, 7, 50), zoneOffset = off, vo2MillilitersPerMinuteKilogram = 52.0, metadata = meta(),
            measurementMethod = Vo2MaxRecord.MEASUREMENT_METHOD_HEART_RATE_RATIO)
        out += WeightRecord(time = at(day, 8, 12), zoneOffset = off, weight = Mass.kilograms(82.4), metadata = meta(scale))
        out += BodyFatRecord(time = at(day, 8, 12), zoneOffset = off, percentage = Percentage(18.5), metadata = meta(scale))
        val allDay = (0 until 60).map { m -> HeartRateRecord.Sample(at(day, 10, 0).plusSeconds(m * 60L), 62L + (m % 7)) }
        out += HeartRateRecord(startTime = at(day, 10, 0), startZoneOffset = off, endTime = at(day, 11, 0), endZoneOffset = off, samples = allDay, metadata = meta())
        return out
    }
}
