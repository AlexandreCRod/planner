import assert from "node:assert/strict";
import { test } from "node:test";
import { dayOf, isoOf } from "../src/domain/training.ts";
import type { HealthDay, HealthNight } from "../src/domain/health.ts";
import type { Night } from "../src/domain/trends.ts";
import {
  type SleepNight, avg7, avg7Line, clockAfter, clockOfMoment, fmtSleep, hrvRange, inBedMin, isNap, mergedNights, nightSpans, nightTotals, nightsOf7, restingHrFlag, shortSleepBefore, sleepAverages, spanAt,
  usualNight,
} from "../src/domain/sleep.ts";

const d = (iso: string) => dayOf(iso)!;
const close = (actual: number | null | undefined, expected: number) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

const garmin = (iso: string, f: Partial<Night> = {}): Night => ({
  id: iso, day: d(iso), bed: `${isoOf(d(iso) - 1)}T23:00`, wake: `${iso}T07:00`, totalMin: 450, awakeMin: 30, deepMin: 80, lightMin: 270, remMin: 100,
  score: 80, restingHr: 52, hrvMs: 50, avgSpo2: 95, avgRespiration: 14, ...f,
});
const watch = (iso: string, f: Partial<HealthNight> = {}): HealthNight => ({
  id: `hc:${iso}${f.bed ?? ""}`, day: d(iso), bed: `${isoOf(d(iso) - 1)}T23:10`, wake: `${iso}T06:50`, totalMin: 432, awakeMin: 28, deepMin: 70, lightMin: 260, remMin: 102,
  stages: [], source: "com.garmin.android.apps.connectmobile", updatedAt: 1, ...f,
});
const hcDay = (iso: string, f: Partial<HealthDay> = {}): HealthDay => ({
  id: `hcd:${iso}`, day: d(iso), steps: null, distanceKm: null, kcalTotal: null, kcalActive: null, floors: null, ascentM: null, restingHr: null, hrvMs: null,
  spo2: null, respiration: null, hrMin: null, hrAvg: null, hrMax: null, vo2max: null, weighIns: [], extra: {}, updatedAt: 1, ...f,
});

// ---------- Merging ----------

test("merge: sleep.json alone, Health Connect alone, both on the same morning", () => {
  const out = mergedNights(
    [garmin("2026-10-26"), garmin("2026-10-27", { restingHr: 50, hrvMs: 48, score: 77 })],
    [watch("2026-10-27"), watch("2026-10-28")],
    [],
  );
  assert.deepEqual(out.map((n) => [isoOf(n.day), n.source, n.totalMin]), [
    ["2026-10-26", "garmin", 450],
    ["2026-10-27", "health_connect", 432],         // Health Connect wins the morning
    ["2026-10-28", "health_connect", 432],
  ]);
  const both = out[1];
  assert.equal(both.bed, "2026-10-26T23:10");
  assert.equal(both.deepMin, 70);
  assert.equal(both.score, 77);                     // only sleep.json has a score
  assert.equal(both.restingHr, 50);                 // Health Connect has no day: sleep.json fills it
  assert.equal(both.restingHrSource, "garmin");
  assert.equal(both.hrvMs, 48);
  assert.equal(out[2].score, null);
  assert.equal(out[2].restingHr, null);
  assert.equal(out[2].restingHrSource, null);
});

