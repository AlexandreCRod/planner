import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf } from "../src/domain/dates.ts";
import { newItem } from "../src/domain/types.ts";
import { noFilter } from "../src/ui/phone/calFilter.ts";
import { addedShows, anchorToShow } from "../src/ui/phone/calendarTop.ts";

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

// Review of 2.10.4, finding 4: the Calendar doesn't jump for something it wouldn't show anyway.
test("an added item the filter hides, or a routine Month leaves out, doesn't move the Calendar", () => {
  const work = newItem({ type: "EVENT", title: "Standup", startDay: sat7 + 30, categoryId: 4 });
  assert.equal(addedShows("week", work, noFilter(), false), true);
  assert.equal(addedShows("week", work, { ...noFilter(), hidden: new Set([4]) }, false), false);
  assert.equal(addedShows("month", newItem({ type: "TASK", title: "Pay rent", startDay: sat7 + 30 }), { ...noFilter(), tasks: false }, false), false);
  const routine = newItem({ type: "TASK", title: "Stretch", startDay: sat7 + 30, freq: "DAILY", routine: true });
  assert.equal(addedShows("month", routine, noFilter(), false), false);
  assert.equal(addedShows("year", routine, noFilter(), false), false);
  assert.equal(addedShows("month", routine, noFilter(), true), true, "Show all routines brings them back");
  assert.equal(addedShows("week", routine, noFilter(), false), false, "a quick habit is off the grids by default");
  assert.equal(addedShows("week", { ...routine, inCalendar: true }, noFilter(), false), true);
});
