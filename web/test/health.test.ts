import assert from "node:assert/strict";
import { test } from "node:test";
import { dayOf } from "../src/domain/training.ts";
import {
  type RawByType, type RawRecord, changedOnly, convertHealth, daysOf, nightOf, readWindows, sameRecord, sessionOf,
} from "../src/domain/health.ts";

// Raw records as the plugin hands them over (health/HealthConnectPlugin.kt): epoch ms, offsets in seconds,
// metric units, metadata. Times below are in Central European winter time (+01:00), Garmin's app as origin.
const GARMIN = "com.garmin.android.apps.connectmobile";
const FIT = "com.google.android.apps.fitness";
const OFF = 3600;
const at = (iso: string) => Date.parse(`${iso}+01:00`);
const meta = (id: string, origin = GARMIN): RawRecord["metadata"] => ({ id, origin, lastModified: 1, device: { type: 1, manufacturer: "Garmin", model: "Forerunner 265" } });
const interval = (id: string, from: number, to: number, fields: Record<string, unknown>, origin = GARMIN): RawRecord =>
  ({ startTime: from, startZoneOffset: OFF, endTime: to, endZoneOffset: OFF, ...fields, metadata: meta(id, origin) });
const instant = (id: string, time: number, fields: Record<string, unknown>, origin = GARMIN): RawRecord => ({ time, zoneOffset: OFF, ...fields, metadata: meta(id, origin) });

// ---------- A run: 8 km at 07:00 on Tue 27 Oct, 1 km laps, a 2-minute pause after 20 minutes ----------

const KM_S = [372, 365, 360, 358, 355, 350, 345, 375]; // 48:00 of running
const START = at("2026-10-27T07:00:00");
const PAUSE_AT = 1200, PAUSE_S = 120;
const MOVING = KM_S.reduce((a, b) => a + b, 0);
const wall = (moving: number) => START + 1000 * (moving < PAUSE_AT ? moving : moving + PAUSE_S);
const END = wall(MOVING);
const kmAt = (moving: number) => { let a = 0; for (let i = 0; i < KM_S.length; i++) { a += KM_S[i]; if (moving < a) return i; } return KM_S.length - 1; };

function runRaw(withSegments = true): RawByType {
  const laps: Record<string, unknown>[] = [];
  let acc = 0;
  for (const s of KM_S) { laps.push({ startTime: wall(acc), endTime: wall(acc + s), length: 1000 }); acc += s; }
  const speed: Record<string, unknown>[] = [], hr: Record<string, unknown>[] = [];
  for (let t = 0; t < (END - START) / 1000; t += 5) {
    const paused = t >= PAUSE_AT && t < PAUSE_AT + PAUSE_S;
    const moving = t < PAUSE_AT ? t : paused ? PAUSE_AT : t - PAUSE_S;
    if (t % 10 === 0) speed.push({ time: START + t * 1000, speed: paused ? 0 : 1000 / KM_S[kmAt(moving)] });
    hr.push({ time: START + t * 1000, beatsPerMinute: paused ? 150 - Math.floor((t - PAUSE_AT) / 6) : 128 + Math.floor(30 * moving / MOVING) });
  }
  const segments = withSegments ? [
    { startTime: START, endTime: START + PAUSE_AT * 1000, segmentType: 56, repetitions: 0 },
    { startTime: START + PAUSE_AT * 1000, endTime: START + (PAUSE_AT + PAUSE_S) * 1000, segmentType: 39, repetitions: 0 },
    { startTime: START + (PAUSE_AT + PAUSE_S) * 1000, endTime: END, segmentType: 56, repetitions: 0 },
  ] : [];
  return {
    ExerciseSession: [interval("run-1", START, END, { exerciseType: 56, exerciseTypeName: "running", title: "Morning run", notes: null, segments, laps, hasRoute: false })],
    Speed: [interval("speed-1", START, END, { samples: speed })],
    HeartRate: [interval("hr-1", START, END, { samples: hr })],
    Distance: [interval("dist-1", START, END, { distance: 8000 }), interval("dist-fit", START, END, { distance: 7700 }, FIT)],
    Steps: [interval("steps-1", START, END, { count: 8160 })],
    ActiveCaloriesBurned: [interval("kcal-1", START, END, { energy: 520 })],
    ElevationGained: [interval("elev-1", START, END, { elevation: 45.4 })],
  };
}

