import assert from "node:assert/strict";
import { test } from "node:test";
import { type Item, newItem } from "../src/domain/types.ts";
import { endedBefore, occurrenceDay, occurrences } from "../src/domain/recurrence.ts";

// The store saves to localStorage and schedules a redraw; small stand-ins are enough here.
const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => { kept.set(k, v); },
  removeItem: (k: string) => { kept.delete(k); },
};
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");

const series = (id: number, extra: Partial<Item> = {}) =>
  newItem({ id, type: "EVENT", title: "Class", startDay: 20000, freq: "DAILY", ...extra });

test("this and following ends the series the day before", () => {
  const ended = endedBefore(series(1), 20005)!;
  assert.equal(ended.untilDay, 20004);
  assert.deepEqual(occurrences(ended, 20003, 20007), [20003, 20004]);
});

test("a series with an earlier end keeps it", () => {
  assert.equal(endedBefore(series(1, { untilDay: 20010 }), 20005)!.untilDay, 20004);
  assert.equal(endedBefore(series(1, { untilDay: 20003 }), 20005)!.untilDay, 20003);
});

test("from the first occurrence nothing is left", () => {
  assert.equal(endedBefore(series(1), 20000), null);
  // The second day is the first one still there: its first day was deleted on its own.
  assert.equal(endedBefore(series(1, { excludedDays: "20000" }), 20001), null);
  // Weekly: the first real occurrence comes after the start day.
  assert.equal(endedBefore(series(1, { freq: "WEEKLY", interval: 2 }), 20014)?.untilDay, 20013);
});

test("deleting following keeps the earlier days, takes changed days after, and undoes", () => {
  const s = series(51);
  store.saveItem(s);
  const before = store.saveSeriesEdit("THIS", store.snapshot().byId.get(51)!, 20002, { ...s, startMin: 600 });
  const after = store.saveSeriesEdit("THIS", store.snapshot().byId.get(51)!, 20008, { ...s, startMin: 600 });
  const cur = store.snapshot().byId.get(51)!;
  const undo = store.deleteFollowing(cur, 20005);
  let snap = store.snapshot();
  assert.equal(snap.byId.get(51)!.untilDay, 20004);
  assert.equal(snap.byId.get(51)!.deletedAt, null);
  assert.equal(snap.items.some((i) => i.id === after), false);
  assert.equal(snap.items.some((i) => i.id === before), true);
  undo();
  snap = store.snapshot();
  assert.equal(snap.byId.get(51)!.untilDay, null);
  assert.equal(snap.items.some((i) => i.id === after), true);
});

test("deleting following from the first day trashes the series, and undo brings it back", () => {
  store.saveItem(series(52));
  const undo = store.deleteFollowing(store.snapshot().byId.get(52)!, 20000);
  assert.equal(store.snapshot().items.some((i) => i.id === 52), false);
  undo();
  const back = store.snapshot().byId.get(52)!;
  assert.equal(back.deletedAt, null);
  assert.equal(back.untilDay, null);
});

test("opened without a day, a delete means the next occurrence, not the series' first", () => {
  const today = 20070;
  const weekly = series(81, { freq: "WEEKLY", title: "Weekly" });
  assert.equal(occurrenceDay(weekly, null, today), 20070);
  assert.equal(occurrenceDay(weekly, null, today + 1), 20077);
  // A day it was opened on wins, and a series that's over falls back to its first day.
  assert.equal(occurrenceDay(weekly, 20014, today), 20014);
  assert.equal(occurrenceDay({ ...weekly, untilDay: 20007 }, null, today), 20000);

  // The whole path: "This occurrence only" takes today's and leaves the first; "This and following" keeps the past.
  store.saveItem(weekly);
  const cur = () => store.snapshot().byId.get(81)!;
  const day = occurrenceDay(cur(), null, today)!;
  store.deleteOccurrence(cur(), day);
  assert.deepEqual(occurrences(cur(), 20000, 20077), [20000, 20007, 20014, 20021, 20028, 20035, 20042, 20049, 20056, 20063, 20077]);
  store.deleteFollowing(cur(), occurrenceDay(cur(), null, today)!);
  assert.equal(cur().deletedAt, null);
  assert.equal(occurrences(cur(), 20000, 20100).at(-1), 20063);
});

/** One changed day of [id], made as the app makes them; returns its id. */
const changedDay = (id: number, day: number, to = day) => {
  const cur = store.snapshot().byId.get(id)!;
  return store.saveSeriesEdit("THIS", cur, day, { ...cur, startMin: 600 }, { movedTo: to });
};
/** Whether [id] is live, in the trash, or gone. */
const state = (id: number) => {
  const all = store.listOf<Item>("items").find((i) => i.id === id);
  return !all ? "gone" : all.deletedAt === null ? "live" : "trash";
};

test("undo of deleting following from the first remaining day leaves a day deleted earlier in the trash", () => {
  store.saveItem(series(91));
  const earlier = changedDay(91, 20003);
  store.trash(earlier);
  const later = changedDay(91, 20005);
  const undo = store.deleteFollowing(store.snapshot().byId.get(91)!, 20000);
  assert.deepEqual([state(91), state(earlier), state(later)], ["trash", "trash", "trash"]);
  undo();
  assert.deepEqual([state(91), state(earlier), state(later)], ["live", "trash", "live"]);
});

test("a first occurrence moved on its own stays when everything after it is deleted", () => {
  // Mondays from 20002; the first one was moved to the Tuesday, so it's a changed day, before the chosen one.
  store.saveItem(series(92, { freq: "WEEKLY", startDay: 20002 }));
  const moved = changedDay(92, 20002, 20003);
  const after = changedDay(92, 20016);
  const undo = store.deleteFollowing(store.snapshot().byId.get(92)!, 20009);
  assert.deepEqual([state(92), state(moved), state(after)], ["trash", "live", "trash"]);
  assert.ok(store.snapshot().items.some((i) => i.id === moved));
  undo();
  assert.deepEqual([state(92), state(moved), state(after)], ["live", "live", "live"]);
});
