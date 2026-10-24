import assert from "node:assert/strict";
import { test } from "node:test";
import { rangeRole, slideRange, tapRange, RANGE_TICK_GAP_MS, slideTicks } from "../src/ui/phone/range.ts";

test("tap the start, then the end", () => {
  let r = tapRange({ start: 5, end: 5, next: "start" }, 10);
  assert.deepEqual(r, { start: 10, end: 10, next: "end" });
  r = tapRange(r, 14);
  assert.deepEqual(r, { start: 10, end: 14, next: "start" });
  // A third tap starts a new range.
  assert.deepEqual(tapRange(r, 20), { start: 20, end: 20, next: "end" });
  // An end tapped before the start starts the range again there.
  assert.deepEqual(tapRange({ start: 10, end: 10, next: "end" }, 7), { start: 7, end: 7, next: "end" });
  // Opened on the end date: one tap moves the end.
  assert.deepEqual(tapRange({ start: 10, end: 12, next: "end" }, 15), { start: 10, end: 15, next: "start" });
  // The same day twice: a one-day range.
  assert.deepEqual(tapRange({ start: 10, end: 10, next: "end" }, 10), { start: 10, end: 10, next: "start" });
});

test("a slide covers the days between, either way", () => {
  assert.deepEqual(slideRange(10, 16), { start: 10, end: 16, next: "start" });
  assert.deepEqual(slideRange(10, 3), { start: 3, end: 10, next: "start" });
  assert.deepEqual(slideRange(10, 10), { start: 10, end: 10, next: "start" });
});

test("each day's place in the range", () => {
  const r = { start: 10, end: 13 };
  assert.deepEqual([9, 10, 11, 12, 13, 14].map((d) => rangeRole(r, d)), [null, "start", "inside", "inside", "end", null]);
  assert.equal(rangeRole({ start: 4, end: 4 }, 4), "single");
});

test("sliding across days ticks lightly and seldom", () => {
  // The same day: never.
  assert.equal(slideTicks(5, 5, 1000, -Infinity), false);
  // Another day, long after the last tick: a tick.
  assert.equal(slideTicks(5, 6, 1000, 0), true);
  // A quick slide crossing a day every 20 ms for 300 ms ticks only every RANGE_TICK_GAP_MS.
  let at = -Infinity, ticks = 0;
  for (let i = 1; i <= 15; i++) { const now = 1000 + i * 20; if (slideTicks(i - 1, i, now, at)) { at = now; ticks++; } }
  assert.ok(ticks <= Math.ceil(300 / RANGE_TICK_GAP_MS), String(ticks));
  assert.ok(RANGE_TICK_GAP_MS >= 100);
});
