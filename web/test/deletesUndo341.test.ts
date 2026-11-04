// 341: the last deletes without Undo get it (279's rule). What the pages call is checked here: a link and
// a reminder taken off and put back through the store's Undo, the problem log's Clear put back, and a
// stopwatch shown at zero while its Reset can still be undone.
import assert from "node:assert/strict";
import { test } from "node:test";
import { newItem } from "../src/domain/types.ts";
import { shownAfterReset } from "../src/domain/alarms.ts";
import { type Problem, MAX, restoredLog } from "../src/problems.ts";

(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");

test("Remove link: Undo puts the link back, and only it", () => {
  const a = store.saveItem(newItem({ type: "NOTE", title: "Trip" }));
  const b = store.saveItem(newItem({ type: "TASK", title: "Book flights" }));
  const c = store.saveItem(newItem({ type: "TASK", title: "Pack" }));
  store.addLink(a, b);
  store.addLink(a, c);
  const undo = store.withUndo(() => store.removeLink(a, b));
  assert.deepEqual([...store.snapshot().neighbours(a)], [c]);
  undo();
  assert.deepEqual([...store.snapshot().neighbours(a)].sort(), [b, c].sort());
});

test("a reminder's ✕ on the item page: Undo brings the reminder back with its time", () => {
  const id = store.saveItem(newItem({ type: "TASK", title: "Call mum", startDay: 20000, startMin: 600 }), {
    reminders: [{ id: 0, itemId: 0, offsetMin: 30, type: "ALARM", soundUri: null }, { id: 0, itemId: 0, offsetMin: 0, type: "REMINDER", soundUri: null }],
  });
  const item = store.snapshot().byId.get(id)!;
  const all = store.snapshot().reminders.get(id)!;
  const undo = store.withUndo(() => store.saveItem(item, { reminders: all.filter((r) => r.type !== "ALARM") }));
  assert.deepEqual(store.snapshot().reminders.get(id)!.map((r) => r.type), ["REMINDER"]);
  undo();
  const back = store.snapshot().reminders.get(id)!;
  assert.deepEqual(back.map((r) => `${r.type}:${r.offsetMin}`).sort(), ["ALARM:30", "REMINDER:0"]);
});

const p = (at: number, message: string): Problem => ({ at, kind: "error", message, detail: "" });

test("Problem log Clear: Undo puts the cleared ones back after any logged since, newest first", () => {
  const cleared = [p(30, "c"), p(20, "b"), p(10, "a")];
  assert.deepEqual(restoredLog([p(40, "new")], cleared).map((x) => x.message), ["new", "c", "b", "a"]);
  assert.deepEqual(restoredLog([], cleared).map((x) => x.message), ["c", "b", "a"]);
  const many = Array.from({ length: MAX }, (_, i) => p(1000 - i, `m${i}`));
  const back = restoredLog([p(2000, "latest")], many);
  assert.equal(back.length, MAX);
  assert.equal(back[0].message, "latest");
});

test("Stopwatch Reset: shown at zero without laps while it can be undone", () => {
  const paused = { id: 3, startedAt: null, accumulatedMs: 65_000, laps: [20_000, 40_000] };
  assert.deepEqual(shownAfterReset(paused, new Set([3])), { ...paused, accumulatedMs: 0, laps: [] });
  assert.equal(shownAfterReset(paused, new Set([4])), paused, "another one's reset leaves it as it is");
});

test("Stopwatch Reset on a running one (a long press, 350): shown stopped at zero while it can be undone", () => {
  const running = { id: 3, startedAt: 5, accumulatedMs: 65_000, laps: [20_000, 40_000] };
  assert.deepEqual(shownAfterReset(running, new Set([3])), { ...running, startedAt: null, accumulatedMs: 0, laps: [] });
  assert.equal(shownAfterReset(running, new Set([4])), running, "another one's reset leaves it running");
});
