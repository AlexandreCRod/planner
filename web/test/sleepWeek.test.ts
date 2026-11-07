// The Sleep page's week of nights (344 option B): which nights show, the naps beside them, the clock they sit on,
// and the averages under them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dayOf, isoOf } from "../src/domain/training.ts";
import type { HealthNight } from "../src/domain/health.ts";
import { clockFromNoon, fromNoon, mergedNights, nightPlace, weekAverages, weekClock, weekRows } from "../src/domain/sleep.ts";

const d = (iso: string) => dayOf(iso)!;
const watch = (iso: string, bed: string, wake: string, f: Partial<HealthNight> = {}): HealthNight => ({
  id: `hc:${iso}${bed}`, day: d(iso), bed, wake, totalMin: 420, awakeMin: 20, deepMin: 80, lightMin: 240, remMin: 100,
  stages: [], source: "com.garmin.android.apps.connectmobile", updatedAt: 1, ...f,
});
// Mornings Sat 31 Oct to Fri 6 Nov; Monday night (into Tue 3 Nov) has no record; a 35-min nap on Wed 4 Nov.
const hc = [
  watch("2026-10-31", "2026-10-30T23:30", "2026-10-31T07:00", { totalMin: 430, awakeMin: 20, deepMin: 90, lightMin: 230, remMin: 110 }),
  watch("2026-11-01", "2026-10-31T23:00", "2026-11-01T08:00"),
  watch("2026-11-02", "2026-11-01T22:40", "2026-11-02T06:40"),
  watch("2026-11-04", "2026-11-04T00:20", "2026-11-04T06:20", { totalMin: 338, deepMin: 60, lightMin: 190, remMin: 88 }),
  watch("2026-11-04", "2026-11-04T14:10", "2026-11-04T14:47", { totalMin: 35, deepMin: 0, lightMin: 30, remMin: 5, awakeMin: 2 }),
  watch("2026-11-05", "2026-11-04T23:00", "2026-11-05T07:00", { deepMin: null, lightMin: null, remMin: null, awakeMin: null, totalMin: 443 }),
  watch("2026-11-06", "2026-11-05T23:20", "2026-11-06T07:05", { totalMin: 438, awakeMin: 27, deepMin: 85, lightMin: 228, remMin: 125 }),
];
const nights = mergedNights([], hc, []);
const from = d("2026-10-31"), t = d("2026-11-06");

test("week: seven rows, a missing night stays a row with no record, and the nap sits beside its morning", () => {
  const rows = weekRows(nights, hc, from, t);
  assert.deepEqual(rows.map((r) => [isoOf(r.day), r.night?.totalMin ?? null, r.naps.map((n) => n.min), r.future]), [
    ["2026-10-31", 430, [], false],
    ["2026-11-01", 420, [], false],
    ["2026-11-02", 420, [], false],
    ["2026-11-03", null, [], false],
    ["2026-11-04", 338, [35], false],          // the nap is shown, and isn't the night
    ["2026-11-05", 443, [], false],
    ["2026-11-06", 438, [], false],
  ]);
});

test("week: the average is over the nights with a record (6 of 7), and the nap never counts", () => {
  const a = weekAverages(weekRows(nights, hc, from, t));
  assert.equal(a.nights, 6);
  assert.equal(a.of, 7);
  assert.equal(a.asleep, (430 + 420 + 420 + 338 + 443 + 438) / 6);
  // The totals-only night has no stages: the stage averages are over the other five, and say so.
  assert.equal(a.stageNights, 5);
  assert.equal(a.stages!.deep, (90 + 80 + 80 + 60 + 85) / 5);
});

test("week: the stage averages add up to the asleep average when every night has its stages", () => {
  const withStages = hc.filter((n) => n.day !== d("2026-11-05"));
  const a = weekAverages(weekRows(mergedNights([], withStages, []), withStages, from, t));
  assert.equal(a.nights, 5);
  assert.ok(Math.abs(a.stages!.deep + a.stages!.light + a.stages!.rem - a.asleep!) < 1e-9);
});

test("week: average bed and wake times read across midnight", () => {
  // Beds 23:30, 23:00, 22:40, 00:20, 23:00, 23:20: the average is 23:18, not the middle of the day.
  const a = weekAverages(weekRows(nights, hc, from, t));
  assert.equal(clockFromNoon(a.bed!), "23:18");
  assert.equal(clockFromNoon(a.wake!), "07:01");
});

test("this week: Monday to Sunday, the nights after today still to come and not in the count", () => {
  const monday = d("2026-11-02"); // the morning of Monday 2 Nov
  const rows = weekRows(nights, hc, monday, t);
  assert.deepEqual(rows.map((r) => r.future), [false, false, false, false, false, true, true]);
  const a = weekAverages(rows);
  assert.equal(a.of, 5);
  assert.equal(a.nights, 4);                 // Monday night has no record
});

test("week clock: 22:00 to 09:00, widened to whole hours for a late night", () => {
  assert.deepEqual(weekClock(weekRows(nights, hc, from, t)), [600, 1260]);
  const late = [watch("2026-11-07", "2026-11-06T21:10", "2026-11-07T10:20")];
  assert.deepEqual(weekClock(weekRows(mergedNights([], late, []), late, d("2026-11-01"), d("2026-11-07"))), [540, 1380]);
});

test("a night's place on the clock: from noon, and a long night runs past the next midnight", () => {
  assert.equal(fromNoon("2026-11-01T23:45"), 705);
  assert.equal(fromNoon("2026-11-02T00:15"), 735);
  assert.deepEqual(nightPlace({ bed: "2026-11-01T23:45", wake: "2026-11-02T07:15" }), { bed: 705, wake: 1155 });
  assert.equal(nightPlace({ bed: null, wake: "2026-11-02T07:15" }), null);
  assert.equal(clockFromNoon(1155), "07:15");
});
