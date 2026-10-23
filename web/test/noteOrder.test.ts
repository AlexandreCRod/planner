import assert from "node:assert/strict";
import { test } from "node:test";
import { moveId, pinOrderChanges, sortNotes } from "../src/domain/noteOrder.ts";
import { newItem } from "../src/domain/types.ts";

// Item 99: pinned notes keep a fixed order, set by dragging them.

const note = (id: number, f: Partial<ReturnType<typeof newItem>> = {}) => newItem({ type: "NOTE", id, createdAt: id, updatedAt: id, ...f });

test("pinned notes keep their dragged order however recently they were edited", () => {
  const notes = [note(1, { pinned: true, pinOrder: 1, updatedAt: 99 }), note(2, { pinned: true, pinOrder: 0 }), note(3, { updatedAt: 50 }), note(4, { updatedAt: 60 })];
  assert.deepEqual(sortNotes(notes).map((n) => n.id), [2, 1, 4, 3]);
});

test("a pinned note never placed goes after the placed ones, oldest first", () => {
  const notes = [note(5, { pinned: true, updatedAt: 100 }), note(3, { pinned: true }), note(9, { pinned: true, pinOrder: 0 })];
  assert.deepEqual(sortNotes(notes).map((n) => n.id), [9, 3, 5]);
});

test("moving one pinned note and writing only the places that changed", () => {
  assert.deepEqual(moveId([1, 2, 3, 4], 3, 0), [4, 1, 2, 3]);
  assert.deepEqual(moveId([1, 2, 3], 0, 9), [2, 3, 1]);
  const notes = [note(1, { pinned: true, pinOrder: 0 }), note(2, { pinned: true, pinOrder: 1 }), note(3, { pinned: true })];
  assert.deepEqual(pinOrderChanges(notes, [1, 3, 2]), [{ id: 3, pinOrder: 1 }, { id: 2, pinOrder: 2 }]);
});
