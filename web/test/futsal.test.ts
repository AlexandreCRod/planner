// Futsal as calendar events (item 240): the mark, the games from event occurrences, the views reading them,
// the CSV rows, and the one-off conversion of the old futsal entries.
import assert from "node:assert/strict";
import { test } from "node:test";
import { futsalItemId, tagIdFor } from "../src/domain/ids.ts";
import { brokenNow, brokenRules } from "../src/domain/placement.ts";
import {
  type Entry, convertFutsal, dayOf, entriesWithGames, futsalDay, futsalGames, futsalLogId, isFutsal, logCsv, newEntry, phaseView, readPlan,
  trainingEntries,
} from "../src/domain/training.ts";
import { weekBar } from "../src/domain/trainingWeek.ts";
import { dayType } from "../src/domain/trends.ts";
import { type Completion, type Item, newItem } from "../src/domain/types.ts";

const d = (iso: string) => dayOf(iso)!;
const MON = d("2026-11-02");
const plan = readPlan({
  version: 1, plan: { id: "p", name: "P", start: "2026-11-02", end: "2026-11-15" },
  phases: [
    {
      name: "W1", start: "2026-11-02", end: "2026-11-08",
      placement: [{ id: "no-futsal-before-long", level: "avoid", check: { type: "not_day_before", a: { kind: "futsal" }, b: { day_type: "long" } }, text: "No futsal the day before the long run", why: "Tired legs." }],
      sessions: [{ id: "long", title: "Long run", detail: "10 km", kind: "run", day_type: "long", default_date: "2026-11-08" }],
    },
    { name: "W2", start: "2026-11-09", end: "2026-11-15", sessions: [] },
  ],
  nutrition: { day_types: { training: { carbs_g: [300, 350] }, rest: { carbs_g: [200, 250] }, long: { carbs_g: [400, 450] } } },
}).plan!;

let n = 1;
const event = (fields: Partial<Item>) => newItem({ id: n++, type: "EVENT", title: "Futsal", startDay: MON + 2, endDay: MON + 2, allDay: true, createdAt: 1, updatedAt: 1, ...fields });
const done = (itemId: number, day: number): Completion => ({ itemId, day, completedAt: 5 });

test("isFutsal: by the title (any case) unless switched; events only", () => {
  const cases: [Partial<Item>, boolean][] = [
    [{ title: "Futsal" }, true],
    [{ title: "futsal with work" }, true],
    [{ title: "FUTSAL" }, true],
    [{ title: "Football" }, false],
    [{ title: "Football", futsal: true }, true],
    [{ title: "Futsal", futsal: false }, false],
    [{ title: "Futsal", type: "TASK" }, false],
    [{ title: "Futsal", type: "NOTE" }, false],
    [{ title: "Futsal", type: "TASK", futsal: true }, false],
  ];
  for (const [f, want] of cases) assert.equal(isFutsal(event(f)), want, JSON.stringify(f));
});

test("futsalItemId: the same for the same entry, in newId's range, unlike the tag ids' hash", () => {
  const a = futsalItemId("futsal-abc123");
  assert.equal(a, futsalItemId("futsal-abc123"));
  assert.notEqual(a, futsalItemId("futsal-abc124"));
  for (const id of ["", "x", "futsal-abc123", "futsal-ÿé"]) {
    const v = futsalItemId(id);
    assert.ok(Number.isSafeInteger(v) && v >= 2 ** 40 && v < 2 ** 53, `${id}: ${v}`);
  }
  // The shared hash didn't change the tags' ids (the values from before it was shared).
  assert.deepEqual([tagIdFor(" Work "), tagIdFor("Futsal")], [2513441544218049, 3926170808347885]);
});

test("futsalGames: every occurrence in the range, repeats expanded, days taken out and the trash left out, untimed too", () => {
  const weekly = event({ title: "Futsal (Tue)", startDay: MON + 1, endDay: MON + 1, startMin: 19 * 60, endMin: 20 * 60, allDay: false, freq: "WEEKLY", excludedDays: String(MON + 8) });
  const once = event({ startDay: MON + 3, endDay: MON + 3 });
  const binned = event({ deletedAt: 9 });
  const football = event({ title: "Football" });
  const task = event({ type: "TASK" });
  const log = newEntry({ id: futsalLogId(once.id, MON + 3), planId: "p", kind: "futsal", itemId: once.id, durationMin: 75 });
  const games = futsalGames({ start: MON, end: MON + 20 }, [weekly, once, binned, football, task], [done(weekly.id, MON + 1)], new Map([[log.id, log]]));
  assert.deepEqual(games.map((g) => [g.itemId, g.day - MON, g.done, g.log?.durationMin ?? null]), [
    [weekly.id, 1, true, null],
    [once.id, 3, false, 75],
    [weekly.id, 15, false, null], // MON + 8 taken out
  ]);
});

