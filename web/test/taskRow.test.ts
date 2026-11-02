import assert from "node:assert/strict";
import { test } from "node:test";
import { dayPill, epochOf, toTimestamp } from "../src/domain/dates.ts";
import type { TaskEntry } from "../src/domain/schedule.ts";
import { taskPill } from "../src/domain/taskRow.ts";
import { type Item, newItem } from "../src/domain/types.ts";

// 2026-11-02 is a Monday.
const t = epochOf(2026, 11, 2);
const task = (day: number | null, startMin: number | null = null, extra: Partial<Item> = {}) =>
  newItem({ id: 1, type: "TASK", title: "T", startDay: day, startMin, ...extra });
const entry = (item: Item, status: TaskEntry["status"], day: number | null = item.startDay, missed = 0): TaskEntry => ({ item, day, status, missed });
const at = (day: number, h: number, m = 0) => toTimestamp(day, h * 60 + m);

test("a pill's day: today, tomorrow, the weekday within the week, the date further off (226)", () => {
  assert.equal(dayPill(t, t), "Today");
  assert.equal(dayPill(t + 1, t), "Tomorrow");
  assert.equal(dayPill(t - 1, t), "Yesterday");
  assert.equal(dayPill(t + 3, t), "Thu");
  assert.equal(dayPill(t + 6, t), "Sun");
  assert.equal(dayPill(t + 7, t), "Mon, 9 Nov");
});

test("one status pill: overdue in red, a countdown for a timed task today, the day for later ones (226)", () => {
  const now = at(t, 9);
  assert.deepEqual(taskPill(entry(task(t - 2), "OVERDUE"), now, true, false, t), { text: "Overdue", danger: true });
  assert.deepEqual(taskPill(entry(task(t - 3), "OVERDUE", t - 3, 3), now, true, false, t), { text: "3 missed", danger: true });
  assert.deepEqual(taskPill(entry(task(t, 11 * 60), "DUE"), now, false, false, t), { text: "in 2h 0m", danger: false });
  assert.deepEqual(taskPill(entry(task(t, 8 * 60), "DUE"), now, false, false, t), { text: "1h 0m overdue", danger: true });
  assert.deepEqual(taskPill(entry(task(t + 1), "UPCOMING"), now, true, false, t), { text: "Tomorrow", danger: false });
  assert.deepEqual(taskPill(entry(task(t + 3, 10 * 60), "UPCOMING"), now, true, false, t), { text: "Thu", danger: false });
});

test("no pill where the place already says it: a day's own list, under Overdue, ticked, or a to-do (226, 225)", () => {
  const now = at(t, 9);
  // Today's list: an untimed task due today needs no "Today"; Tasks (several days) says it.
  assert.equal(taskPill(entry(task(t), "DUE"), now, false, false, t), null);
  assert.deepEqual(taskPill(entry(task(t), "DUE"), now, true, false, t), { text: "Today", danger: false });
  assert.equal(taskPill(entry(task(t - 2), "OVERDUE"), now, true, true, t), null);
  assert.equal(taskPill(entry(task(t, 11 * 60), "DONE"), now, true, false, t), null);
  assert.equal(taskPill(entry(task(null), "ANYTIME", null), now, true, false, t), null);
});
