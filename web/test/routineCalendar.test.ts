import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf } from "../src/domain/dates.ts";
import { type RoutinesShown, calendarShows, routineInCalendar } from "../src/domain/routines.ts";
import { CompletionIndex, forCalendar } from "../src/domain/schedule.ts";
import { type Item, newItem } from "../src/domain/types.ts";

// 224: which routines the calendar draws where.
const day = epochOf(2026, 11, 2); // a Monday
const tese = newItem({ id: 1, type: "EVENT", title: "Tese", routine: true, freq: "DAILY", startDay: day - 10, endDay: day - 10, startMin: 630, endMin: 780 });
const stretch = newItem({ id: 2, type: "TASK", title: "Stretch", routine: true, freq: "DAILY", startDay: day - 10, startMin: 1260 });
const pills = newItem({ id: 3, type: "TASK", title: "Pills", routine: true, freq: "DAILY", startDay: day - 10 });
const gym = newItem({ id: 4, type: "EVENT", title: "Gym", routine: true, freq: "WEEKLY", weekDays: 1, startDay: day - 7, endDay: day - 7, startMin: 1080, endMin: 1140 });
const dentist = newItem({ id: 5, type: "EVENT", title: "Dentist", startDay: day, endDay: day, startMin: 600, endMin: 660 });
const plainDaily = newItem({ id: 6, type: "TASK", title: "Water plants", freq: "DAILY", startDay: day - 3 });
const all = [tese, stretch, pills, gym, dentist, plainDaily];

const titlesOn = (items: Item[], shown: RoutinesShown) =>
  forCalendar(items.filter((i) => calendarShows(i, shown)), new CompletionIndex([]), day, day, day, false).map((o) => o.item.title).sort();

test("by default a routine that reserves time shows in the grids, a quick habit doesn't", () => {
  assert.equal(routineInCalendar(tese), true);                                         // a start and an end
  assert.equal(routineInCalendar(gym), true);
  assert.equal(routineInCalendar(stretch), false);                                     // a task: a time but no end
  assert.equal(routineInCalendar(pills), false);                                       // no time at all
  assert.equal(routineInCalendar({ ...tese, allDay: true }), false);                    // all day reserves no hours
  assert.equal(routineInCalendar({ ...tese, startMin: null, endMin: null }), false);
});

test("the switch, once set, wins over the default either way", () => {
  assert.equal(routineInCalendar({ ...tese, inCalendar: false }), false);
  assert.equal(routineInCalendar({ ...stretch, inCalendar: true }), true);
  assert.equal(routineInCalendar({ ...pills, inCalendar: true }), true);
});

test("Week, 3-day and Day draw only the routines set to show; Month none; 'Show all routines' every one", () => {
  assert.deepEqual(titlesOn(all, "chosen"), ["Dentist", "Gym", "Tese", "Water plants"]);
  assert.deepEqual(titlesOn(all, "none"), ["Dentist", "Water plants"]);
  assert.deepEqual(titlesOn(all, "all"), ["Dentist", "Gym", "Pills", "Stretch", "Tese", "Water plants"]);
  // Turned on for a habit, turned off for Tese.
  const changed = all.map((i) => (i.id === 2 ? { ...i, inCalendar: true } : i.id === 1 ? { ...i, inCalendar: false } : i));
  assert.deepEqual(titlesOn(changed, "chosen"), ["Dentist", "Gym", "Stretch", "Water plants"]);
  assert.deepEqual(titlesOn(changed, "none"), ["Dentist", "Water plants"]);
});

test("the switch means nothing once an item isn't a routine: it's drawn like any other", () => {
  const unmarked = { ...pills, routine: false };
  assert.equal(calendarShows(unmarked, "none"), true);
  assert.equal(calendarShows({ ...tese, routine: false, inCalendar: false }, "chosen"), true);
});

test("an old record without the field gets the default; the field syncs as part of the item", () => {
  const old = JSON.parse(JSON.stringify(tese)) as Item;
  assert.equal("inCalendar" in old, false);
  assert.equal(calendarShows(old, "chosen"), true);
  const fromOtherDevice = JSON.parse(JSON.stringify({ ...tese, inCalendar: false })) as Item;
  assert.equal(calendarShows(fromOtherDevice, "chosen"), false);
});