test("the views read the games: the day's list, placement, the week bar, the day's type", () => {
  const sat = event({ startDay: MON + 5, endDay: MON + 5 }); // the day before the long run
  const wed = event({ startDay: MON + 2, endDay: MON + 2 });
  const old = newEntry({ id: "futsal-old", planId: "p", kind: "futsal", day: MON + 4, convertedTo: 77 });
  const raw = newEntry({ id: "futsal-raw", planId: "p", kind: "futsal", day: MON + 4 }); // not converted yet: not shown either
  const es = trainingEntries([plan], [old, raw], [sat, wed], [done(wed.id, MON + 2)]);
  assert.deepEqual([...es.keys()], [futsalLogId(wed.id, MON + 2), futsalLogId(sat.id, MON + 5)]);
  const w = es.get(futsalLogId(wed.id, MON + 2))!;
  assert.deepEqual([w.kind, w.status, w.day, w.doneDay, w.planId, w.itemId, futsalDay(w)], ["futsal", "done", MON + 2, MON + 2, "p", wed.id, MON + 2]);

  const v = phaseView(plan, 0, es, es.values());
  assert.deepEqual(v.days.map((x) => x.items.map((i) => i.session?.id ?? i.entry.id)), [
    [], [], [w.id], [], [], [futsalLogId(sat.id, MON + 5)], ["long"],
  ]);
  const bar = weekBar(v.days, []);
  assert.deepEqual([bar.segments.map((s) => `${s.kind}${s.done ? "+" : ""}`), bar.done], [["futsal+", "futsal", "run"], 1]);

  assert.deepEqual([...brokenNow(plan, es).keys()], ["long", futsalLogId(sat.id, MON + 5)]);
  // Moving Saturday's game: it no longer counts on its old day.
  assert.deepEqual(brokenRules(plan, es, { futsal: futsalLogId(sat.id, MON + 5) }, MON + 3), []);
  assert.equal(brokenRules(plan, es, { futsal: null }, MON + 5).length, 1);

  assert.equal(dayType(plan, MON + 2, es), "training");
  assert.equal(dayType(plan, MON + 4, es), "rest"); // the old entries count no more
});

test("a day in two plans' ranges goes to the later plan; outside every plan, no game", () => {
  const later = { id: "q", start: MON + 7, end: MON + 30 };
  const e1 = event({ startDay: MON + 8, endDay: MON + 8 });
  const e2 = event({ startDay: MON + 40, endDay: MON + 40 });
  const es = trainingEntries([plan, later], [], [e1, e2], []);
  assert.deepEqual([...es.values()].map((e) => [e.planId, e.day! - MON]), [["q", 8]]);
});

test("the log's CSV rows: the same columns, futsal from the games", () => {
  const e = event({ title: "Futsal with work", startDay: MON + 2, endDay: MON + 2 });
  const planned = event({ startDay: MON + 9, endDay: MON + 9 });
  const log = newEntry({ id: futsalLogId(e.id, MON + 2), planId: "p", kind: "futsal", itemId: e.id, durationMin: 60, pain: 2, effort: 7, note: 'said "ouch"' });
  const es = trainingEntries([plan], [log], [e, planned], [done(e.id, MON + 2)]);
  const rows = logCsv(plan, es.values()).split("\r\n");
  assert.equal(rows[0], "session_id,kind,status,scheduled_date,date_done,duration_min,pain_0_10,effort_1_10,note,title,detail");
  assert.equal(rows[1], "long,session,planned,2026-11-08,,,,,,Long run,10 km");
  assert.equal(rows[2], ',futsal,done,2026-11-04,2026-11-04,60,2,7,"said ""ouch""",Futsal with work,');
  assert.equal(rows[3], ",futsal,planned,2026-11-11,,,,,,Futsal,");
  assert.equal(rows.length, 5);
});

/** The old entries: a done one with a log, a planned one, a skipped one, one done on another day, one deleted, another plan's. */
function oldEntries(): Entry[] {
  return [
    newEntry({ id: "futsal-a", planId: "p", kind: "futsal", status: "done", day: MON + 2, doneDay: MON + 2, durationMin: 60, note: "good", title: "Futsal", updatedAt: 100 }),
    newEntry({ id: "futsal-b", planId: "p", kind: "futsal", day: MON + 9, durationMin: null, title: "Futsal", updatedAt: 200 }),
    newEntry({ id: "futsal-c", planId: "p", kind: "futsal", status: "skipped", day: MON + 4, updatedAt: 300 }),
    newEntry({ id: "futsal-d", planId: "p", kind: "futsal", status: "done", day: MON + 3, doneDay: MON + 4, title: "", updatedAt: 400 }),
    newEntry({ id: "futsal-e", planId: "p", kind: "futsal", day: MON + 5, deletedAt: 9, updatedAt: 500 }),
    newEntry({ id: entryId("p", "long"), planId: "p", sessionId: "long", kind: "session", status: "done", day: MON + 6, doneDay: MON + 6, updatedAt: 600 }),
  ];
}
const entryId = (planId: string, sid: string) => `${planId}:${sid}`;

