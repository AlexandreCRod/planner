import assert from "node:assert/strict";
import { test } from "node:test";
import { type Item, newItem } from "../src/domain/types.ts";

// The routine marks live in localStorage on the phone; a small stand-in is enough here.
const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => { kept.set(k, v); },
  removeItem: (k: string) => { kept.delete(k); },
};
// The store's redraw also schedules a save; not needed here.
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const marks = await import("../src/store/routines.ts");

const task = (id: number, extra: Partial<Item> = {}) => newItem({ id, type: "TASK", title: `T${id}`, startDay: 20000, freq: "DAILY", ...extra });

test("marks are saved on the device, and an item deleted for good loses its mark", () => {
  marks.setRoutine(1, true);
  marks.setRoutine(2, true);
  marks.setRoutine(3, true);
  assert.deepEqual(JSON.parse(kept.get("routines")!), [1, 2, 3]);
  // 2 is in the trash: it keeps its mark (Undo and Restore bring the routine back). 3 is gone for good.
  marks.pruneRoutines([task(1), task(2, { deletedAt: 1 })]);
  assert.deepEqual(marks.listRoutines().sort(), [1, 2]);
  assert.deepEqual(JSON.parse(kept.get("routines")!).sort(), [1, 2]);
  marks.setRoutine(1, false);
  assert.equal(marks.isRoutine(1), false);
  assert.deepEqual(marks.listRoutines(), [2]);
});