test("run: times, moving time minus the pause, totals and cadence from steps ÷ moving time", () => {
  const raw = runRaw();
  const s = sessionOf(raw.ExerciseSession![0], raw, 99);
  assert.equal(s.id, "hc:run-1");
  assert.equal(s.day, dayOf("2026-10-27"));
  assert.equal(s.time, "07:00");
  assert.equal(s.endTime, "07:50");
  assert.equal(s.startMs, START);
  assert.equal(s.durationS, 3000);
  assert.equal(s.movingS, 2880);
  assert.equal(s.exerciseType, "running");
  assert.equal(s.title, "Morning run");
  assert.equal(s.source, GARMIN);
  assert.equal(s.distanceKm, 8);       // Garmin's own distance, not the fitness app's copy
  assert.equal(s.ascentM, 45);
  assert.equal(s.steps, 8160);
  assert.equal(s.kcal, 520);
  assert.equal(s.cadenceSpm, 170);     // 8160 ÷ 48 min
  assert.equal(s.maxHr, 157);
  assert.ok(s.avgHr! > 135 && s.avgHr! < 145, `avgHr ${s.avgHr}`);
  assert.equal(s.updatedAt, 99);
});

test("run: laps as seconds from the start, the one with the pause spanning it", () => {
  const raw = runRaw();
  const s = sessionOf(raw.ExerciseSession![0], raw, 0);
  assert.equal(s.laps.length, 8);
  assert.deepEqual(s.laps[0], { startS: 0, endS: 372, m: 1000 });
  assert.deepEqual(s.laps[3], { startS: 1097, endS: 1575, m: 1000 }); // 1097 + 358 + the 120 s pause
  assert.deepEqual(s.laps[7], { startS: 2625, endS: 3000, m: 1000 });
});

test("run: per-km splits in moving seconds with their heart rate, from the speed series", () => {
  const raw = runRaw();
  const s = sessionOf(raw.ExerciseSession![0], raw, 0);
  assert.deepEqual(s.splits.map((x) => x.km), [1, 2, 3, 4, 5, 6, 7, 8]);
  s.splits.forEach((x, i) => assert.ok(Math.abs(x.s - KM_S[i]) <= 3, `km ${x.km}: ${x.s} s, expected ~${KM_S[i]}`));
  assert.equal(s.splits.reduce((a, x) => a + x.s, 0), 2880);
  assert.ok(s.splits[0].hr! < s.splits[7].hr!, "HR rises through the run");
  assert.ok(s.splits.every((x) => x.hr !== null));
});

test("run: a compact HR line, one value per 15 s", () => {
  const raw = runRaw();
  const s = sessionOf(raw.ExerciseSession![0], raw, 0);
  assert.equal(s.hr.length, 200);   // 3000 s ÷ 15
  assert.equal(s.hr[0], 128);
  assert.ok(s.hr.every((v) => v >= 128 && v <= 158));
});

test("run without pause segments: the stop is found in the speed series", () => {
  const raw = runRaw(false);
  const s = sessionOf(raw.ExerciseSession![0], raw, 0);
  assert.equal(s.movingS, 2880);
  assert.equal(s.cadenceSpm, 170);
});

