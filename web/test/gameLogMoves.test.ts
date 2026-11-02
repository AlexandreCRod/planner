// A rated game keeps its log wherever it's moved from (review of 2.9.6, finding 1): the training sheets, the
// event's editor, a drag in the calendar, a hold on Today's time on one day of a repeating game, a whole series.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Entry, futsalLogId, newEntry } from "../src/domain/training.ts";
import { type Item, newItem } from "../src/domain/types.ts";
import { epochOf } from "../src/domain/dates.ts";

const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => { kept.set(k, v); },
  removeItem: (k: string) => { kept.delete(k); },
};
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");
const { moveGame, saveGameLog, tickGame } = await import("../src/store/futsal.ts");

const MON = epochOf(2026, 11, 2);
const RATED = { effort: 8, pain: 2, note: "good game", durationMin: 70 };
const logs = () => store.listOf<Entry>("trainingEntries");
const logAt = (itemId: number, day: number) => logs().find((e) => e.id === futsalLogId(itemId, day));
const ticked = (itemId: number, day: number) => store.snapshot().done.isDone(itemId, day);

function game(extra: Partial<Item> = {}) {
  const id = store.saveItem(newItem({ type: "EVENT", title: "Futsal", startDay: MON, endDay: MON, startMin: 1200, endMin: 1260, ...extra }));
  return store.snapshot().byId.get(id)!;
}
function rate(item: Item, day: number) {
  tickGame({ itemId: item.id, day }, true);
  saveGameLog({ itemId: item.id, day }, "p", RATED);
}
const expectRated = (itemId: number, day: number) => {
  const l = logAt(itemId, day);
  assert.ok(l, "the log is on the game's new place");
  assert.equal(l.itemId, itemId);
  assert.deepEqual([l.effort, l.pain, l.note, l.durationMin], [8, 2, "good game", 70]);
  assert.ok(ticked(itemId, day), "still ticked");
};

test("the event's editor or a calendar drag: a one-off game's log goes to the new day", () => {
  const g = game();
  rate(g, MON);
  store.saveItem({ ...g, startDay: MON + 3, endDay: MON + 3 });
  expectRated(g.id, MON + 3);
  assert.equal(logAt(g.id, MON), undefined);
});

test("moved back, the log comes back with it (an Undo saves the old item)", () => {
  const g = game();
  rate(g, MON);
  store.saveItem({ ...g, startDay: MON + 3, endDay: MON + 3 });
  store.saveItem(g);
  expectRated(g.id, MON);
  assert.equal(logAt(g.id, MON + 3), undefined);
});

test("a change of time alone leaves the log where it is", () => {
  const g = game();
  rate(g, MON);
  const before = logAt(g.id, MON)!;
  store.saveItem({ ...g, startMin: 1000, endMin: 1060 });
  assert.equal(logAt(g.id, MON), before);
});

test("one day of a repeating game, its time held on Today: the new event has the log", () => {
  const s = game({ freq: "WEEKLY" });
  rate(s, MON + 7);
  const copy = store.saveSeriesEdit("THIS", s, MON + 7, { ...s, startMin: 1100, endMin: 1160 });
  expectRated(copy, MON + 7);
  assert.equal(logAt(s.id, MON + 7), undefined);
});

test("one day of a repeating game moved in the calendar: log on the new day, the others' stay", () => {
  const s = game({ freq: "WEEKLY" });
  rate(s, MON + 7);
  rate(s, MON + 14);
  const copy = store.moveSeries("THIS", s, MON + 7, { ...s, startDay: MON + 9, endDay: MON + 9 });
  expectRated(copy, MON + 9);
  expectRated(s.id, MON + 14);
});

test("Undo of a held time on one day puts the log back on the series", () => {
  const s = game({ freq: "WEEKLY" });
  rate(s, MON + 7);
  const undo = store.withUndo(() => { store.saveSeriesEdit("THIS", s, MON + 7, { ...s, startMin: 1100, endMin: 1160 }); });
  undo();
  expectRated(s.id, MON + 7);
  assert.equal(logs().filter((e) => e.itemId === s.id).length, 1);
});

test("this and following: the logs from that day on go to the new series, earlier ones stay", () => {
  const s = game({ freq: "WEEKLY" });
  rate(s, MON);
  rate(s, MON + 7);
  rate(s, MON + 14);
  const next = store.saveSeriesEdit("FOLLOWING", s, MON + 7, { ...s, startMin: 1100, endMin: 1160 });
  expectRated(s.id, MON);
  expectRated(next, MON + 7);
  expectRated(next, MON + 14);
  assert.equal(logAt(s.id, MON + 14), undefined);
});

test("all of a series dragged a day on: every log moves with its game, none lost to the next", () => {
  const s = game({ freq: "DAILY" });
  rate(s, MON);
  rate(s, MON + 1);
  store.moveSeries("ALL", s, MON + 1, { ...s, startDay: MON + 2, endDay: MON + 2 });
  expectRated(s.id, MON + 1);
  expectRated(s.id, MON + 2);
  assert.equal(logs().filter((e) => e.itemId === s.id).length, 2);
});

test("moveGame still brings the log, on both kinds of event", () => {
  const once = game();
  rate(once, MON);
  const a = moveGame({ itemId: once.id, day: MON }, MON + 2);
  expectRated(a.itemId, MON + 2);
  const s = game({ freq: "WEEKLY" });
  rate(s, MON + 7);
  const b = moveGame({ itemId: s.id, day: MON + 7 }, MON + 8);
  assert.notEqual(b.itemId, s.id);
  expectRated(b.itemId, MON + 8);
});

test("moving one event leaves another event's log alone", () => {
  const a = game(), b = game();
  rate(b, MON);
  store.saveItem({ ...a, startDay: MON + 1, endDay: MON + 1 });
  expectRated(b.id, MON);
});

test("event 1's move doesn't take event 12's log for its own", () => {
  store.putRecords("trainingEntries", [newEntry({ id: futsalLogId(12, MON), planId: "p", kind: "futsal", itemId: 12 })]);
  store.saveItem(newItem({ id: 1, type: "EVENT", title: "Futsal", startDay: MON, endDay: MON }));
  store.saveItem({ ...store.snapshot().byId.get(1)!, startDay: MON + 1, endDay: MON + 1 });
  assert.ok(logAt(12, MON));
});
