import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf, ymd } from "../src/domain/dates.ts";
import { untilPickerDay } from "../src/domain/recurrence.ts";

// 377: a repeat's end-date picker opened on February 2027 (three months after a November start).
test("with no end date, the end-date picker opens on this month", () => {
  const today = epochOf(2026, 11, 7);
  const opens = ymd(untilPickerDay(null, epochOf(2026, 11, 2), today));
  assert.deepEqual([opens.y, opens.m], [2026, 11]);
});

test("a chosen end date opens on its own month; a later start opens on the start's month", () => {
  const today = epochOf(2026, 11, 7);
  assert.equal(untilPickerDay(epochOf(2027, 3, 1), epochOf(2026, 11, 2), today), epochOf(2027, 3, 1));
  assert.equal(untilPickerDay(null, epochOf(2027, 1, 10), today), epochOf(2027, 1, 10));
});