test("a gym session: no distance, splits or cadence; HR from the watch", () => {
  const from = at("2026-10-28T18:00:00"), to = at("2026-10-28T19:00:00");
  const raw: RawByType = {
    ExerciseSession: [interval("gym-1", from, to, { exerciseType: 70, exerciseTypeName: "strength_training", title: null, segments: [], laps: [] })],
    HeartRate: [interval("hr-g", from, to, { samples: [{ time: from, beatsPerMinute: 90 }, { time: from + 60_000, beatsPerMinute: 120 }] })],
  };
  const s = sessionOf(raw.ExerciseSession![0], raw, 0);
  assert.equal(s.exerciseType, "strength_training");
  assert.equal(s.title, "");
  assert.equal(s.distanceKm, null);
  assert.equal(s.cadenceSpm, null);
  assert.deepEqual(s.splits, []);
  assert.equal(s.avgHr, 105);
  assert.equal(s.movingS, 3600);
  assert.equal(s.hr.length, 240);
  assert.deepEqual(s.hr.slice(0, 5), [90, 0, 0, 0, 120]);
});

test("an exercise type the plugin couldn't name keeps its number", () => {
  const r = interval("x", START, END, { exerciseType: 999 });
  assert.equal(sessionOf(r, {}, 0).exerciseType, "type_999");
});

// ---------- A night: 23:10 Mon to 06:50 Tue, stages across midnight ----------

function nightRaw(): RawRecord {
  const bed = at("2026-10-26T23:10:00");
  const m = (min: number) => bed + min * 60_000;
  const stages = [
    [1, 0, 10],     // awake
    [4, 10, 40],    // light, across midnight
    [5, 40, 100],   // deep
    [4, 100, 160],
    [6, 160, 190],  // REM
    [7, 190, 195],  // awake in bed
    [4, 195, 300],
    [5, 300, 330],
    [6, 330, 400],
    [4, 400, 455],
    [1, 455, 460],
  ].map(([stage, a, b]) => ({ startTime: m(a), endTime: m(b), stage }));
  return interval("night-1", bed, m(460), { title: null, notes: null, stages });
}

test("night: the morning it ends, bed and wake as local times, minutes per stage", () => {
  const n = nightOf(nightRaw(), 5);
  assert.equal(n.id, "hc:night-1");
  assert.equal(n.day, dayOf("2026-10-27"));
  assert.equal(n.bed, "2026-10-26T23:10");
  assert.equal(n.wake, "2026-10-27T06:50");
  assert.equal(n.deepMin, 90);
  assert.equal(n.lightMin, 250);
  assert.equal(n.remMin, 100);
  assert.equal(n.totalMin, 440);   // deep + light + REM
  assert.equal(n.awakeMin, 20);
  assert.equal(n.stages.length, 11);
  assert.deepEqual(n.stages[0], ["awake", 0, 10]);
  assert.deepEqual(n.stages[1], ["light", 10, 40]);
  assert.deepEqual(n.stages[10], ["awake", 455, 460]);
  assert.equal(n.source, GARMIN);
});

test("night without stages: the whole time counts as sleep", () => {
  const r = interval("n2", at("2026-10-27T13:00:00"), at("2026-10-27T13:40:00"), { stages: [] });
  const n = nightOf(r, 0);
  assert.equal(n.totalMin, 40);
  assert.equal(n.deepMin, null);
  assert.equal(n.awakeMin, null);
  assert.deepEqual(n.stages, []);
});

// ---------- A day's steps, heart rate, weigh-in and the rest ----------

