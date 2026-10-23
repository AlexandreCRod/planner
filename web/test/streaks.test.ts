import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf } from "../src/domain/dates.ts";
import { recentDays, streakRows } from "../src/domain/routines.ts";
import { CompletionIndex } from "../src/domain/schedule.ts";
import { type Completion, type Item, newItem } from "../src/domain/types.ts";

// Item 136: the Streaks sheet lists every routine with its current and best streak and its last days.

const today = epochOf(2026, 10, 16);
const routine = (id: number, extra: Partial<Item> = {}) =>
  newItem({ id, type: "TASK", title: `R${id}`, startDay: today - 30, freq: "DAILY", routine: true, ...extra });
const ticks = (id: number, ...days: number[]): Completion[] => days.map((day) => ({ itemId: id, day, completedAt: 0 }));

test("the last days of a routine: done, missed, today still open, oldest first", () => {
  const r = routine(1);
  const done = new CompletionIndex(ticks(1, today - 1, today - 2, today - 4));
  const days = recentDays(r, done, today, 5);
  assert.deepEqual(days, ["done", "missed", "done", "done", "open"]);
  assert.deepEqual(recentDays(r, new CompletionIndex(ticks(1, today)), today, 2), ["missed", "done"]);
});

test("days that aren't the routine's, or before it started, are off", () => {
  const everyOther = routine(2, { startDay: today - 4, interval: 2 }); // today-4, today-2, today (today-5 is before it began)
  assert.deepEqual(recentDays(everyOther, new CompletionIndex(ticks(2, today - 2)), today, 6), ["off", "missed", "off", "done", "off", "open"]);
});

test("the Streaks sheet: every routine, tasks and events, with its streak and history", () => {
  const items = [
    routine(1, { startMin: 480 }),
    routine(2, { type: "EVENT", freq: "WEEKLY", byDay: "", startMin: 420 }),
    newItem({ id: 3, type: "TASK", title: "plain", startDay: today - 30, freq: "DAILY" }), // not a routine
    routine(4, { deletedAt: 1 }),                                                          // in the trash
  ];
  const done = new CompletionIndex([...ticks(1, today - 1, today - 2, today - 3, today - 5, today - 6, today - 7, today - 8)]);
  const rows = streakRows(items, done, today, 14);
  assert.deepEqual(rows.map((r) => r.item.id), [2, 1]); // by time, then title
  const r1 = rows.find((r) => r.item.id === 1)!;
  assert.equal(r1.streak.current, 3);
  assert.equal(r1.streak.best, 4);
  assert.equal(r1.days.length, 14);
  assert.equal(r1.days[13], "open");
  assert.equal(r1.days[12], "done");
  assert.equal(r1.days[9], "missed");
});
