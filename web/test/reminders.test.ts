import assert from "node:assert/strict";
import { test } from "node:test";
import { firstReminders, followDefaults, isDefaultReminders, reminderKind } from "../src/domain/reminders.ts";
import { type Reminder, newItem } from "../src/domain/types.ts";

const r = (type: Reminder["type"], offsetMin = 0): Reminder => ({ id: 1, itemId: 1, offsetMin, type, soundUri: null });

test("new timed tasks and events start with a reminder 30 minutes before; untimed ones at the day's time", () => {
  const timedEvent = newItem({ type: "EVENT", startDay: 100, startMin: 600, endMin: 660 });
  const timedTask = newItem({ type: "TASK", startDay: 100, startMin: 1140 });
  const allDay = newItem({ type: "EVENT", startDay: 100, allDay: true });
  const untimedTask = newItem({ type: "TASK", startDay: 100 });
  const todo = newItem({ type: "TASK" });
  assert.deepEqual(firstReminders(timedEvent).map((x) => [x.offsetMin, x.type]), [[30, "REMINDER"]]);
  assert.deepEqual(firstReminders(timedTask).map((x) => [x.offsetMin, x.type]), [[30, "NOTIFICATION"]]);
  assert.deepEqual(firstReminders(allDay).map((x) => [x.offsetMin, x.type]), [[0, "REMINDER"]]);
  assert.deepEqual(firstReminders(untimedTask).map((x) => [x.offsetMin, x.type]), [[0, "NOTIFICATION"]]);
  assert.deepEqual(firstReminders(todo), []);
});

test("a new item's untouched reminders follow its time; changed ones stay", () => {
  const untimed = newItem({ type: "TASK", startDay: 100 });
  const timed = { ...untimed, startMin: 1140 };
  const start = firstReminders(untimed);
  assert.ok(isDefaultReminders(start, untimed));
  assert.deepEqual(followDefaults(start, untimed, timed).map((x) => x.offsetMin), [30]);
  // A to-do given a date gets its first reminder.
  const todo = newItem({ type: "TASK" });
  assert.deepEqual(followDefaults([], todo, untimed).map((x) => x.offsetMin), [0]);
  // Changed by hand: left alone.
  const own = [r("ALARM", 10)];
  assert.equal(followDefaults(own, untimed, timed), own);
  // Nothing about the time changed: the same list.
  assert.equal(followDefaults(start, untimed, { ...untimed, title: "x" }), start);
});

test("a row shows the strongest kind of reminder it has", () => {
  assert.equal(reminderKind(undefined), null);
  assert.equal(reminderKind([]), null);
  assert.equal(reminderKind([r("NOTIFICATION")]), "NOTIFICATION");
  assert.equal(reminderKind([r("NOTIFICATION"), r("REMINDER")]), "REMINDER");
  assert.equal(reminderKind([r("REMINDER"), r("ALARM")]), "ALARM");
});
