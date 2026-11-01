import assert from "node:assert/strict";
import { test } from "node:test";
import { timerUndoMs } from "../src/domain/alarms.ts";
import { newItem } from "../src/domain/types.ts";

// The store saves to localStorage and schedules a redraw; small stand-ins are enough here.
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");

test("a deleted timer with time to spare has the usual Undo", () => {
  assert.equal(timerUndoMs(600_000, true), 5000);
  assert.equal(timerUndoMs(6000, true), 5000);
});

test("a paused timer can't ring, so its Undo is never cut short", () => {
  assert.equal(timerUndoMs(1500, false), 5000);
});

test("a running timer about to end is gone before it would ring", () => {
  const left = 3000;
  const wait = timerUndoMs(left, true);
  assert.ok(wait > 0 && wait < left, `${wait}`);
  assert.equal(timerUndoMs(800, true), 0);
  assert.equal(timerUndoMs(0, true), 0);
});

test("Undo brings a deleted category back, on its items too", () => {
  store.saveCategory({ id: 7, name: "Work", color: 1, defaultAlert: "REMINDER" });
  const id = store.saveItem(newItem({ type: "TASK", title: "Report", categoryId: 7 }));
  const undo = store.deleteCategory({ id: 7, name: "Work", color: 1, defaultAlert: "REMINDER" });
  assert.equal(store.snapshot().byId.get(id)!.categoryId, null);
  assert.equal(store.snapshot().categories.length, 0);
  undo();
  assert.equal(store.snapshot().byId.get(id)!.categoryId, 7);
  assert.deepEqual(store.snapshot().categories.map((c) => c.name), ["Work"]);
});

test("Undo brings a removed picture back to its note", () => {
  const note = store.saveItem(newItem({ type: "NOTE", title: "Trip" }));
  store.addImage(note, { hash: "abc", mime: "image/jpeg", width: 10, height: 10 });
  const img = store.snapshot().images.get(note)![0];
  const undo = store.removeImage(img);
  assert.equal(store.snapshot().images.get(note), undefined);
  undo();
  assert.deepEqual(store.snapshot().images.get(note), [img]);
});
