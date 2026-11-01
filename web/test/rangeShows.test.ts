import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf, rangeShows } from "../src/domain/dates.ts";

// Wednesday 11 November 2026.
const today = epochOf(2026, 11, 11);

test("day: only that day", () => {
  assert.equal(rangeShows("day", today, today, true), true);
  assert.equal(rangeShows("day", today + 1, today, true), false);
});

test("3 days: from the anchor on, not before", () => {
  assert.equal(rangeShows("3day", today - 2, today, true), true);
  assert.equal(rangeShows("3day", today, today, true), true);
  assert.equal(rangeShows("3day", today - 3, today, true), false);
  assert.equal(rangeShows("3day", today + 1, today, true), false);
});

test("week: goes by the week's first day", () => {
  const monday = epochOf(2026, 11, 9), sunday = epochOf(2026, 11, 15);
  assert.equal(rangeShows("week", monday, today, true), true);
  assert.equal(rangeShows("week", sunday, today, true), true);
  assert.equal(rangeShows("week", sunday + 1, today, true), false);
  // With weeks from Sunday that same Sunday is the week after.
  assert.equal(rangeShows("week", sunday, today, false), false);
});

test("month and year: the same month, the same year, not the same number in another", () => {
  assert.equal(rangeShows("month", epochOf(2026, 11, 30), today, true), true);
  assert.equal(rangeShows("month", epochOf(2026, 10, 11), today, true), false);
  assert.equal(rangeShows("month", epochOf(2025, 11, 11), today, true), false);
  assert.equal(rangeShows("year", epochOf(2026, 1, 1), today, true), true);
  assert.equal(rangeShows("year", epochOf(2027, 11, 11), today, true), false);
});

test("agenda: it lists from its day on, so only that day is today's", () => {
  assert.equal(rangeShows("agenda", today, today, true), true);
  assert.equal(rangeShows("agenda", today - 7, today, true), false);
});
