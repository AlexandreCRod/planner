import assert from "node:assert/strict";
import { test } from "node:test";
import { dayOf } from "../src/domain/training.ts";
import type { HealthDay } from "../src/domain/health.ts";
import { progressTabOf, avg7LineOf, avg7Of, bodySeries, fmtSteps, lastWeighInLine, shortWhen } from "../src/domain/body.ts";

const d = (iso: string) => dayOf(iso)!;

test("shortWhen: today, a weekday within six days, else the date", () => {
  const t = d("2026-10-29"); // a Thursday
  assert.equal(shortWhen(t, t), "today");
  assert.equal(shortWhen(d("2026-10-28"), t), "Wed");
  assert.equal(shortWhen(d("2026-10-23"), t), "Fri");
  assert.equal(shortWhen(d("2026-10-22"), t), "22 Oct");
  assert.equal(shortWhen(d("2025-12-30"), t), "30 Dec 2025");
});

test("lastWeighInLine (250)", () => {
  assert.equal(lastWeighInLine(82.44, d("2026-10-28"), d("2026-10-29")), "Last 82.4 kg · Wed");
  assert.equal(lastWeighInLine(82, d("2026-10-29"), d("2026-10-29")), "Last 82.0 kg · today");
});

const day = (iso: string, f: Partial<HealthDay> = {}): HealthDay => ({
  id: `hcd:${iso}`, day: d(iso), steps: null, distanceKm: null, kcalTotal: null, kcalActive: null, floors: null, ascentM: null, restingHr: null, hrvMs: null,
  spo2: null, respiration: null, hrMin: null, hrAvg: null, hrMax: null, vo2max: null, weighIns: [], extra: {}, updatedAt: 1, ...f,
});

test("bodySeries: each kind from its field, days with none left out", () => {
  const days = [day("2026-10-01", { steps: 5000, vo2max: 47.5 }), day("2026-10-02", { steps: 7000 }), day("2026-10-03")];
  assert.deepEqual(bodySeries("steps", days).map((p) => p.v), [5000, 7000]);
  assert.deepEqual(bodySeries("vo2", days), [{ day: d("2026-10-01"), v: 47.5 }]);
  assert.deepEqual(bodySeries("fat", days), []);
});

test("bodySeries: body fat is a day's last weigh-in that has it", () => {
  const days = [day("2026-10-01", { weighIns: [{ time: "07:00", kg: 82, fatPct: 18.2, source: "x" }, { time: "20:00", kg: 83, fatPct: 18.6, source: "x" }, { time: "21:00", kg: 83, fatPct: null, source: "y" }] })];
  assert.deepEqual(bodySeries("fat", days).map((p) => p.v), [18.6]);
});

test("bodySeries: blood oxygen and breathing fall back to sleep.json, the watch wins on the same day", () => {
  const night = (iso: string, spo2: number | null, br: number | null) => ({
    id: iso, day: d(iso), bed: null, wake: null, totalMin: null, awakeMin: null, deepMin: null, lightMin: null, remMin: null, score: null, restingHr: null, hrvMs: null,
    avgSpo2: spo2, avgRespiration: br,
  });
  const nights = [night("2026-10-01", 95, 14), night("2026-10-02", 96, null)];
  const days = [day("2026-10-02", { spo2: 94.5 })];
  assert.deepEqual(bodySeries("spo2", days, nights), [{ day: d("2026-10-01"), v: 95, fromSleepJson: true }, { day: d("2026-10-02"), v: 94.5 }]);
  assert.deepEqual(bodySeries("breath", days, nights), [{ day: d("2026-10-01"), v: 14, fromSleepJson: true }]);
  assert.deepEqual(bodySeries("vo2", days, nights), []);
});

test("avg7Of: the days with a reading in the 7 to the day", () => {
  const pts = [{ day: 1, v: 10 }, { day: 5, v: 20 }, { day: 8, v: 30 }, { day: 20, v: 5 }];
  assert.equal(avg7Of(pts, 8), 25); // days 2..8
  assert.equal(avg7Of(pts, 7), 15); // days 1..7
  assert.equal(avg7Of(pts, 15), null);
  assert.deepEqual(avg7LineOf(pts).map((p) => p.v), [10, 15, 25, 5]);
});

test("fmtSteps", () => {
  assert.equal(fmtSteps(8412.4), "8,412");
  assert.equal(fmtSteps(12345678), "12,345,678");
  assert.equal(fmtSteps(950), "950");
});

test("progressTabOf: the old Weight and Sleep tabs open Body (251)", () => {
  assert.equal(progressTabOf("weight"), "body");
  assert.equal(progressTabOf("sleep"), "body");
  assert.equal(progressTabOf("body"), "body");
  assert.equal(progressTabOf("runs"), "runs");
  assert.equal(progressTabOf(null), "lifts");
  assert.equal(progressTabOf("nonsense"), "lifts");
});
