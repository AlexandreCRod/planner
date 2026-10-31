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

test("wake-up alarms never ring after the event starts, whatever the window's controls are set to", async () => {
  const { fitWake, wakeOffsets, withWakePlan } = await import("../src/domain/reminders.ts");
  // The review's case: start 30 min before, every 60 min, the 2 alarms the stepper can't go below.
  assert.deepEqual(wakeOffsets({ before: 30, every: 60, count: 2 }), [30, 0]);
  assert.deepEqual(wakeOffsets({ before: 15, every: 60, count: 2 }), [15, 0]);
  assert.deepEqual(withWakePlan([], { before: 30, every: 60, count: 2 }).map((r) => r.offsetMin), [30, 0]);
  // Every setting the steppers reach: Start 15 min to 12 h, Every 1 to 60, 2 to 12 alarms.
  for (let before = 15; before <= 720; before += 15) for (let every = 1; every <= 60; every++) for (let count = 2; count <= 12; count++) {
    const plan = fitWake({ before, every, count });
    const list = wakeOffsets(plan);
    assert.ok(plan.every <= before && plan.count >= 2, `${before}/${every}/${count}`);
    assert.equal(list.length, plan.count, `${before}/${every}/${count}: as many alarms as it says`);
    assert.ok(list.every((o) => o >= 0), `${before}/${every}/${count} rings after the start: ${list}`);
  }
  // A plan that fits stays as it was.
  assert.deepEqual(fitWake({ before: 120, every: 10, count: 4 }), { before: 120, every: 10, count: 4 });
});

test("a wake-up alarm saved after the start doesn't reach the engine; other alarms after the start still do", async () => {
  const { buildMirror } = await import("../src/domain/alarms.ts");
  const item = newItem({ id: 1, type: "EVENT", title: "Flight", startDay: 20000, startMin: 600 });
  const r = (id: number, offsetMin: number, wake: boolean): Reminder => ({ id, itemId: 1, offsetMin, type: "ALARM", soundUri: null, wake });
  const settings = { defaultTaskTime: 540, defaultAlarmSound: null, defaultAlarmSoundName: "Bell", snoozeMinutes: 10, upcomingAlarms: true, quietHoursEnabled: false, quietStart: 1320, quietEnd: 420 };
  const m = buildMirror([item], new Map([[1, [r(1, 30, true), r(2, -30, true), r(3, -10, false)]]]), [], settings, "24", "dmy", "#00796B");
  assert.deepEqual(m.reminders.map((x) => x.id), [1, 3]);
});

test("wake-up alarms: the plan becomes one alarm per time, none after the event starts (245)", async () => {
  const { wakeOffsets, wakePlan, wakeText, withWakePlan, wakeMax } = await import("../src/domain/reminders.ts");
  assert.deepEqual(wakeOffsets({ before: 120, every: 10, count: 4 }), [120, 110, 100, 90]);
  assert.equal(wakeText({ before: 120, every: 10, count: 4 }), "start 2 h before, every 10 min, 4 alarms");
  assert.equal(wakeText({ before: 90, every: 60, count: 2 }), "start 1 h 30 min before, every 1 h, 2 alarms");
  assert.equal(wakeMax(30, 10), 4);
  assert.deepEqual(wakeOffsets({ before: 30, every: 10, count: 9 }), [30, 20, 10, 0]);

  const plain = { id: 5, itemId: 1, offsetMin: 30, type: "ALARM" as const, soundUri: null };
  const on = withWakePlan([plain], { before: 120, every: 10, count: 3 }).map((r, i) => ({ ...r, id: r.id || 10 + i }));
  assert.equal(on.filter((r) => r.wake).length, 3);
  assert.ok(on.filter((r) => r.wake).every((r) => r.type === "ALARM"));
  assert.deepEqual(wakePlan(on), { before: 120, every: 10, count: 3 });
  assert.equal(wakePlan([plain]), null);
  // Moved 10 min later: the two that stay at the same time keep their ids, the plain alarm stays, and removal leaves only it.
  const moved = withWakePlan(on, { before: 110, every: 10, count: 3 });
  assert.deepEqual(moved.filter((r) => r.wake).map((r) => [r.offsetMin, r.id]), [[110, 12], [100, 13], [90, 0]]);
  assert.deepEqual(moved[0], plain);
  assert.deepEqual(withWakePlan(on, null), [plain]);
});
