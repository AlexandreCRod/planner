import assert from "node:assert/strict";
import { test } from "node:test";
import { type Completion, type Item, NO_DAY, newItem } from "../src/domain/types.ts";
import { buildMirror } from "../src/domain/alarms.ts";
import { tasksForDay } from "../src/domain/schedule.ts";
import { dayBit, movedRule, occurrences } from "../src/domain/recurrence.ts";
import { epochOf, weekday } from "../src/domain/dates.ts";

// The store saves to localStorage and schedules a redraw; small stand-ins are enough here.
const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => { kept.set(k, v); },
  removeItem: (k: string) => { kept.delete(k); },
};
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");

/** Mondays from here on: 2026-11-02 is a Monday. */
const MON = epochOf(2026, 11, 2);
const add = (extra: Partial<Item>) => {
  const id = store.saveItem(newItem({ type: "EVENT", title: "Class", startDay: MON, startMin: 600, endMin: 660, freq: "WEEKLY", ...extra }));
  return store.snapshot().byId.get(id)!;
};
/** A drag of [series]' occurrence [day] to [to]: what the calendar hands to the Move dialog. */
const drop = (series: Item, day: number, to: number, extra: Partial<Item> = {}) => ({ ...series, startDay: to, endDay: to, ...extra });
/** Every day it now shows on, across what's live with this title. */
const shownDays = (title: string, from: number, to: number) => {
  const days: number[] = [];
  for (const i of store.snapshot().items) if (i.title === title && i.deletedAt === null) days.push(...occurrences(i, from, to));
  return days.sort((a, b) => a - b);
};

test("this and following lands on the drop day, and the later weeks follow it", () => {
  const s = add({ title: "Following" });
  const third = MON + 14, tue = third + 1;
  store.moveSeries("FOLLOWING", s, third, drop(s, third, tue));
  assert.deepEqual(shownDays("Following", MON, MON + 34), [MON, MON + 7, tue, tue + 7, tue + 14]);
});

test("this and following from a Mon+Wed series moves both days of each later week", () => {
  const s = add({ title: "Twice", weekDays: dayBit(1) | dayBit(3) });
  const third = MON + 7; // the second Monday
  store.moveSeries("FOLLOWING", s, third, drop(s, third, third + 1));
  assert.deepEqual(shownDays("Twice", MON, MON + 16), [MON, MON + 2, MON + 8, MON + 10, MON + 15]);
});

test("a time-only drag with this and following keeps the day and takes the new time", () => {
  const s = add({ title: "Later" });
  const third = MON + 14;
  store.moveSeries("FOLLOWING", s, third, drop(s, third, third, { startMin: 720, endMin: 780 }));
  assert.deepEqual(shownDays("Later", MON, MON + 21), [MON, MON + 7, MON + 14, MON + 21]);
  const part = store.snapshot().items.find((i) => i.title === "Later" && i.startDay === third)!;
  assert.deepEqual([part.startMin, part.endMin], [720, 780]);
});

test("this occurrence only can land on the series' first day", () => {
  const s = add({ title: "OnFirst", freq: "DAILY" });
  const copy = store.moveSeries("THIS", s, MON + 3, drop(s, MON + 3, MON));
  assert.equal(store.snapshot().byId.get(copy)!.startDay, MON);
  assert.deepEqual(shownDays("OnFirst", MON, MON + 4), [MON, MON, MON + 1, MON + 2, MON + 4]);
});

test("an edit that changes no date still keeps the occurrence's own day", () => {
  const s = add({ title: "Edited" });
  const copy = store.saveSeriesEdit("THIS", s, MON + 7, { ...s, title: "Edited one" });
  assert.equal(store.snapshot().byId.get(copy)!.startDay, MON + 7);
});

test("all occurrences of a Mon+Wed series dragged a day move to Tue+Thu and lose no day", () => {
  const s = add({ title: "AllOf", weekDays: dayBit(1) | dayBit(3) });
  store.moveSeries("ALL", s, MON + 7, drop(s, MON + 7, MON + 8));
  assert.deepEqual(shownDays("AllOf", MON, MON + 10), [MON + 1, MON + 3, MON + 8, MON + 10]);
  assert.equal(weekday(MON + 1), 2);
});

test("all occurrences keeps skipped days skipped, and the end moves along", () => {
  const s = add({ title: "Gaps", excludedDays: String(MON + 7), untilDay: MON + 14 });
  store.moveSeries("ALL", s, MON, drop(s, MON, MON + 1));
  assert.deepEqual(shownDays("Gaps", MON, MON + 30), [MON + 1, MON + 15]);
});

