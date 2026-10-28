import assert from "node:assert/strict";
import { test } from "node:test";
import { dayOf, isoOf } from "../src/domain/training.ts";
import type { HealthDay, HealthNight } from "../src/domain/health.ts";
import type { Night } from "../src/domain/trends.ts";
import {
  type SleepNight, avg7, avg7Line, clockOfMoment, fmtSleep, hrvRange, isNap, mergedNights, restingHrFlag, shortSleepBefore, sleepAverages,
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
    day: d(iso) + i, bed: null, wake: null, totalMin: null, awakeMin: null, deepMin: null, lightMin: null, remMin: null, score: null,
    restingHr: null, hrvMs: null, source: "garmin" as const, restingHrSource: null, hrvSource: null, ...f(i),
  }));

test("7-day averages: the 7 mornings to the day, skipping the ones without", () => {
  const nights = run("2026-10-20", 10, (i) => ({ totalMin: 400 + 10 * i, restingHr: i === 9 ? null : 50 + i, hrvMs: i < 5 ? null : 40 + i }));
  const day = d("2026-10-29");                      // i = 9: the 7 mornings are i = 3..9
  close(avg7(nights, "totalMin", day), 460);        // 430..490
  close(avg7(nights, "restingHr", day), 55.5);      // 53..58 (i = 9 has none)
  close(avg7(nights, "hrvMs", day), 47);            // 45..49
  assert.equal(avg7(nights, "hrvMs", d("2026-10-22")), null);
  assert.deepEqual(sleepAverages(nights, day), { sleepMin: 460, restingHr: 55.5, hrvMs: 47 });
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