/** A device's records after applying a conversion. */
function apply(state: { entries: Map<string, Entry>; items: Map<number, Item>; completions: Map<string, Completion> }, c: ReturnType<typeof convertFutsal>) {
  for (const e of c.entries) state.entries.set(e.id, e);
  for (const i of c.items) state.items.set(i.id, i);
  for (const x of c.completions) state.completions.set(`${x.itemId}:${x.day}`, x);
}
const fresh = () => ({ entries: new Map(oldEntries().map((e) => [e.id, e])), items: new Map<number, Item>(), completions: new Map<string, Completion>() });

test("convertFutsal: each old game becomes an untimed event with its tick and log; the old entry kept, marked", () => {
  const c = convertFutsal(oldEntries(), []);
  const a = futsalItemId("futsal-a"), b = futsalItemId("futsal-b"), dd = futsalItemId("futsal-d");
  assert.deepEqual(c.items.map((i) => [i.id, i.type, i.title, i.startDay! - MON, i.endDay! - MON, i.startMin, i.allDay, i.freq, i.futsal, i.createdAt, i.updatedAt]), [
    [a, "EVENT", "Futsal", 2, 2, null, true, "NONE", undefined, 100, 100],
    [b, "EVENT", "Futsal", 9, 9, null, true, "NONE", undefined, 200, 200],
    [dd, "EVENT", "Futsal", 4, 4, null, true, "NONE", undefined, 400, 400], // on the day it was done
  ]);
  assert.deepEqual(c.completions, [{ itemId: a, day: MON + 2, completedAt: 100 }, { itemId: dd, day: MON + 4, completedAt: 400 }]);
  assert.deepEqual(c.entries.map((e) => [e.id, e.convertedTo ?? null, e.itemId ?? null, e.day, e.durationMin, e.note, e.updatedAt]), [
    [futsalLogId(a, MON + 2), null, a, null, 60, "good", 100],
    ["futsal-a", a, null, MON + 2, 60, "good", 101],
    ["futsal-b", b, null, MON + 9, null, "", 201],
    ["futsal-c", 0, null, MON + 4, null, "", 301], // skipped: nothing, but marked
    ["futsal-d", dd, null, MON + 3, null, "", 401],
  ]);
  // A title that doesn't say futsal gets the mark set.
  const [named] = convertFutsal([newEntry({ id: "futsal-x", planId: "p", kind: "futsal", day: MON, title: "Football" })], []).items;
  assert.deepEqual([named.title, named.futsal, isFutsal(named)], ["Football", true, true]);
});

test("convertFutsal: twice is once, and two devices write the same records", () => {
  const one = fresh();
  apply(one, convertFutsal(one.entries.values(), one.items.values()));
  const after = JSON.stringify([[...one.entries], [...one.items], [...one.completions]]);
  const again = convertFutsal(one.entries.values(), one.items.values());
  assert.deepEqual(again, { items: [], completions: [], entries: [] });

  const pc = fresh(), phone = fresh();
  const a = convertFutsal(pc.entries.values(), []), b = convertFutsal(phone.entries.values(), []);
  assert.deepEqual(a, b);
  apply(pc, a); apply(phone, b);
  assert.equal(JSON.stringify([[...pc.entries], [...pc.items], [...pc.completions]]), after);
  assert.equal(JSON.stringify([[...phone.entries], [...phone.items], [...phone.completions]]), after);
});

test("convertFutsal: an event already there from another device is left as edited, only the entry is marked", () => {
  const id = futsalItemId("futsal-a");
  const moved = event({ id, startDay: MON + 3, endDay: MON + 3, updatedAt: 999 });
  const c = convertFutsal(oldEntries().slice(0, 1), [moved]);
  assert.deepEqual([c.items, c.completions, c.entries.map((e) => [e.id, e.convertedTo])], [[], [], [["futsal-a", id]]]);
});

test("the converted games show as the old ones did, and the pull converts in memory first", () => {
  const s = fresh();
  apply(s, convertFutsal(s.entries.values(), []));
  const es = trainingEntries([plan], s.entries.values(), s.items.values(), s.completions.values());
  const games = [...es.values()].filter((e) => e.kind === "futsal").map((e) => [e.day! - MON, e.status, e.durationMin]);
  assert.deepEqual(games, [[2, "done", 60], [4, "done", null], [9, "planned", null]]);
  // Before any device converted: the pull's CSV is the same as after.
  const before = entriesWithGames([plan], oldEntries(), [], []);
  assert.equal(logCsv(plan, before.values()), logCsv(plan, es.values()));
});
