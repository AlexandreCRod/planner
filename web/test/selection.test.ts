import { test } from "node:test";
import assert from "node:assert/strict";
import { keepShown, selectAll, toggleId } from "../src/ui/phone/selection.ts";

test("a tap adds or removes one", () => {
  const a = toggleId(new Set(), 3);
  assert.deepEqual([...a], [3]);
  assert.deepEqual([...toggleId(a, 4)].sort(), [3, 4]);
  assert.equal(toggleId(a, 3).size, 0);
});

test("anything no longer shown drops out; nothing changes when all are still there", () => {
  const ids = new Set([1, 2, 3]);
  assert.equal(keepShown(ids, [1, 2, 3, 4]), ids);
  assert.deepEqual([...keepShown(ids, [2, 9])], [2]);
  const none = new Set<number>();
  assert.equal(keepShown(none, []), none);
});

test("Select all picks everything shown", () => {
  assert.deepEqual([...selectAll(new Set([1]), [1, 2, 3])], [1, 2, 3]);
  assert.deepEqual([...selectAll(new Set([1, 2, 3]), [1, 2, 3])], [1, 2, 3]);
  const ids = new Set([5]);
  assert.equal(selectAll(ids, []), ids);
});
