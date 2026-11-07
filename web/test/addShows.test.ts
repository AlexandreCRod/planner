import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf } from "../src/domain/dates.ts";
import { anchorToShow } from "../src/ui/phone/calendarTop.ts";

// 372: after adding a task or event on a date not on screen, the Calendar shows that week, day or month.
const sat7 = epochOf(2026, 11, 7);
test("Week view moves to the added day's week, and stays when it's this week", () => {
  const nextFri = epochOf(2026, 11, 20);
  assert.equal(anchorToShow("week", sat7, nextFri, true), nextFri);
  assert.equal(anchorToShow("week", sat7, epochOf(2026, 11, 3), true), null);
});

test("Day and 3-day go to that day; Month to its month; Agenda only when it's earlier", () => {
  assert.equal(anchorToShow("day", sat7, sat7 + 1, true), sat7 + 1);
  assert.equal(anchorToShow("3day", sat7, sat7 + 2, true), null);
  assert.equal(anchorToShow("3day", sat7, sat7 + 3, true), sat7 + 3);
  assert.equal(anchorToShow("month", sat7, epochOf(2026, 11, 28), true), null);
  assert.equal(anchorToShow("month", sat7, epochOf(2027, 1, 5), true), epochOf(2027, 1, 5));
  assert.equal(anchorToShow("agenda", sat7, sat7 + 40, true), null);
  assert.equal(anchorToShow("agenda", sat7, sat7 - 2, true), sat7 - 2);
});
