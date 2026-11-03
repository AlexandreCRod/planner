// A training day's order as the user dragged it (324): the week plan, the overview's row for today and the
// Today line follow it; with none (or for what it doesn't list) the plan's order stays.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dayOrderId, dayOrders, droppedOrder, inDayOrder } from "../src/domain/dayOrder.ts";
import { type Entry, type Plan, dayOf, entryFor, futsalLogId, newEntry, phaseView, readPlan, sessionsOf, sessionsOnDay } from "../src/domain/training.ts";
import { todayCard } from "../src/domain/trainingToday.ts";

const d = (iso: string) => dayOf(iso)!;
const TUE = d("2026-11-03");
const plan: Plan = readPlan({
  version: 1, plan: { id: "p", name: "P", start: "2026-11-02", end: "2026-11-08" },
  phases: [{
    name: "W1", start: "2026-11-02", end: "2026-11-08",
    sessions: [
      { id: "easy", title: "Easy run", detail: "6 km", kind: "run", default_date: "2026-11-03" },
      { id: "gym", title: "Gym", detail: "Legs", kind: "gym", default_date: "2026-11-03" },
      { id: "core", title: "Core", detail: "15 min", kind: "gym", default_date: "2026-11-03" },
      { id: "long", title: "Long run", detail: "16 km", kind: "run", default_date: "2026-11-08" },
    ],
  }],
}).plan!;
const session = (id: string) => sessionsOf(plan).find((s) => s.id === id)!;
const entry = (id: string, patch: Partial<Entry> = {}): Entry => ({ ...entryFor(plan, session(id), new Map()), ...patch });
const game: Entry = newEntry({ id: futsalLogId(7, TUE), planId: plan.id, kind: "futsal", title: "Futsal", itemId: 7, day: TUE });
const entries = (...list: Entry[]) => new Map(list.map((e) => [e.id, e]));
const tuesday = (es: Map<string, Entry>, orders?: Map<string, string[]>) =>
  phaseView(plan, 0, es, es.values(), orders).days.find((x) => x.day === TUE)!.items.map((x) => x.session?.id ?? "game");
const order = (...ids: string[]) => new Map([[dayOrderId(plan.id, TUE), ids]]);

test("without an order a day keeps the plan's order, then the game", () => {
  assert.deepEqual(tuesday(entries(game)), ["easy", "gym", "core", "game"]);
});

test("a dragged order is the day's order, the game anywhere in it", () => {
  assert.deepEqual(tuesday(entries(game), order(game.id, "p:core", "p:easy", "p:gym")), ["game", "core", "easy", "gym"]);
});

test("what the order doesn't list comes after what it does, in the plan's order; ids gone from the day are skipped", () => {
  // Gym was put on Tuesday after the order was kept; "long" was dragged here once and has gone back to Sunday.
  assert.deepEqual(tuesday(entries(game), order("p:core", "p:long", "p:easy")), ["core", "easy", "gym", "game"]);
});

test("another day's order doesn't touch this one", () => {
  const other = new Map([[dayOrderId(plan.id, TUE + 1), ["p:core", "p:easy"]]]);
  assert.deepEqual(tuesday(entries(game), other), ["easy", "gym", "core", "game"]);
});

test("dropping a row puts it at its new place; a drop past the end goes last", () => {
  const ids = ["p:easy", "p:gym", "p:core"];
  assert.deepEqual(droppedOrder(ids, "p:core", 0), ["p:core", "p:easy", "p:gym"]);
  assert.deepEqual(droppedOrder(ids, "p:easy", 2), ["p:gym", "p:core", "p:easy"]);
  assert.deepEqual(droppedOrder(ids, "p:gym", 1), ids);
  // From another day: it isn't among the ids yet.
  assert.deepEqual(droppedOrder(["p:easy", "p:gym"], "p:long", 1), ["p:easy", "p:long", "p:gym"]);
  assert.deepEqual(droppedOrder(["p:easy"], "p:long", 9), ["p:easy", "p:long"]);
});

test("records that don't read right leave the day in the plan's order", () => {
  const m = dayOrders([{ id: "p:1", order: ["a", 3 as unknown as string, "b"] }, { id: "p:2" }, { order: ["x"] }]);
  assert.deepEqual([...m], [["p:1", ["a", "b"]]]);
  assert.deepEqual(inDayOrder(["x", "y"], (x) => x, undefined), ["x", "y"]);
});

test("sessionsOnDay (Today's line) follows the order", () => {
  assert.deepEqual(sessionsOnDay(plan, TUE, entries(), order("p:gym", "p:easy")).map((x) => x.session.id), ["gym", "easy", "core"]);
});

test("the overview's row for today is the first thing waiting in the day's order", () => {
  const es = entries(game);
  const plain = todayCard(plan, es, TUE);
  assert.equal(plain.kind === "session" && plain.session.id, "easy");
  const gymFirst = todayCard(plan, es, TUE, order("p:gym"));
  assert.ok(gymFirst.kind === "session" && gymFirst.session.id === "gym" && gymFirst.more === 2);
  const gameFirst = todayCard(plan, es, TUE, order(game.id));
  assert.ok(gameFirst.kind === "game" && gameFirst.game.id === game.id);
  // Done with the game: the next session in the order.
  const played = entries({ ...game, status: "done" });
  const next = todayCard(plan, played, TUE, order(game.id, "p:core"));
  assert.ok(next.kind === "session" && next.session.id === "core");
  // All done: the first in the order.
  const all = entries({ ...game, status: "done" }, entry("easy", { status: "done" }), entry("gym", { status: "done" }), entry("core", { status: "done" }));
  const done = todayCard(plan, all, TUE, order("p:core", game.id));
  assert.ok(done.kind === "done" && done.session?.id === "core");
});
