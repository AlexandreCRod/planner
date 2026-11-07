import assert from "node:assert/strict";
import { test } from "node:test";
import { clockTab, runningClocks, runningKey } from "../src/domain/clockRunning.ts";

// 336: the Clock tab shows the soonest running timer or stopwatch, with a count when several run.
const NOW = 1_000_000_000;
const sw = (o: Partial<{ id: number; name: string; startedAt: number | null; accumulatedMs: number }> = {}) =>
  ({ startedAt: null, accumulatedMs: 0, laps: [], ...o });
const timer = (id: number, leftMs: number | null, o: Partial<{ label: string; durationMs: number; remainingMs: number }> = {}) =>
  ({ id, durationMs: 15 * 60_000, label: "", endAt: leftMs === null ? null : NOW + leftMs, remainingMs: 60_000, ...o });

test("nothing running: the tab stays as it is", () => {
  assert.equal(clockTab(runningClocks({ timers: [timer(1, null)], stopwatch: sw({ accumulatedMs: 5000 }) }, NOW)), null);
});

test("one timer: its time left and a ring that empties as it runs", () => {
  const t = clockTab(runningClocks({ timers: [timer(1, 12 * 60_000 + 41_000)], stopwatch: sw() }, NOW))!;
  assert.equal(t.time, "12:41");
  assert.equal(t.count, 1);
  assert.ok(Math.abs(t.ring - (12 * 60 + 41) / (15 * 60)) < 1e-9);
  const later = clockTab(runningClocks({ timers: [timer(1, 60_000)], stopwatch: sw() }, NOW))!;
  assert.ok(later.ring < t.ring);
});

test("a part second left still shows that second (as the timer's own count does)", () => {
  assert.equal(clockTab(runningClocks({ timers: [timer(1, 59_500)], stopwatch: sw() }, NOW))!.time, "1:00");
});

test("the soonest timer comes first, whatever the order they were started in; paused ones don't count", () => {
  const list = runningClocks({ timers: [timer(1, 20 * 60_000, { label: "Pasta" }), timer(2, null), timer(3, 3 * 60_000, { label: " Tea " })], stopwatch: sw() }, NOW);
  assert.deepEqual(list.map((x) => x.name), ["Tea", "Pasta"]);
  assert.equal(clockTab(list)!.count, 2);
  assert.equal(clockTab(list)!.time, "3:00");
});

test("a timer without a name is called by its length", () => {
  assert.equal(runningClocks({ timers: [timer(1, 1000, { durationMs: 5 * 60_000 })], stopwatch: sw() }, NOW)[0].name, "5:00 timer");
});

test("a stopwatch shows its time so far, after any running timer, and its ring goes round once a minute", () => {
  const tools = { timers: [timer(1, 90_000)], stopwatch: sw({ startedAt: NOW - 75_000, accumulatedMs: 0 }), moreStopwatches: [sw({ id: 7, name: "Laps", startedAt: NOW - 1000 }), sw({ id: 8 })] };
  const list = runningClocks(tools, NOW);
  assert.deepEqual(list.map((x) => [x.kind, x.name, x.time]), [["timer", "15:00 timer", "1:30"], ["stopwatch", "Stopwatch", "1:15"], ["stopwatch", "Laps", "0:01"]]);
  assert.ok(Math.abs(list[1].ring - 0.25) < 1e-9);
  const only = clockTab(runningClocks({ ...tools, timers: [] }, NOW))!;
  assert.equal(only.first.kind, "stopwatch");
  assert.equal(only.time, "1:15");
});

// Review of 2.10.3, finding 4: the list's rows are keyed by their timer or stopwatch, so a row lit under a resting
// finger keeps its item when a sooner timer starts and the list re-sorts.
test("a running one keeps its key in the Clock tab's list when another comes before it; no two share one", () => {
  const before = runningClocks({ timers: [timer(1, 20 * 60_000, { label: "Pasta" })], stopwatch: sw({ id: 1, startedAt: NOW - 5000 }) }, NOW);
  const after = runningClocks({ timers: [timer(1, 20 * 60_000, { label: "Pasta" }), timer(2, 60_000, { label: "Tea" })], stopwatch: sw({ id: 1, startedAt: NOW - 5000 }) }, NOW);
  const pasta = (l: typeof before) => l.findIndex((r) => r.name === "Pasta");
  assert.notEqual(pasta(before), pasta(after)); // it moved down a row
  assert.equal(runningKey(before[pasta(before)]), runningKey(after[pasta(after)]));
  const keys = after.map(runningKey);
  assert.equal(new Set(keys).size, keys.length); // timer 1 and stopwatch 1 too
});
