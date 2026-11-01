import assert from "node:assert/strict";
import { test } from "node:test";
import { clearedNow, isTodo, todoNumber } from "../src/domain/todoNumber.ts";
import { outgoingChanges } from "../src/domain/syncMerge.ts";
import { newItem } from "../src/domain/types.ts";

// The store saves to localStorage and schedules a redraw; small stand-ins are enough here.
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");
const { clearTodoNumber, showTodoNumber, todosCleared } = await import("../src/store/todoNumber.ts");

const t = (id: number, priority: number) => ({ id, priority });

test("only the highest priority level present counts", () => {
  assert.deepEqual(todoNumber([t(1, 1), t(2, 3), t(3, 3), t(4, 2)], null), { count: 2, level: 3 });
  assert.deepEqual(todoNumber([t(1, 4), t(2, 3), t(3, 3)], null), { count: 1, level: 4 });
});

test("plain to-dos never count, alone or beside others", () => {
  assert.equal(todoNumber([t(1, 0), t(2, 0), t(3, 0)], null), null);
  assert.equal(todoNumber([], null), null);
  assert.deepEqual(todoNumber([t(1, 0), t(2, 1), t(3, 0)], null), { count: 1, level: 1 });
});

test("cleared, the number stays gone while nothing changes", () => {
  const todos = [t(1, 4), t(2, 4), t(3, 1)];
  assert.equal(todoNumber(todos, clearedNow(todos)), null);
});

test("a new to-do brings the number back, counting only what's new", () => {
  const cleared = clearedNow([t(1, 4), t(2, 4)]);
  // Not "3 urgent", and not at the level of what was cleared.
  assert.deepEqual(todoNumber([t(1, 4), t(2, 4), t(3, 1)], cleared), { count: 1, level: 1 });
  assert.deepEqual(todoNumber([t(1, 4), t(2, 4), t(3, 4)], cleared), { count: 1, level: 4 });
});

test("among what's new the highest level still decides", () => {
  const cleared = clearedNow([t(1, 4)]);
  assert.deepEqual(todoNumber([t(1, 4), t(2, 1), t(3, 2), t(4, 2)], cleared), { count: 2, level: 2 });
});

test("a plain new to-do doesn't bring the number back", () => {
  assert.equal(todoNumber([t(1, 3), t(2, 0)], clearedNow([t(1, 3)])), null);
});

test("a priority going up counts as new; going down or staying doesn't", () => {
  const cleared = clearedNow([t(1, 1), t(2, 2), t(3, 0)]);
  assert.deepEqual(todoNumber([t(1, 3), t(2, 2)], cleared), { count: 1, level: 3 });
  assert.deepEqual(todoNumber([t(1, 1), t(2, 2), t(3, 1)], cleared), { count: 1, level: 1 });
  assert.equal(todoNumber([t(1, 1), t(2, 1)], cleared), null);
});

test("a cleared to-do taken away and brought back isn't new", () => {
  const cleared = clearedNow([t(1, 2), t(2, 2)]);
  assert.equal(todoNumber([t(2, 2)], cleared), null);
  assert.equal(todoNumber([t(1, 2), t(2, 2)], cleared), null);
});

test("what's dated isn't a to-do", () => {
  assert.equal(isTodo({ type: "TASK", startDay: null }), true);
  assert.equal(isTodo({ type: "TASK", startDay: 20000 }), false);
  assert.equal(isTodo({ type: "NOTE", startDay: null }), false);
});

type Rec = { id: number; type: string; startDay: number | null; priority: number };
const number = () => todoNumber(store.listOf<Rec>("items").filter(isTodo), todosCleared());

test("on the store: clearing, Undo, something new, and Show the number", () => {
  store.saveItem(newItem({ type: "TASK", title: "Urgent", priority: 4 }));
  store.saveItem(newItem({ type: "TASK", title: "Dated", priority: 2, startDay: 20000 }));
  assert.deepEqual(number(), { count: 1, level: 4 });

  const undo = clearTodoNumber();
  assert.equal(number(), null);
  undo();
  assert.equal(todosCleared(), null);
  assert.deepEqual(number(), { count: 1, level: 4 });

  clearTodoNumber();
  store.saveItem(newItem({ type: "TASK", title: "New", priority: 1 }));
  assert.deepEqual(number(), { count: 1, level: 1 });

  showTodoNumber();
  assert.equal(todosCleared(), null);
  assert.deepEqual(number(), { count: 1, level: 4 });
});

test("the clearing syncs like any record, and waits on a Worker that takes only the first kinds", () => {
  clearTodoNumber();
  const send = (takes: (k: string) => boolean) => outgoingChanges({ seq: 0, records: {} }, store.allRecords(), { withBase: false, takes, maxChars: 1e6 }).outgoing;
  assert.ok(send(() => true).some((c) => c.kind === "todoNumber" && (c.data as { cleared: unknown }).cleared !== null));
  assert.ok(!send((k) => store.FIRST_KINDS.includes(k as never)).some((c) => c.kind === "todoNumber"));
});
