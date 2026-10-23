import assert from "node:assert/strict";
import { test } from "node:test";
import { type Item, newItem } from "../src/domain/types.ts";
import { isRoutineItem, isRoutineSeries, routineList, routinesOnDay, routineSeriesOf, withoutRoutines } from "../src/domain/routines.ts";
import { tasksForDay } from "../src/domain/schedule.ts";

// The store saves to localStorage and schedules a redraw; small stand-ins are enough here.
const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => { kept.set(k, v); },
  removeItem: (k: string) => { kept.delete(k); },
};
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");

const day = 20010;
const routine = (id: number, extra: Partial<Item> = {}) =>
  newItem({ id, type: "TASK", title: "Stretch", startDay: 20000, startMin: 480, freq: "DAILY", routine: true, ...extra });

test("one day of a routine changed on its own stays that routine's day, with no duplicate", () => {
  const series = routine(41);
  store.saveItem(series);
  store.toggleCompletion(41, day, true); // already ticked that day
  const copyId = store.saveSeriesEdit("THIS", series, day, { ...series, startMin: 540 });
  const s = store.snapshot();
  const copy = s.byId.get(copyId)!;
  assert.equal(copy.routine, true);
  assert.equal(copy.freq, "NONE");
  assert.equal(isRoutineItem(copy), true);
  assert.equal(isRoutineSeries(copy), false);
  assert.equal(routineSeriesOf(copy, s.byId).id, 41);
  // On the day's checklist once, at the new time, still ticked; not among the tasks.
  const list = routinesOnDay(s.items, s.done, day, day);
  assert.deepEqual(list.map((e) => [e.item.id, e.item.startMin, e.status]), [[copyId, 540, "DONE"]]);
  assert.deepEqual(withoutRoutines(tasksForDay(s.items, s.done, day)).filter((e) => e.item.title === "Stretch"), []);
  // The list of all routines has the routine once.
  assert.deepEqual(routineList(s.items, s.done, day).filter((r) => r.item.title === "Stretch").map((r) => r.item.id), [41]);
});

test("a changed day of a plain repeating task stays a plain task, and turning the mark off is kept", () => {
  const plain = routine(42, { routine: false, title: "Water" });
  store.saveItem(plain);
  const a = store.saveSeriesEdit("THIS", plain, day, { ...plain, title: "Water plants" });
  assert.equal(isRoutineItem(store.snapshot().byId.get(a)!), false);
  const series = routine(43, { title: "Read" });
  store.saveItem(series);
  const b = store.saveSeriesEdit("THIS", series, day, { ...series, routine: false });
  assert.equal(isRoutineItem(store.snapshot().byId.get(b)!), false);
});

test("a one-off task without a series is never a routine", () => {
  assert.equal(isRoutineItem(routine(44, { freq: "NONE" })), false);
  assert.equal(isRoutineItem(routine(45, { freq: "NONE", parentId: 41 })), true);
});