test("a Sunday dragged to Monday wraps the weekday round", () => {
  assert.equal(movedRule(newItem({ weekDays: dayBit(7) }), MON + 6, MON + 7).weekDays, dayBit(1));
  assert.equal(movedRule(newItem({ weekDays: dayBit(1) }), MON + 7, MON + 6).weekDays, dayBit(7));
});

test("a monthly series on a chosen day follows the drag, into another month too", () => {
  const fifteenth = epochOf(2026, 11, 15);
  const s = add({ title: "Monthly", freq: "MONTHLY", monthDays: "15", startDay: fifteenth });
  store.moveSeries("ALL", s, fifteenth, drop(s, fifteenth, epochOf(2026, 12, 3)));
  assert.deepEqual(shownDays("Monthly", fifteenth, epochOf(2027, 1, 31)), [epochOf(2026, 12, 3), epochOf(2027, 1, 3)]);
});

test("a yearly series on a chosen month follows the drag to another month", () => {
  const nov = epochOf(2026, 11, 15), jan = epochOf(2027, 1, 15);
  const s = add({ title: "Yearly", freq: "YEARLY", months: 1 << 10, startDay: nov });
  store.moveSeries("ALL", s, nov, drop(s, nov, jan));
  assert.deepEqual(shownDays("Yearly", nov, epochOf(2028, 12, 31)), [jan, epochOf(2028, 1, 15)]);
});

/** The engine's view of [id]: which days it counts as done, so which it won't ring. */
const engineDone = (id: number) => {
  const s = store.snapshot();
  const settings = { defaultTaskTime: 540, defaultAlarmSound: null, defaultAlarmSoundName: "Bell", snoozeMinutes: 10, upcomingAlarms: true, quietHoursEnabled: false, quietStart: 1320, quietEnd: 420 };
  return buildMirror(s.allItems, s.reminders, s.completions, settings, "24", "dmy", "#00796B").completions.filter((c) => c.itemId === id).map((c) => c.day);
};
const task = (title: string, startDay: number | null) => {
  const r = { id: 0, itemId: 0, offsetMin: 30, type: "ALARM" as const, soundUri: null };
  const id = store.saveItem(newItem({ type: "TASK", title, startDay, startMin: 600 }), { reminders: [r] });
  return store.snapshot().byId.get(id)!;
};

test("a ticked task dragged to another day stays ticked there, and the engine won't ring it", () => {
  const t = task("Ticked", MON);
  store.toggleCompletion(t.id, MON, true);
  const when = store.listOf<Completion>("completions").find((c) => c.itemId === t.id)!.completedAt;
  store.saveItem({ ...t, startDay: MON + 3 });
  const s = store.snapshot();
  assert.deepEqual(tasksForDay(s.items, s.done, MON + 3, MON + 3).filter((e) => e.item.id === t.id).map((e) => e.status), ["DONE"]);
  assert.deepEqual(engineDone(t.id), [MON + 3]);
  // When it was really done doesn't change: the two days until it goes to the trash still count from then.
  assert.equal(store.listOf<Completion>("completions").find((c) => c.itemId === t.id)!.completedAt, when);
});

test("a task that wasn't ticked stays unticked when it moves, and a tick left on another day isn't touched", () => {
  const t = task("Open", MON);
  store.toggleCompletion(t.id, MON + 9, true);
  store.saveItem({ ...t, startDay: MON + 3 });
  assert.deepEqual(engineDone(t.id), [MON + 9]);
});

test("a ticked to-do given a date stays ticked, and one whose date is cleared too", () => {
  const t = task("No date", null);
  store.toggleCompletion(t.id, NO_DAY, true);
  store.saveItem({ ...t, startDay: MON });
  assert.deepEqual(engineDone(t.id), [MON]);
  store.saveItem({ ...store.snapshot().byId.get(t.id)!, startDay: null });
  assert.deepEqual(engineDone(t.id), [NO_DAY]);
});

test("changing a ticked task's time keeps the tick, and a repeating task's ticks stay on their days", () => {
  const t = task("Time", MON);
  store.toggleCompletion(t.id, MON, true);
  store.saveItem({ ...t, startMin: 700 });
  assert.deepEqual(engineDone(t.id), [MON]);
  const rid = store.saveItem(newItem({ type: "TASK", title: "Rep", startDay: MON, freq: "DAILY" }));
  const r = store.snapshot().byId.get(rid)!;
  store.toggleCompletion(r.id, MON + 1, true);
  store.saveItem({ ...r, startDay: MON + 1 });
  assert.deepEqual(store.listOf<Completion>("completions").filter((c) => c.itemId === r.id).map((c) => c.day), [MON + 1]);
});
