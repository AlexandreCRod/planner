import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf, toTimestamp } from "../src/domain/dates.ts";
import { CompletionIndex, type Occurrence, type TaskEntry, occurrencesIn } from "../src/domain/schedule.ts";
import { dayGlance, foldDone, foldEvents, freeDayLine, overdueCount, splitDone, tasksProgressText, weekAhead } from "../src/domain/todayPlan.ts";
import { type Completion, type Item, newItem } from "../src/domain/types.ts";
import { PageMemory } from "../src/ui/phone/keep.ts";

const today = epochOf(2026, 10, 23);
const ev = (id: number, day: number, startMin: number | null, endMin: number | null, extra: Partial<Item> = {}) =>
  newItem({ id, type: "EVENT", title: `E${id}`, startDay: day, startMin, endMin, allDay: startMin === null, ...extra });
const task = (id: number, day: number | null, startMin: number | null = null, extra: Partial<Item> = {}) =>
  newItem({ id, type: "TASK", title: `T${id}`, startDay: day, startMin, ...extra });
const ticks = (...pairs: [number, number][]): Completion[] => pairs.map(([itemId, day]) => ({ itemId, day, completedAt: 0 }));
const key = (e: TaskEntry) => `${e.item.id}_${e.day}`;
const entry = (item: Item, status: TaskEntry["status"], day: number | null = today): TaskEntry => ({ item, day, status, missed: 0 });

test("events already over fold into one line; all-day and ongoing ones stay", () => {
  const items = [ev(1, today, 8 * 60, 9 * 60), ev(2, today, 10 * 60, 12 * 60), ev(3, today, 14 * 60, 15 * 60), ev(4, today, null, null)];
  const occ: Occurrence[] = occurrencesIn(items, new CompletionIndex([]), today, today);
  const now = toTimestamp(today, 11 * 60);
  const { earlier, rest } = foldEvents(occ, now);
  assert.deepEqual(earlier.map((o) => o.item.id), [1]);
  assert.deepEqual(rest.map((o) => o.item.id).sort(), [2, 3, 4]);
  // Ending exactly now counts as over.
  assert.deepEqual(foldEvents(occ, toTimestamp(today, 12 * 60)).earlier.map((o) => o.item.id), [1, 2]);
});

test("ticked tasks fold once each, leaving out those still shown in place", () => {
  const a = task(1, today), b = task(2, today), c = task(3, today), d = task(4, null);
  const dayTasks = [entry(a, "DUE"), entry(b, "DONE"), entry(c, "DONE")];
  const also = [entry(b, "DONE"), entry(d, "DONE", null)]; // b again (ticked today), and an undated one
  const shown = new Set([key(entry(c, "DONE"))]);           // c was just ticked: still in place
  assert.deepEqual(foldDone(dayTasks, also, shown, key).map((e) => e.item.id), [2, 4]);
  assert.deepEqual(foldDone([entry(a, "DUE")], [], new Set(), key), []);
});

test("a day at a glance: all day first, then by time, untimed tasks last; no ticked tasks or routines", () => {
  const d = today + 1;
  const items = [
    task(1, d), task(2, d, 9 * 60), ev(3, d, 13 * 60, 14 * 60), ev(4, d, null, null),
    task(5, d, 8 * 60), task(6, d - 30, null, { freq: "DAILY", routine: true }),
  ];
  const done = new CompletionIndex(ticks([5, d]));
  assert.deepEqual(dayGlance(items, done, d, today).map((g) => g.item.id), [4, 2, 3, 1]);
});

test("the next 7 days start the day after the one shown, each with its own items", () => {
  const items = [task(1, today + 1), ev(2, today + 3, 10 * 60, 11 * 60), task(3, today + 8), task(4, today)];
  const week = weekAhead(items, new CompletionIndex([]), today, today);
  assert.deepEqual(week.map((w) => w.day), [1, 2, 3, 4, 5, 6, 7].map((k) => today + k));
  assert.deepEqual(week.map((w) => w.rows.map((r) => r.item.id)), [[1], [], [2], [], [], [], []]);
  // From another day shown, the week follows it (task 3 is 8 days after today: day 7 after tomorrow).
  assert.deepEqual(weekAhead(items, new CompletionIndex([]), today + 1, today).at(-1)!.rows.map((r) => r.item.id), [3]);
});

