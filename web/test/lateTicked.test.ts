import assert from "node:assert/strict";
import { test } from "node:test";
import { toTimestamp } from "../src/domain/dates.ts";
import { CompletionIndex, forCalendar, withLateTicked } from "../src/domain/schedule.ts";
import { splitDone } from "../src/domain/todayPlan.ts";
import { newItem } from "../src/domain/types.ts";

// Review of 2.10, finding 1: an overdue task ticked in the Agenda or Month's day list stays, then folds into that day's "done".
const T = 20_400;
const late = newItem({ type: "TASK", id: 1, title: "Bins", startDay: T - 3 });
const other = newItem({ type: "TASK", id: 2, title: "Call", startDay: T, startMin: 600 });
const items = [late, other];
const ticked = (at: number) => new CompletionIndex([{ itemId: 1, day: T - 3, completedAt: at }]);

test("before the tick, the overdue task is on today; after, today's list still has it, ticked, in the same place (finding 1)", () => {
  const before = forCalendar(items, new CompletionIndex([]), T, T, T);
  assert.deepEqual(before.map((o) => [o.item.id, o.completed]), [[1, false], [2, false]]);
  const done = ticked(toTimestamp(T, 9 * 60));
  const bare = forCalendar(items, done, T, T, T);
  assert.deepEqual(bare.map((o) => o.item.id), [2]); // the bug: it went back to its own past day
  const after = withLateTicked(bare, items, done, T);
  assert.deepEqual(after.map((o) => [o.item.id, o.day, o.completed]), [[1, T, true], [2, T, false]]);
  assert.equal(after[0].overdue, true); // so its row unticks its own day, T - 3
  // Held for the linger it stays first in the list; then it folds into "1 done".
  const held = splitDone(after, (o) => o.completed, (o) => o.item.id === 1);
  assert.deepEqual(held.open.map((o) => o.item.id), [1, 2]);
  const folded = splitDone(after, (o) => o.completed, () => false);
  assert.deepEqual([folded.open.map((o) => o.item.id), folded.done.map((o) => o.item.id)], [[2], [1]]);
});

test("only tasks ticked during that day come back, not those ticked before, nor with carrying over off (finding 1)", () => {
  const yesterday = ticked(toTimestamp(T - 1, 20 * 60));
  assert.deepEqual(withLateTicked(forCalendar(items, yesterday, T, T, T), items, yesterday, T).map((o) => o.item.id), [2]);
  const today = ticked(toTimestamp(T, 60));
  assert.deepEqual(withLateTicked(forCalendar(items, today, T, T, T, false), items, today, T, false).map((o) => o.item.id), [2]);
  // A task ticked on its own day isn't late: it stays on its day.
  const own = new CompletionIndex([{ itemId: 2, day: T, completedAt: toTimestamp(T, 60) }]);
  const list = forCalendar(items, own, T, T, T);
  assert.deepEqual(withLateTicked(list, items, own, T), list);
});
