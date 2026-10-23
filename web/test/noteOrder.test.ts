import assert from "node:assert/strict";
import { test } from "node:test";
import { inSlot, listOrderChanges, moveId, noteSlots, pinOrderChanges, sortNotes } from "../src/domain/noteOrder.ts";
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

// Item 138: any note can be dragged into place, like Google Keep; an unpinned one keeps its place.

test("an unpinned note dropped between two others goes between them, and only it is saved", () => {
  const notes = [note(1, { updatedAt: 300 }), note(2, { updatedAt: 200 }), note(3, { updatedAt: 100 })];
  assert.deepEqual(sortNotes(notes).map((n) => n.id), [1, 2, 3]);
  // Note 3 dragged to the top, then note 2 dragged between 3 and 1.
  const top = listOrderChanges(notes, [3, 1, 2], 3);
  assert.deepEqual(top, [{ id: 3, listOrder: 301 }]);
  const after = notes.map((n) => (n.id === 3 ? { ...n, listOrder: 301, updatedAt: 999 } : n)); // saving bumps its edit time
  assert.deepEqual(sortNotes(after).map((n) => n.id), [3, 1, 2]);
  const mid = listOrderChanges(after, [3, 2, 1], 2);
  assert.deepEqual(mid, [{ id: 2, listOrder: 300.5 }]);
  // To the bottom: just under the last one.
  assert.deepEqual(listOrderChanges(notes, [2, 3, 1], 1), [{ id: 1, listOrder: 99 }]);
});

test("a note edited later still goes to the top; a dragged one stays where it was put", () => {
  const notes = [note(1, { updatedAt: 300 }), note(2, { updatedAt: 200, listOrder: 250 }), note(3, { updatedAt: 100 })];
  const edited = notes.map((n) => (n.id === 3 ? { ...n, updatedAt: 400 } : n.id === 2 ? { ...n, updatedAt: 500 } : n));
  assert.deepEqual(sortNotes(edited).map((n) => n.id), [3, 1, 2]);
});

test("no room between two notes with the same place: the shown ones are spaced out", () => {
  const notes = [note(1, { updatedAt: 300 }), note(2, { updatedAt: 200 }), note(3, { updatedAt: 200 }), note(4, { updatedAt: 100 })];
  const ch = listOrderChanges(notes, [1, 2, 4, 3], 4);
  const placed = notes.map((n) => ({ ...n, listOrder: ch.find((c) => c.id === n.id)?.listOrder ?? n.listOrder }));
  assert.deepEqual(sortNotes(placed).map((n) => n.id), [1, 2, 4, 3]);
});

test("dragging leaves pinned notes and their order alone, and a single note has nothing to save", () => {
  const notes = [note(1, { pinned: true, pinOrder: 0 }), note(2, { updatedAt: 50 })];
  assert.deepEqual(listOrderChanges(notes, [1, 2], 2), []);
  assert.deepEqual(listOrderChanges(notes, [1, 2], 1), []);
});

test("the grid: two columns, each card under the shorter one", () => {
  const { slots, height } = noteSlots([100, 50, 40, 30], 208, 8);
  assert.deepEqual(slots.map((s) => [s.x, s.y]), [[0, 0], [108, 0], [108, 58], [108, 106]]);
  assert.equal(slots[0].w, 100);
  assert.equal(height, 136);
  assert.ok(inSlot(slots[1], 150, 20));
  assert.ok(!inSlot(slots[1], 50, 20));
  assert.equal(noteSlots([], 300, 8).height, 0);
});
