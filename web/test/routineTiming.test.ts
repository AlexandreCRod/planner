import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf } from "../src/domain/dates.ts";
import { doneTiming, localDayMinute, localMs, onTimeUntil, recentDays, routineStreak, timingOf } from "../src/domain/routines.ts";
import { CompletionIndex } from "../src/domain/schedule.ts";
import { newItem } from "../src/domain/types.ts";

// Item 221: a routine's day done on time, late or missed.

const today = epochOf(2026, 10, 30);
const base = { startDay: today - 20, freq: "DAILY" as const, routine: true };
const at = (day: number, h: number, m = 0) => localMs(day, h * 60 + m);

test("a timed routine with an end: on time until the end, late after it that day", () => {
  const gym = newItem({ id: 1, type: "EVENT", title: "Gym", ...base, startMin: 18 * 60, endMin: 19 * 60 });
  assert.equal(onTimeUntil(gym), 19 * 60);
  assert.equal(doneTiming(gym, today, today, 18 * 60 + 30), "ontime");
  assert.equal(doneTiming(gym, today, today, 19 * 60), "ontime");
  assert.equal(doneTiming(gym, today, today, 19 * 60 + 1), "late");
  // Done before its day (ticked ahead) is on time.
  assert.equal(doneTiming(gym, today, today - 1, 23 * 60), "ontime");
});

test("a timed routine without an end: on time within an hour of its start", () => {
  const pills = newItem({ id: 2, type: "TASK", title: "Pills", ...base, startMin: 8 * 60 });
  assert.equal(onTimeUntil(pills), 9 * 60);
  assert.equal(doneTiming(pills, today, today, 7 * 60), "ontime");
  assert.equal(doneTiming(pills, today, today, 9 * 60), "ontime");
  assert.equal(doneTiming(pills, today, today, 9 * 60 + 5), "late");
});

test("a routine ticked for a past day is late, timed or not", () => {
  const timed = newItem({ id: 3, type: "TASK", title: "Stretch", ...base, startMin: 7 * 60 });
  const untimed = newItem({ id: 4, type: "TASK", title: "Journal", ...base });
  assert.equal(doneTiming(timed, today - 1, today, 6 * 60), "late");
  assert.equal(doneTiming(untimed, today - 1, today, 0), "late");
  assert.equal(doneTiming(untimed, today, today, 23 * 60 + 59), "ontime");
  assert.equal(onTimeUntil(untimed), null);
});

test("an all-day routine counts as untimed; an event over days is due by its last day", () => {
  const allDay = newItem({ id: 5, type: "EVENT", title: "Trip", ...base, allDay: true, startMin: null });
  assert.equal(doneTiming(allDay, today, today, 23 * 60), "ontime");
  const twoDays = newItem({ id: 6, type: "EVENT", title: "Camp", ...base, endDay: base.startDay + 1, startMin: 10 * 60, endMin: 12 * 60 });
  assert.equal(doneTiming(twoDays, today, today + 1, 11 * 60), "ontime");
  assert.equal(doneTiming(twoDays, today, today + 1, 13 * 60), "late");
});

test("local day and minute round trip", () => {
  for (const [d, m] of [[today, 0], [today, 7 * 60 + 42], [today - 400, 23 * 60 + 59]]) {
    assert.deepEqual(localDayMinute(localMs(d, m)), { day: d, min: m });
  }
});

test("the last days show on time, late and missed; late keeps the streak, missed ends it", () => {
  const r = newItem({ id: 7, type: "TASK", title: "Walk", ...base, startMin: 8 * 60 });
  const done = new CompletionIndex([
    { itemId: 7, day: today - 4, completedAt: at(today - 4, 8) },
    // today - 3 missed
    { itemId: 7, day: today - 2, completedAt: at(today - 2, 12) },     // late, same day
    { itemId: 7, day: today - 1, completedAt: at(today, 7) },          // ticked the next day: late
  ]);
  assert.deepEqual(recentDays(r, done, today, 5), ["done", "missed", "late", "late", "open"]);
  assert.equal(timingOf(r, done, today - 4), "ontime");
  assert.equal(timingOf(r, done, today - 3), undefined);
  assert.equal(routineStreak(r, done, today).current, 2);
});
