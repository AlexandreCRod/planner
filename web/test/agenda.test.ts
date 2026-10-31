import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgenda } from "../src/domain/agenda.ts";
import { CompletionIndex } from "../src/domain/schedule.ts";
import { type Item, newItem } from "../src/domain/types.ts";

const T = 20_000;
const none = new CompletionIndex([]);
const ev = (id: number, title: string, startDay: number, startMin: number | null, more: Partial<Item> = {}) =>
  newItem({ type: "EVENT", id, title, startDay, endDay: startDay, startMin, endMin: startMin === null ? null : startMin + 30, allDay: startMin === null, ...more });
const task = (id: number, title: string, startDay: number, more: Partial<Item> = {}) => newItem({ type: "TASK", id, title, startDay, ...more });

test("the Today card's data: timed events in order, for each of the days ahead (246)", () => {
  const items = [ev(1, "Tese", T, 630), ev(2, "Dentist", T, 600), ev(3, "Holiday", T, null), ev(4, "Later", T + 2, 540), ev(5, "Past the week", T + 7, 540)];
  const a = buildAgenda(items, none, T);
  assert.equal(a.length, 7);
  assert.deepEqual(a.map((d) => d.day), [T, T + 1, T + 2, T + 3, T + 4, T + 5, T + 6]);
  assert.deepEqual(a[0].events, [{ min: 600, title: "Dentist" }, { min: 630, title: "Tese" }]); // the all-day one has no time to show
  assert.deepEqual(a[1].events, []);
  assert.deepEqual(a[2].events, [{ min: 540, title: "Later" }]);
});

test("the Today card counts what's still to do: ticked ones go, a routine isn't also a task or an event (246)", () => {
  const routine = task(1, "Vitamins", T, { routine: true, freq: "DAILY" });
  const routineEvent = ev(2, "Stretch", T, 510, { routine: true, freq: "DAILY" });
  const items = [routine, routineEvent, task(3, "Bins", T), task(4, "Done one", T), task(5, "Call", T, { startMin: 900 })];
  const done = new CompletionIndex([{ itemId: 4, day: T, completedAt: 1 }]);
  const today = buildAgenda(items, done, T)[0];
  assert.equal(today.routines, 2);
  assert.equal(today.tasks, 2);
  assert.deepEqual(today.events, []);
  const ticked = new CompletionIndex([{ itemId: 1, day: T, completedAt: 1 }]);
  assert.equal(buildAgenda(items, ticked, T)[0].routines, 1);
});

test("an event that repeats shows on each day it comes round (246)", () => {
  const a = buildAgenda([ev(1, "Stand-up", T, 540, { freq: "DAILY" })], none, T);
  assert.ok(a.every((d) => d.events.length === 1));
});
