import assert from "node:assert/strict";
import { test } from "node:test";
import { type Entry, entryId, newEntry, phaseView, readPlan } from "../src/domain/training.ts";
import type { Run } from "../src/domain/trends.ts";
import { fmtKm, plannedKm, runLine, runOf, summaryKm, weekBar } from "../src/domain/trainingWeek.ts";

// A made-up week, Mon 1 – Sun 7 Mar 2027.
const plan = readPlan({
  version: 1, plan: { id: "p", start: "2027-03-01", end: "2027-03-07" }, exercises: [],
  phases: [{
    name: "Week 1", start: "2027-03-01", end: "2027-03-07", summary: "~22–26 km", sessions: [
      { id: "e1", title: "Easy run", detail: "40'", kind: "run", default_date: "2027-03-01" },
      { id: "q1", title: "Intervals", detail: "3×2 km", kind: "run", default_date: "2027-03-02" },
      { id: "g1", title: "Gym A", detail: "Legs + pull", kind: "gym", default_date: "2027-03-03" },
      { id: "b1", title: "Easy bike", detail: "20–30'", kind: "bike", default_date: "2027-03-04" },
      { id: "l1", title: "Long run", detail: "11 km: 9 easy + last 2 @ HMP", kind: "run", default_date: "2027-03-07" },
      { id: "x1", title: "Spare run", detail: "5 km", kind: "run" },
    ],
  }],
}).plan!;
const MON = plan.start;
const s = (sid: string, more: Partial<Entry>) => newEntry({ id: entryId("p", sid), planId: "p", sessionId: sid, kind: "session", ...more });
const done = (sid: string, day: number) => s(sid, { day, status: "done", doneDay: day });
const run = (sessionId: string | null, km: number | null, id = `r-${sessionId}`): Run => ({
  id, day: MON, time: null, title: "Run", sessionId, type: "easy", distanceKm: km, durationS: null, paceSPerKm: null,
  avgHr: null, maxHr: null, cadenceSpm: null, ascentM: null,
});
const barOf = (es: Entry[], runs: Run[] = []) => {
  const m = new Map(es.map((e) => [e.id, e]));
  return weekBar(phaseView(plan, 0, m, m.values()).days, runs);
};

test("the week bar: a segment per placed session and futsal game, in the page's order, skipped ones left out", () => {
  const futsal = newEntry({ id: "f1", planId: "p", kind: "futsal", day: MON + 3, status: "done", doneDay: MON + 3 });
  const b = barOf([done("g1", MON + 2), s("q1", { status: "skipped" }), futsal]);
  assert.deepEqual(b.segments, [
    { kind: "run", done: false }, { kind: "gym", done: true }, { kind: null, done: false }, { kind: "futsal", done: true }, { kind: "run", done: false },
  ]);
  assert.equal(b.done, 2);
  assert.equal(b.km, 0);
});

test("the week bar's km: the matched run's distance, else the km the plan text starts with", () => {
  // e1 matched (6.3 km); l1 unmatched, its plan says 11 km; q1's "3×2 km" is no distance.
  const b = barOf([done("e1", MON), done("q1", MON + 1), done("l1", MON + 6)], [run("e1", 6.3), run(null, 9)]);
  assert.equal(b.done, 3);
  assert.equal(fmtKm(b.km), "17.3");
  // A matched run with no distance falls back to the plan; a gym session never counts.
  assert.equal(barOf([done("l1", MON + 6), done("g1", MON + 2)], [run("l1", null)]).km, 11);
  // Not done: nothing yet. Unplaced sessions aren't in the bar.
  assert.equal(barOf([s("l1", { day: MON + 6 })]).km, 0);
  assert.equal(barOf([]).segments.length, 5);
});

test("planned km, the matched run, the summary's km and km as text", () => {
  assert.equal(plannedKm("10 km easy"), 10);
  assert.equal(plannedKm("12.5km tempo"), 12.5);
  assert.equal(plannedKm("3×2 km"), null);
  assert.equal(plannedKm("40'"), null);
  assert.equal(plannedKm(""), null);
  assert.equal(runOf([run("a", 5, "1"), run("b", 6, "2"), run("a", 7, "3")], "a")?.id, "3");
  assert.equal(runOf([run("a", 5)], "z"), null);
  assert.equal(summaryKm("~22–26 km"), "~22–26 km");
  assert.equal(summaryKm("~23 km"), "~23 km");
  assert.equal(summaryKm("About −30%"), null);
  assert.equal(summaryKm("Restart weekend"), null);
  assert.deepEqual([fmtKm(0), fmtKm(8.44), fmtKm(13), fmtKm(12.96)], ["0", "8.4", "13", "13"]);
});

test("a done run's line: distance, pace and heart rate, leaving out what's missing", () => {
  const r = (more: Partial<Run>): Run => ({ ...run("e1", null), ...more });
  assert.equal(runLine(r({ distanceKm: 8.43, paceSPerKm: 302, avgHr: 158 })), "8.4 km · 5:02 /km · 158 bpm");
  // No pace of its own: time over distance (2526 s over 8.4 km is 300.7 s/km).
  assert.equal(runLine(r({ distanceKm: 8.4, durationS: 2526 })), "8.4 km · 5:01 /km");
  // 359.6 s rounds up to 6:00, never 5:60.
  assert.equal(runLine(r({ paceSPerKm: 359.6, avgHr: 141.4 })), "6:00 /km · 141 bpm");
  assert.equal(runLine(r({ avgHr: 150 })), "150 bpm");
  assert.equal(runLine(r({})), "");
});
