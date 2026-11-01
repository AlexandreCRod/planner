// Training's overview (301): what the row for today says on a session, game, done, rest and nothing-placed day,
// the weeks of the Runs tile, and the lift the Lifts tile follows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Entry, type Plan, dayOf, entryFor, entryId, futsalLogId, newEntry, readPlan, sessionsOf } from "../src/domain/training.ts";
import { dayWord, leadLift, nextUp, todayCard, todayRows, usualWeekKm, weeklyKm } from "../src/domain/trainingToday.ts";

const d = (iso: string) => dayOf(iso)!;
const MON = d("2026-11-02");
const plan: Plan = readPlan({
  version: 1, plan: { id: "p", name: "P", start: "2026-11-02", end: "2026-11-15" },
  phases: [
    {
      name: "W1", start: "2026-11-02", end: "2026-11-08",
      sessions: [
        { id: "easy", title: "Easy run", detail: "6 km", kind: "run", default_date: "2026-11-03" },
        { id: "gym", title: "Gym", detail: "Legs", kind: "gym", default_date: "2026-11-03" },
        { id: "long", title: "Long run", detail: "16 km", kind: "run", default_date: "2026-11-08" },
        { id: "free", title: "Tempo", detail: "20 min", kind: "run" },
      ],
    },
    { name: "W2", start: "2026-11-09", end: "2026-11-15", sessions: [{ id: "next", title: "Next long", detail: "18 km", kind: "run", default_date: "2026-11-15" }] },
  ],
}).plan!;

const session = (id: string) => sessionsOf(plan).find((s) => s.id === id)!;
const logged = (id: string, patch: Partial<Entry>): Entry => ({ ...entryFor(plan, session(id), new Map()), ...patch });
const entries = (...list: Entry[]) => new Map(list.map((e) => [e.id, e]));
const game = (day: number, status: Entry["status"] = "planned"): Entry =>
  newEntry({ id: futsalLogId(7, day), planId: plan.id, kind: "futsal", title: "Futsal Alvalade", itemId: 7, day, status });
const placed = entries(logged("free", { day: MON }));

test("a session waiting comes first, the first of the day, with how many more are open", () => {
  const c = todayCard(plan, placed, MON + 1);
  assert.equal(c.kind, "session");
  if (c.kind === "session") { assert.equal(c.session.id, "easy"); assert.equal(c.more, 1); }
});

test("with one of two done the row moves to the other", () => {
  const c = todayCard(plan, entries(logged("free", { day: MON }), logged("easy", { status: "done" })), MON + 1);
  assert.equal(c.kind, "session");
  if (c.kind === "session") { assert.equal(c.session.id, "gym"); assert.equal(c.more, 0); }
});

test("a session waiting beats a game; the game shows once the sessions are done, and done once it's played", () => {
  const both = (st: Entry["status"]) => [logged("free", { day: MON }), logged("easy", { status: st }), logged("gym", { status: st })];
  assert.equal(todayCard(plan, entries(...both("planned"), game(MON + 1)), MON + 1).kind, "session");
  assert.equal(todayCard(plan, entries(...both("done"), game(MON + 1)), MON + 1).kind, "game");
  const c = todayCard(plan, entries(...both("done"), game(MON + 1, "done")), MON + 1);
  assert.equal(c.kind, "done");
  if (c.kind === "done") assert.equal(c.session?.id, "easy");
});

test("a game on its own: to log, then done by its title", () => {
  const free = entries(logged("free", { day: MON }), game(MON + 4));
  assert.equal(todayCard(plan, free, MON + 4).kind, "game");
  const c = todayCard(plan, entries(logged("free", { day: MON }), game(MON + 4, "done")), MON + 4);
  assert.equal(c.kind, "done");
  if (c.kind === "done") { assert.equal(c.session, null); assert.equal(c.entry.title, "Futsal Alvalade"); }
});

test("skipped sessions don't count: nothing waits and nothing is done", () => {
  const c = todayCard(plan, entries(logged("free", { day: MON }), logged("easy", { status: "skipped" }), logged("gym", { status: "skipped" })), MON + 1);
  assert.equal(c.kind, "rest");
});

test("a free day with sessions without a day says how many to place; none left, it's rest with what's next", () => {
  const none = todayCard(plan, new Map(), MON + 2);
  assert.deepEqual(none, { kind: "place", left: 1 });
  const rest = todayCard(plan, placed, MON + 2);
  assert.equal(rest.kind, "rest");
  if (rest.kind === "rest") assert.deepEqual(rest.next, { title: "Long run", day: MON + 6 });
});

