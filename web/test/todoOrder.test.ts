import assert from "node:assert/strict";
import { test } from "node:test";
import { sortTodos, todoKey, todoOrderChanges } from "../src/domain/todoOrder.ts";
import { moveId } from "../src/domain/noteOrder.ts";
import { type Item, newItem } from "../src/domain/types.ts";

// Item 241: to-dos can be dragged into order; the order syncs as each to-do's listOrder.

const T0 = 1_790_000_000_000; // a creation time in 2026 (ms)
const todo = (id: number, f: Partial<Item> = {}) => newItem({ type: "TASK", id, createdAt: T0 + id, updatedAt: T0 + id, ...f });
/** Applies [changes] and sorts again: the order the list shows after the drop. */
const after = (todos: Item[], changes: { id: number; listOrder: number }[]) => {
  const c = new Map(changes.map((x) => [x.id, x.listOrder]));
  return sortTodos(todos.map((t) => (c.has(t.id) ? { ...t, listOrder: c.get(t.id) } : t))).map((t) => t.id);
};
const drag = (todos: Item[], from: number, to: number) => {
  const ids = moveId(sortTodos(todos).map((t) => t.id), from, to);
  const moved = sortTodos(todos)[from].id;
  const changes = todoOrderChanges(todos, ids, moved);
  return { ids, changes, shown: after(todos, changes) };
};

test("never dragged, to-dos keep the order there was: priority first, then the newest first", () => {
  const todos = [todo(1), todo(2, { priority: 2 }), todo(3), todo(4, { priority: 1 }), todo(5, { priority: 2 })];
  assert.deepEqual(sortTodos(todos).map((t) => t.id), [5, 2, 4, 3, 1]);
});

test("one drag saves one to-do, wherever it goes, and the list shows the order dropped", () => {
  const todos = [todo(1), todo(2, { priority: 2 }), todo(3), todo(4, { priority: 1 }), todo(5, { priority: 2 })];
  for (const [from, to] of [[0, 4], [4, 0], [1, 3], [3, 1], [2, 0], [2, 4]]) {
    const { ids, changes, shown } = drag(todos, from, to);
    assert.equal(changes.length, 1, `${from} -> ${to}`);
    assert.deepEqual(shown, ids, `${from} -> ${to}`);
  }
});

test("a low-priority to-do dragged above a high one stays there", () => {
  const todos = [todo(1), todo(2, { priority: 3 })];
  const { changes, shown } = drag(todos, 1, 0);
  assert.deepEqual(shown, [1, 2]);
  assert.ok(todoKey({ ...todos[0], listOrder: changes[0].listOrder }) > todoKey(todos[1]));
});

test("dragged ones and new ones mix: a new to-do still comes in at the top of its priority", () => {
  const todos = [todo(1), todo(2), todo(3)];
  const { changes } = drag(todos, 0, 2); // 3 to the bottom
  const placed = todos.map((t) => (t.id === 3 ? { ...t, listOrder: changes[0].listOrder } : t));
  assert.deepEqual(sortTodos([...placed, todo(9)]).map((t) => t.id), [9, 2, 1, 3]);
});

test("with no room between two keys, the shown to-dos are numbered again, in the dropped order", () => {
  const todos = [todo(1, { listOrder: 10 }), todo(2, { listOrder: 10 }), todo(3, { listOrder: 10 })];
  const ids = [2, 3, 1];
  const changes = todoOrderChanges(todos, ids, 3);
  assert.ok(changes.length > 1);
  assert.deepEqual(after(todos, changes), ids);
});

test("nothing to write for a list of one, or a to-do not in it", () => {
  assert.deepEqual(todoOrderChanges([todo(1)], [1], 1), []);
  assert.deepEqual(todoOrderChanges([todo(1), todo(2)], [2, 1], 7), []);
});

test("many drags into the same gap keep working (halving, then numbering again)", () => {
  let todos = [todo(1), todo(2), todo(3)];
  for (let n = 0; n < 80; n++) {
    // The bottom one goes into the gap just under the top one, every time.
    const order = sortTodos(todos).map((t) => t.id);
    const ids = moveId(order, order.length - 1, 1);
    const changes = todoOrderChanges(todos, ids, order[order.length - 1]);
    const c = new Map(changes.map((x) => [x.id, x.listOrder]));
    todos = todos.map((t) => (c.has(t.id) ? { ...t, listOrder: c.get(t.id) } : t));
    assert.deepEqual(sortTodos(todos).map((t) => t.id), ids, `drag ${n}`);
  }
});