function dayRaw(): RawByType {
  return {
    Steps: [
      interval("s1", at("2026-10-27T09:00:00"), at("2026-10-27T10:00:00"), { count: 1200 }),
      interval("s2", at("2026-10-27T12:00:00"), at("2026-10-27T13:00:00"), { count: 2300 }),
      // The phone's own count of the same walk: one app counts, the one with more.
      interval("s3", at("2026-10-27T12:00:00"), at("2026-10-27T13:00:00"), { count: 2000 }, FIT),
      interval("s4", at("2026-10-28T08:00:00"), at("2026-10-28T09:00:00"), { count: 500 }),
    ],
    Distance: [interval("d1", at("2026-10-27T12:00:00"), at("2026-10-27T13:00:00"), { distance: 1700 })],
    TotalCaloriesBurned: [interval("t1", at("2026-10-27T00:00:00"), at("2026-10-27T23:59:00"), { energy: 2650.4 })],
    ActiveCaloriesBurned: [interval("a1", at("2026-10-27T07:00:00"), at("2026-10-27T07:50:00"), { energy: 520 })],
    FloorsClimbed: [interval("f1", at("2026-10-27T10:00:00"), at("2026-10-27T10:10:00"), { floors: 6 })],
    ElevationGained: [interval("e1", at("2026-10-27T10:00:00"), at("2026-10-27T10:10:00"), { elevation: 18.2 })],
    RestingHeartRate: [instant("r0", at("2026-10-27T00:10:00"), { beatsPerMinute: 55 }), instant("r1", at("2026-10-27T06:50:00"), { beatsPerMinute: 51 })],
    HeartRateVariabilityRmssd: [instant("v1", at("2026-10-27T03:00:00"), { heartRateVariabilityMillis: 46 }), instant("v2", at("2026-10-27T05:00:00"), { heartRateVariabilityMillis: 51 })],
    OxygenSaturation: [instant("o1", at("2026-10-27T04:00:00"), { percentage: 95 }), instant("o2", at("2026-10-27T05:00:00"), { percentage: 96 })],
    RespiratoryRate: [instant("rr", at("2026-10-27T04:00:00"), { rate: 14.25 })],
    Vo2Max: [instant("vo", at("2026-10-27T07:50:00"), { vo2MillilitersPerMinuteKilogram: 52, measurementMethod: 3 })],
    HeartRate: [
      // An hour of all-day HR; then a record that starts late on Tuesday and runs past midnight.
      interval("h1", at("2026-10-27T10:00:00"), at("2026-10-27T11:00:00"), { samples: [62, 64, 70, 58].map((v, i) => ({ time: at("2026-10-27T10:00:00") + i * 60_000, beatsPerMinute: v })) }),
      interval("h2", at("2026-10-27T23:58:00"), at("2026-10-28T00:02:00"), { samples: [{ time: at("2026-10-27T23:59:00"), beatsPerMinute: 54 }, { time: at("2026-10-28T00:01:00"), beatsPerMinute: 49 }] }),
    ],
    Weight: [instant("w1", at("2026-10-27T08:12:00"), { weight: 82.4 }), instant("w2", at("2026-10-27T21:30:00"), { weight: 83.05 })],
    BodyFat: [instant("bf", at("2026-10-27T08:13:00"), { percentage: 18.5 })],
    Height: [instant("ht", at("2026-10-27T08:00:00"), { height: 1.82 })],
    BasalMetabolicRate: [instant("bmr", at("2026-10-27T08:00:00"), { basalMetabolicRate: 85 })],
    SkinTemperature: [interval("sk", at("2026-10-27T01:00:00"), at("2026-10-27T06:00:00"), { deltas: [] })],
  };
}

test("day: totals from one app, latest resting HR, averages, the HR range by each sample's own day", () => {
  const raw = dayRaw();
  const tue = dayOf("2026-10-27")!;
  const days = daysOf(raw, tue, tue + 2, 7);
  assert.deepEqual(days.map((d) => d.id), ["hcd:2026-10-27", "hcd:2026-10-28"]);
  const d = days[0];
  assert.equal(d.day, tue);
  assert.equal(d.steps, 3500);         // Garmin's 1200 + 2300 (more than the fitness app's 2000)
  assert.equal(d.distanceKm, 1.7);
  assert.equal(d.kcalTotal, 2650);
  assert.equal(d.kcalActive, 520);
  assert.equal(d.floors, 6);
  assert.equal(d.ascentM, 18);
  assert.equal(d.restingHr, 51);       // the day's latest
  assert.equal(d.hrvMs, 49);           // (46 + 51) ÷ 2 = 48.5
  assert.equal(d.spo2, 95.5);
  assert.equal(d.respiration, 14.3);
  assert.equal(d.vo2max, 52);
  assert.equal(d.hrMin, 54);
  assert.equal(d.hrMax, 70);
  assert.equal(d.hrAvg, 62);           // (62 + 64 + 70 + 58 + 54) ÷ 5 = 61.6
  assert.equal(d.updatedAt, 7);
  const wed = days[1];
  assert.equal(wed.steps, 500);
  assert.equal(wed.hrMin, 49);
  assert.equal(wed.hrMax, 49);
  assert.equal(wed.restingHr, null);
  assert.deepEqual(wed.weighIns, []);
});