test("page memory: kept per history step, the oldest steps dropped past the limit", () => {
  const m = new PageMemory(2);
  assert.equal(m.has("a"), false);
  m.set("a", "q", "milk");
  m.set("a", "scroll:list", 120);
  assert.equal(m.get("a", "q"), "milk");
  assert.equal(m.get("a", "scroll:list"), 120);
  assert.equal(m.get("a", "other"), undefined);
  m.set("b", "q", "x");
  m.get("a", "q");          // a used again: b is now the oldest
  m.set("c", "q", "y");
  assert.equal(m.has("b"), false);
  assert.equal(m.has("a"), true);
  assert.equal(m.size, 2);
});

test("what's waiting on today: tasks left from before it, not today's own, ticked ones or routines", () => {
  const t = 20000;
  const late = newItem({ id: 1, type: "TASK", title: "Late", startDay: t - 2 });
  const carried = newItem({ id: 2, type: "TASK", title: "Carried", startDay: t - 1, overduePolicy: "CARRY_OVER" });
  const own = newItem({ id: 3, type: "TASK", title: "Today's own", startDay: t });
  const ticked = newItem({ id: 4, type: "TASK", title: "Ticked", startDay: t - 2 });
  const routine = newItem({ id: 5, type: "TASK", title: "Stretch", startDay: t - 5, freq: "DAILY", routine: true });
  const done = new CompletionIndex([{ itemId: 4, day: t - 2, completedAt: 1 }]);
  assert.equal(overdueCount([late, carried, own, ticked, routine], done, t, true), 2);
  assert.equal(overdueCount([own], done, t, true), 0);
});

test("a day with no session: sessions to place show only on today", () => {
  const t = 20000;
  assert.equal(freeDayLine(3, t, t, false), "place");
  assert.equal(freeDayLine(3, t, t, true), "place");
  assert.equal(freeDayLine(3, t + 1, t, false), "none");
  assert.equal(freeDayLine(3, t + 1, t, true), "game or rest");
  assert.equal(freeDayLine(0, t + 1, t, false), "game or rest");
  assert.equal(freeDayLine(0, t, t, false), "game or rest");
});

test("the Tasks heading counts the day's tasks done, says All done at the end, and nothing without tasks (225)", () => {
  assert.equal(tasksProgressText(1, 2), "1 of 2 done");
  assert.equal(tasksProgressText(0, 3), "0 of 3 done");
  assert.equal(tasksProgressText(2, 2), "All done");
  assert.equal(tasksProgressText(0, 0), "");
  // 341: overdue tasks still open above the heading: not "All done", the plain count instead.
  assert.equal(tasksProgressText(3, 3, 2), "3 of 3 done");
  assert.equal(tasksProgressText(1, 3, 2), "1 of 3 done");
  assert.equal(tasksProgressText(3, 3, 0), "All done");
});

test("a list keeps its open rows and folds the ticked ones at its end, except one just ticked and still held (284)", () => {
  const rows = [{ id: 1, done: false }, { id: 2, done: true }, { id: 3, done: true }, { id: 4, done: false }];
  const held = new Set([3]);
  const { open, done } = splitDone(rows, (r) => r.done, (r) => held.has(r.id));
  assert.deepEqual(open.map((r) => r.id), [1, 3, 4]);
  assert.deepEqual(done.map((r) => r.id), [2]);
  // Once let go, it folds too; an open row is never folded, held or not.
  const later = splitDone(rows, (r) => r.done, (r) => r.id === 1);
  assert.deepEqual(later.open.map((r) => r.id), [1, 4]);
  assert.deepEqual(later.done.map((r) => r.id), [2, 3]);
});