test("what's next skips what's done or skipped, sees games, and is nothing after the last", () => {
  const es = entries(logged("long", { status: "skipped" }), game(MON + 7));
  assert.deepEqual(nextUp(plan, es, MON + 2), { title: "Futsal Alvalade", day: MON + 7 });
  assert.equal(nextUp(plan, new Map(), MON + 14), null);
  assert.equal(entryId(plan.id, "long"), logged("long", {}).id);
});

test("a day ahead reads tomorrow, a weekday, then a date", () => {
  const far = () => "far";
  assert.equal(dayWord(MON + 1, MON, far), "tomorrow");
  assert.equal(dayWord(MON + 6, MON, far), "Sun");
  assert.equal(dayWord(MON + 7, MON, far), "far");
});

test("weekly km: Monday weeks ending this one, nothing from before or after them", () => {
  const t = MON + 2;
  const runs = [
    { day: MON, distanceKm: 5 }, { day: MON + 6, distanceKm: 3 }, { day: MON - 1, distanceKm: 10 }, { day: MON - 7, distanceKm: 2 }, { day: MON - 8, distanceKm: 4 },
    { day: MON + 7, distanceKm: 99 }, { day: MON - 7 * 3 - 1, distanceKm: 99 }, { day: MON, distanceKm: null },
  ];
  assert.deepEqual(weeklyKm(runs, t, 3), [4, 12, 8]);
});

test("a usual week leaves out this one and empty ones", () => {
  assert.equal(usualWeekKm([20, 0, 30, 5]), 25);
  assert.equal(usualWeekKm([0, 7]), null);
});

test("the lift followed is the one done most lately, the plan's order breaking ties, else the one done last", () => {
  const since = 100;
  const a = { id: "a", pts: [{ day: 101 }] }, b = { id: "b", pts: [{ day: 102 }, { day: 103 }] }, c = { id: "c", pts: [{ day: 110 }] };
  assert.equal(leadLift([a, b, c], since), b);
  assert.equal(leadLift([a, c], since), a);
  const old1 = { id: "x", pts: [{ day: 50 }] }, old2 = { id: "y", pts: [{ day: 60 }] };
  assert.equal(leadLift([old1, old2], since), old2);
  assert.equal(leadLift([], since), null);
});

test("with two sessions on a day, the how-it-went box stays with the one logged, and the other goes under it", () => {
  const easy = logged("easy", { status: "done" });
  const card = todayCard(plan, entries(logged("free", { day: MON }), easy), MON + 1);
  const { rated, row } = todayRows(card, { session: session("easy"), entry: easy });
  assert.equal(rated?.kind, "done");
  if (rated?.kind === "done") assert.equal(rated.session?.id, "easy");
  assert.equal(row?.kind, "session");
  if (row?.kind === "session") assert.equal(row.session.id, "gym");
});

test("logging the last of two: the box is on that one, not on the first the done row would show", () => {
  const easy = logged("easy", { status: "done" }), gym = logged("gym", { status: "done" });
  const card = todayCard(plan, entries(logged("free", { day: MON }), easy, gym), MON + 1);
  assert.equal(card.kind, "done");
  if (card.kind === "done") assert.equal(card.session?.id, "easy");
  const { rated, row } = todayRows(card, { session: session("gym"), entry: gym });
  assert.equal(rated?.kind === "done" && rated.session?.id, "gym");
  assert.equal(row, null);
});

test("a session logged with the day's game still to come: the game waits under the box", () => {
  const easy = logged("easy", { status: "done" }), gym = logged("gym", { status: "done" });
  const card = todayCard(plan, entries(easy, gym, game(MON + 1)), MON + 1);
  const { rated, row } = todayRows(card, { session: session("gym"), entry: gym });
  assert.equal(rated?.kind, "done");
  assert.equal(row?.kind, "game");
});

test("a game logged asks under its own row", () => {
  const g = game(MON + 1, "done");
  const card = todayCard(plan, entries(logged("easy", { status: "done" }), logged("gym", { status: "done" }), g), MON + 1);
  const { rated, row } = todayRows(card, { session: null, entry: g });
  assert.equal(rated?.kind === "done" && rated.entry.id, g.id);
  assert.equal(row, null);
});

test("with no box open the row is just today's", () => {
  const card = todayCard(plan, placed, MON + 1);
  assert.deepEqual(todayRows(card, null), { rated: null, row: card });
});