test("day: weigh-ins with their time and the body fat measured with them", () => {
  const raw = dayRaw();
  const tue = dayOf("2026-10-27")!;
  const [d] = daysOf(raw, tue, tue + 1, 0);
  assert.deepEqual(d.weighIns, [
    { time: "08:12", kg: 82.4, fatPct: 18.5, source: GARMIN },
    { time: "21:30", kg: 83.05, fatPct: null, source: GARMIN },
  ]);
});

test("day: other types go in extra, an unknown one as a count", () => {
  const raw = dayRaw();
  const tue = dayOf("2026-10-27")!;
  const [d] = daysOf(raw, tue, tue + 1, 0);
  assert.deepEqual(d.extra, { heightM: 1.82, bmrKcal: 1754.08, SkinTemperatureCount: 1 });
});

test("days outside the window aren't made", () => {
  const raw = dayRaw();
  const wed = dayOf("2026-10-28")!;
  assert.deepEqual(daysOf(raw, wed, wed + 1, 0).map((d) => d.id), ["hcd:2026-10-28"]);
});

// ---------- All of it, and saving only what changed ----------

test("convertHealth: sessions by their start day, nights by their morning, days in the window", () => {
  const raw: RawByType = { ...dayRaw(), SleepSession: [nightRaw()] };
  for (const [type, list] of Object.entries(runRaw())) raw[type] = [...(raw[type] ?? []), ...list!];
  const tue = dayOf("2026-10-27")!;
  const r = convertHealth(raw, tue, tue + 1, 0);
  assert.deepEqual(r.sessions.map((s) => s.id), ["hc:run-1"]);
  assert.deepEqual(r.nights.map((n) => n.id), ["hc:night-1"]);
  assert.deepEqual(r.days.map((d) => d.id), ["hcd:2026-10-27"]);
  assert.equal(r.days[0].steps, 3500 + 8160);
  const later = convertHealth(raw, tue + 1, tue + 2, 0);
  assert.deepEqual(later.sessions, []);
  assert.deepEqual(later.nights, []);
});

test("only changed records are saved; when they were made doesn't count", () => {
  const raw = runRaw();
  const a = sessionOf(raw.ExerciseSession![0], raw, 1);
  const b = sessionOf(raw.ExerciseSession![0], raw, 2);
  assert.ok(sameRecord(a, b));
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.ok(sameRecord(a, reordered));
  const stored = new Map<string, unknown>([[a.id, a]]);
  assert.deepEqual(changedOnly([b], stored), []);
  const c = { ...b, title: "Tempo" };
  assert.deepEqual(changedOnly([c], stored), [c]);
  assert.deepEqual(changedOnly([{ ...b, id: "hc:new" }], stored).length, 1);
});

test("read windows: the whole history at first, then from 3 days before the last read", () => {
  assert.deepEqual(readWindows(null, 100, 120), [[100, 114], [114, 121]]);
  assert.deepEqual(readWindows(118, 0, 120), [[115, 121]]);
  assert.deepEqual(readWindows(null, 200, 120), [[120, 121]]);  // nothing yet: just today
});
