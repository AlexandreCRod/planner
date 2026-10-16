import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf } from "../src/domain/dates.ts";
import { isRoutineItem, routineEntry, routineProgress, routineStreak, routinesOnDay, withoutRoutines } from "../src/domain/routines.ts";
import { CompletionIndex, tasksForDay } from "../src/domain/schedule.ts";
import { type Completion, type Item, newItem } from "../src/domain/types.ts";

const today = epochOf(2026, 10, 16); // a Friday
const daily = (id: number, extra: Partial<Item> = {}) =>
  newItem({ id, type: "TASK", title: `R${id}`, startDay: today - 30, freq: "DAILY", ...extra });
/** The items with the routine field set on the marked ids. */
const marked = (items: Item[], marks: Set<number>) => items.map((i) => ({ ...i, routine: marks.has(i.id) }));
const ticks = (id: number, ...days: number[]): Completion[] => days.map((day) => ({ itemId: id, day, completedAt: 0 }));

test("only marked, repeating, live tasks are routines", () => {
  assert.equal(isRoutineItem(daily(1, { routine: true })), true);
  assert.equal(isRoutineItem(daily(5)), false);                                              // not marked
  assert.equal(isRoutineItem(daily(6, { routine: false })), false);
  assert.equal(isRoutineItem(daily(2, { routine: true, freq: "NONE" })), false);             // no longer repeats: ignored
  assert.equal(isRoutineItem(daily(3, { routine: true, type: "EVENT" })), false);
  assert.equal(isRoutineItem(daily(4, { routine: true, deletedAt: 1 })), false);             // in the trash
});

test("a missed routine doesn't pile up as overdue on Today", () => {
  const r = daily(1, { routine: true }); // missed yesterday and the day before
  const plain = daily(2);        // a plain repeating task, also missed
  const done = new CompletionIndex(ticks(1, today - 3));
  const all = tasksForDay([r, plain], done, today);
  // Without the routine rule, both show as overdue.
  assert.deepEqual(all.filter((e) => e.status === "OVERDUE").map((e) => e.item.id), [1, 2]);
  const rest = withoutRoutines(all);
  assert.deepEqual(rest.map((e) => [e.item.id, e.status]), [[2, "OVERDUE"], [2, "DUE"]]);
  // The routine is only on its own checklist, for today.
  const list = routinesOnDay([r, plain], done, today, today);
  assert.deepEqual(list.map((e) => [e.item.id, e.day, e.status]), [[1, today, "DUE"]]);
  // In the task list its box ticks today, not the missed day.
  assert.equal(routineEntry(r, done, today).day, today);
  assert.equal(routineEntry(r, done, today).status, "DUE");
});

test("the checklist: ticked, missed on past days, sorted by time then title, with a count", () => {
  const items = [daily(1, { title: "Stretch", startMin: 540 }), daily(2, { title: "Pills", startMin: 480 }), daily(3, { title: "Journal" }),
    daily(4, { title: "Gym", freq: "WEEKLY", weekDays: 0b0000001 })]; // Mondays only: not today
  const marks = new Set([1, 2, 3, 4]);
  const done = new CompletionIndex([...ticks(2, today), ...ticks(1, today - 1)]);
  const list = routinesOnDay(marked(items, marks), done, today, today);
  assert.deepEqual(list.map((e) => [e.item.title, e.status]), [["Pills", "DONE"], ["Stretch", "DUE"], ["Journal", "DUE"]]);
  assert.deepEqual(routineProgress(list), { done: 1, total: 3 });
  // Looking back at yesterday: what wasn't ticked is "missed", not overdue.
  const y = routinesOnDay(marked(items, marks), done, today - 1, today);
  assert.deepEqual(y.map((e) => [e.item.title, e.status]), [["Pills", "MISSED"], ["Stretch", "DONE"], ["Journal", "MISSED"]]);
});

test("a missed day breaks the streak; today's open day doesn't", () => {
  const r = daily(1);
  // Ticked the last 4 days, today not yet: the streak is 4 and not broken.
  let done = new CompletionIndex(ticks(1, today - 4, today - 3, today - 2, today - 1));
  assert.deepEqual(routineStreak(r, done, today), { current: 4, best: 4, broken: false });
  // Ticked today too: 5.
  done = new CompletionIndex(ticks(1, today - 4, today - 3, today - 2, today - 1, today));
  assert.equal(routineStreak(r, done, today).current, 5);
  // Yesterday missed: broken, back to 0 until today is ticked; the best is kept.
  done = new CompletionIndex(ticks(1, today - 4, today - 3, today - 2));
  assert.deepEqual(routineStreak(r, done, today), { current: 0, best: 3, broken: true });
  done = new CompletionIndex(ticks(1, today - 4, today - 3, today - 2, today));
  assert.deepEqual(routineStreak(r, done, today), { current: 1, best: 3, broken: true });
  // Days it doesn't repeat on don't break it: Mon/Wed/Fri, ticked Mon and Wed, today Fri still open.
  const mwf = daily(2, { freq: "WEEKLY", weekDays: 0b0010101 });
  done = new CompletionIndex(ticks(2, today - 4, today - 2));
  assert.deepEqual(routineStreak(mwf, done, today), { current: 2, best: 2, broken: false });
});

test("the list of all routines: how each repeats, today's state and its streak", async () => {
  const { routineList } = await import("../src/domain/routines.ts");
  const { CompletionIndex } = await import("../src/domain/schedule.ts");
  const { newItem } = await import("../src/domain/types.ts");
  const today = 20_000;
  const daily = newItem({ type: "TASK", id: 1, title: "Stretch", startDay: today - 10, startMin: 420, freq: "DAILY", interval: 1 });
  const other = newItem({ type: "TASK", id: 2, title: "Plants", startDay: today + 1, freq: "DAILY", interval: 3 });
  const plain = newItem({ type: "TASK", id: 3, title: "Not one", startDay: today, freq: "DAILY", interval: 1 });
  const done = new CompletionIndex([1, 2, 3].map((k) => ({ itemId: 1, day: today - k, completedAt: 1 })).concat([{ itemId: 1, day: today, completedAt: 1 }]));
  const rows = routineList(marked([other, plain, daily], new Set([1, 2])), done, today);
  assert.deepEqual(rows.map((r) => r.item.title), ["Stretch", "Plants"]); // timed first; unmarked left out
  assert.equal(rows[0].today, "done");
  assert.equal(rows[0].repeat, "Every day");
  assert.equal(rows[0].streak.current, 4);
  assert.deepEqual([rows[1].today, rows[1].next], ["off", today + 1]);
});

test("the phone's old device-only marks move into the synced field once", async () => {
  const { itemsToMarkAsRoutines } = await import("../src/domain/routines.ts");
  const items = [daily(1), daily(2, { routine: true }), daily(3, { deletedAt: 5 }), daily(4)];
  // 9 was deleted for good: dropped. 2 already has the field: left alone. 3 in the trash keeps its mark.
  const out = itemsToMarkAsRoutines(items, [1, 2, 3, 9]);
  assert.deepEqual(out.map((i) => [i.id, i.routine]), [[1, true], [3, true]]);
  assert.equal(out[0].title, "R1"); // the rest of the item unchanged
  // Run again on the result: nothing more to mark.
  const after = items.map((i) => out.find((o) => o.id === i.id) ?? i);
  assert.deepEqual(itemsToMarkAsRoutines(after, [1, 2, 3, 9]), []);
});