test("merge: resting HR and HRV from healthDays win over sleep.json's, each on its own", () => {
  const out = mergedNights([garmin("2026-10-27", { restingHr: 50, hrvMs: 48 })], [], [hcDay("2026-10-27", { restingHr: 54 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "garmin");            // the sleep is still sleep.json's
  assert.equal(out[0].restingHr, 54);
  assert.equal(out[0].restingHrSource, "health_connect");
  assert.equal(out[0].hrvMs, 48);
  assert.equal(out[0].hrvSource, "garmin");
});

test("merge: a morning with only a resting HR from Health Connect is kept, without sleep", () => {
  const out = mergedNights([], [], [hcDay("2026-10-27", { restingHr: 51, hrvMs: 55 }), hcDay("2026-10-28", { steps: 9000 })]);
  assert.deepEqual(out.map((n) => [isoOf(n.day), n.totalMin, n.restingHr, n.hrvMs, n.source]), [["2026-10-27", null, 51, 55, "health_connect"]]);
});

test("merge: two sessions on a morning keep the longest; a nap never counts", () => {
  const out = mergedNights([], [
    watch("2026-10-27", { bed: "2026-10-26T22:00", wake: "2026-10-27T01:30", totalMin: 200 }),
    watch("2026-10-27", { bed: "2026-10-27T02:00", wake: "2026-10-27T07:30", totalMin: 320 }),
    watch("2026-10-27", { bed: "2026-10-27T14:00", wake: "2026-10-27T15:00", totalMin: 400 }),   // a (long) nap
    watch("2026-10-28", { bed: "2026-10-28T13:30", wake: "2026-10-28T14:10", totalMin: 40 }),    // only a nap
  ], []);
  assert.deepEqual(out.map((n) => [isoOf(n.day), n.totalMin]), [["2026-10-27", 320]]);
});

test("merge: a nap leaves the morning to sleep.json", () => {
  const out = mergedNights([garmin("2026-10-28")], [watch("2026-10-28", { bed: "2026-10-28T13:30", wake: "2026-10-28T14:10", totalMin: 40 })], []);
  assert.equal(out[0].source, "garmin");
  assert.equal(out[0].totalMin, 450);
});

test("isNap: starts after 10:00 on the day it ends", () => {
  for (const [bed, wake, nap] of [
    ["2026-10-27T23:00", "2026-10-28T07:00", false],
    ["2026-10-28T00:30", "2026-10-28T07:00", false],
    ["2026-10-28T09:59", "2026-10-28T11:00", false],
    ["2026-10-28T10:00", "2026-10-28T11:00", true],
    ["2026-10-28T21:30", "2026-10-28T23:55", true],
  ] as [string, string, boolean][]) assert.equal(isNap({ bed, wake }), nap, `${bed} → ${wake}`);
});

// ---------- Averages and the HRV range ----------

/** Mornings from [iso] on, one a day, with [f] giving each one's numbers. */
const run = (iso: string, n: number, f: (i: number) => Partial<SleepNight>): SleepNight[] =>
  Array.from({ length: n }, (_, i) => ({
    day: d(iso) + i, bed: null, wake: null, totalMin: null, awakeMin: null, deepMin: null, lightMin: null, remMin: null, spans: [], score: null,
    restingHr: null, hrvMs: null, source: "garmin" as const, restingHrSource: null, hrvSource: null, ...f(i),
  }));

test("7-day averages: the 7 mornings to the day, skipping the ones without", () => {
  const nights = run("2026-10-20", 10, (i) => ({ totalMin: 400 + 10 * i, restingHr: i === 9 ? null : 50 + i, hrvMs: i < 5 ? null : 40 + i }));
  const day = d("2026-10-29");                      // i = 9: the 7 mornings are i = 3..9
  close(avg7(nights, "totalMin", day), 460);        // 430..490
  close(avg7(nights, "restingHr", day), 55.5);      // 53..58 (i = 9 has none)
  close(avg7(nights, "hrvMs", day), 47);            // 45..49
  assert.equal(avg7(nights, "hrvMs", d("2026-10-22")), null);
  assert.deepEqual(sleepAverages(nights, day), { sleepMin: 460, nights: 7, restingHr: 55.5, hrvMs: 47 });
  const line = avg7Line(nights, "restingHr");
  assert.equal(line.length, 9);
  close(line[0].v, 50);
  close(line[8].v, 55);                             // i = 8: 52..58
});

test("HRV range: the last 60 nights' mean ± 1 SD; null under 14 nights", () => {
  const alt = run("2026-08-01", 80, (i) => ({ hrvMs: i < 20 ? 100 : i % 2 ? 46 : 54 }));
  const r = hrvRange(alt, alt[79].day)!;            // the last 60: 30 × 46 and 30 × 54
  close(r.mean, 50);
  close(r.hi - r.mean, Math.sqrt(60 * 16 / 59));    // sample SD
  close(r.mean - r.lo, r.hi - r.mean);
  assert.equal(hrvRange(alt, alt[12].day), null);   // 13 nights so far
  assert.ok(hrvRange(alt, alt[13].day));
  assert.equal(hrvRange(run("2026-08-01", 30, () => ({})), d("2026-08-30")), null);
});

// ---------- The quiet flags ----------

test("shortSleepBefore: the night ending that morning, under 6 h", () => {
  const nights = run("2026-10-26", 3, (i) => ({ totalMin: [359, 360, null][i] }));
  assert.equal(shortSleepBefore(nights, d("2026-10-26")), 359);
  assert.equal(shortSleepBefore(nights, d("2026-10-27")), null);   // 6 h exactly is fine
  assert.equal(shortSleepBefore(nights, d("2026-10-28")), null);   // no sleep: no flag
  assert.equal(shortSleepBefore(nights, d("2026-10-29")), null);   // no night
});

test("restingHrFlag: 7+ above its own 7-day average on two mornings running", () => {
  const hr = (vals: (number | null)[]) => run("2026-10-20", vals.length, (i) => ({ restingHr: vals[i] }));
  const day = d("2026-10-28");                      // index 8
  assert.equal(restingHrFlag(hr([50, 50, 50, 50, 50, 50, 50, 57, 58]), day), true);   // 57 vs 50, 58 vs 51
  assert.equal(restingHrFlag(hr([50, 50, 50, 50, 50, 50, 50, 56, 58]), day), false);  // the day before is only 6 up
  assert.equal(restingHrFlag(hr([50, 50, 50, 50, 50, 50, 50, 57, 57]), day), false);  // 57 vs 51: 6 up
  assert.equal(restingHrFlag(hr([50, 50, 50, 50, 50, 50, 50, 57, null]), day), false);
  assert.equal(restingHrFlag(hr([null, null, null, null, null, 50, 50, 60, 61]), day), false); // 2 mornings before: too few to judge
  assert.equal(restingHrFlag(hr([50, 50, 50, 50, 50, 50, 50, 57, 58]), day + 1), false);    // no reading that day
});

// ---------- Formats ----------

test("fmtSleep and clockOfMoment", () => {
  assert.equal(fmtSleep(432), "7 h 12");
  assert.equal(fmtSleep(425), "7 h 05");
  assert.equal(fmtSleep(360), "6 h 00");
  assert.equal(fmtSleep(424.6), "7 h 05");
  assert.equal(fmtSleep(45), "45 min");
  assert.equal(clockOfMoment("2026-10-27T23:10"), "23:10");
  assert.equal(clockOfMoment(null), null);
});

// ---------- One night's stages (308) ----------

test("a watch night keeps its stretches, the awake kinds as one row, in order, side by side ones joined", () => {
  const stages: HealthNight["stages"] = [["rem", 60, 90], ["awake", 0, 10], ["light", 10, 30], ["light", 30, 40], ["deep", 40, 60], ["awake_in_bed", 90, 95], ["out_of_bed", 95, 100], ["unknown", 100, 110]];
  const [n] = mergedNights([], [watch("2026-10-27", { stages })], []);
  assert.deepEqual(n.spans, [
    { stage: "awake", from: 0, to: 10 }, { stage: "light", from: 10, to: 40 }, { stage: "deep", from: 40, to: 60 }, { stage: "rem", from: 60, to: 90 }, { stage: "awake", from: 90, to: 100 },
  ]);
});

test("nights with totals only have no timeline: the Garmin export, an empty list, a record from before stages, plain sleeping", () => {
  assert.deepEqual(mergedNights([garmin("2026-10-27")], [], [])[0].spans, []);
  assert.deepEqual(mergedNights([], [watch("2026-10-27")], [])[0].spans, []);
  const old = { ...watch("2026-10-27") } as Partial<HealthNight>;
  delete old.stages;
  assert.deepEqual(mergedNights([], [old as HealthNight], [])[0].spans, []);
  assert.deepEqual(nightSpans([["sleeping", 0, 400]]), []);
  assert.deepEqual(nightSpans([["awake", 0, 5], ["sleeping", 5, 400]]), []);    // awake alone says nothing about the night's stages
});

test("reading the chart finds the stretch under the finger, else the nearest across a gap", () => {
  const spans = nightSpans([["light", 0, 30], ["sleeping", 30, 60], ["deep", 60, 90]]);
  assert.equal(spanAt(spans, 10), 0);
  assert.equal(spanAt(spans, 70), 1);
  assert.equal(spanAt(spans, 35), 0);
  assert.equal(spanAt(spans, 55), 1);
  assert.equal(spanAt(spans, 500), 1);
  assert.equal(spanAt([], 10), null);
});

test("a night's stage totals: what's known, none when no stage is", () => {
  assert.deepEqual(nightTotals({ awakeMin: null, deepMin: 80, lightMin: 270, remMin: null }), { awake: 0, rem: 0, light: 270, deep: 80 });
  assert.equal(nightTotals({ awakeMin: 30, deepMin: null, lightMin: null, remMin: null }), null);
});

// The week of 25 to 31 Oct as sleep.csv has it: the 27th has only a resting HR, and only two days have an HRV.
const realWeek = () => mergedNights(
  [
    garmin("2026-10-25", { totalMin: 343, restingHr: 46, hrvMs: 60 }), garmin("2026-10-26", { totalMin: 508, restingHr: 49, hrvMs: 50 }),
  ],
  [watch("2026-10-28", { totalMin: 379 }), watch("2026-10-29", { totalMin: 280 }), watch("2026-10-30", { totalMin: 612 }), watch("2026-10-31", { totalMin: 365 })],
  [
    hcDay("2026-10-27", { restingHr: 47 }), hcDay("2026-10-28", { restingHr: 45 }), hcDay("2026-10-29", { restingHr: 50 }),
    hcDay("2026-10-30", { restingHr: 43 }), hcDay("2026-10-31", { restingHr: 48 }),
  ],
);

test("321: a sleep average is the mean of the nights recorded, and says how many; a day with only a resting HR is no record", () => {
  const avg = sleepAverages(realWeek(), d("2026-10-31"));
  close(avg.sleepMin, (343 + 508 + 379 + 280 + 612 + 365) / 6);   // not ÷ 7: the 27th has only a resting HR
  assert.equal(avg.nights, 6);
  assert.equal(`${fmtSleep(avg.sleepMin!)} · ${nightsOf7(avg.nights)}`, "6 h 55 · 6 of 7 nights");
  close(avg.restingHr, (46 + 49 + 47 + 45 + 50 + 43 + 48) / 7);   // the 27th does count here: it has one
  close(avg.hrvMs, 55);                                           // 60 and 50: only the two days with one
});

test("321: a session that was all awake is no record, and doesn't hide sleep.json's night", () => {
  const empty = watch("2026-10-28", { totalMin: 0, deepMin: 0, lightMin: 0, remMin: 0, awakeMin: 400 });
  assert.equal(mergedNights([garmin("2026-10-28")], [empty], [])[0].totalMin, 450);
  assert.deepEqual(mergedNights([], [empty], []), []);
});

test("321: a 0 from sleep.json or a reading counts nowhere", () => {
  const nights = run("2026-10-25", 7, (i) => ({ totalMin: i % 2 ? 0 : 420, restingHr: i === 6 ? 0 : 50, hrvMs: i === 6 ? 0 : 40 }));
  const day = d("2026-10-31");
  assert.deepEqual(sleepAverages(nights, day), { sleepMin: 420, nights: 4, restingHr: 50, hrvMs: 40 });
  assert.deepEqual(avg7Line(nights, "totalMin").map((p) => p.day - d("2026-10-25")), [0, 2, 4, 6]);
  assert.equal(usualNight(nights, day + 1).asleep, 420);
  const hrv = run("2026-09-01", 14, (i) => ({ hrvMs: i === 13 ? 0 : 50 }));
  assert.equal(hrvRange(hrv, hrv[13].day), null);                 // 13 real nights: too few
});

test("usual is the 30 nights before, not the night itself, and leaves out nights without the number", () => {
  const nights = run("2026-09-01", 40, (i) => ({ totalMin: i === 39 ? 600 : 400, deepMin: i < 5 ? null : 80, lightMin: i < 5 ? null : 250, remMin: i < 5 ? null : 70, awakeMin: i < 5 ? null : 20 }));
  const u = usualNight(nights, nights[39].day);
  assert.equal(u.asleep, 400);
  assert.deepEqual(u.stages, { awake: 20, rem: 70, light: 250, deep: 80 });
  // Only the five nights without stages before it: hours, but no stage usuals.
  assert.equal(usualNight(nights, nights[5].day).stages, null);
  assert.equal(usualNight(nights, nights[5].day).asleep, 400);
  assert.deepEqual(usualNight(nights, nights[0].day), { asleep: null, stages: null });
});

test("bed to wake over midnight, and clocks past it", () => {
  assert.equal(inBedMin("2026-10-31T23:15", "2026-11-01T07:30"), 495);
  assert.equal(clockAfter("2026-10-31T23:15", 50), "00:05");
  assert.equal(clockAfter("2026-10-31T03:48", 495), "12:03");
});
