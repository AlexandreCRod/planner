import assert from "node:assert/strict";
import { test } from "node:test";
import { rangeRole, slideRange, tapRange } from "../src/ui/phone/range.ts";

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
