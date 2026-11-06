// Sports events on Training (item 267): an event of the Sports category is a game, futsal when its title
// says futsal or football, else another sport; events of other categories never are; 240's data still reads.
import assert from "node:assert/strict";
import { test } from "node:test";
import { brokenNow, brokenRules, ruleWords } from "../src/domain/placement.ts";
import {
  dayOf, futsalGames, futsalLogId, gameKind, isFutsal, isGame, isGentleSport, isSportsCategory, logCsv, phaseView, readPlan, sportsCategoryIds, trainingEntries,
} from "../src/domain/training.ts";
import { weekBar } from "../src/domain/trainingWeek.ts";
import { type Category, type Item, newItem } from "../src/domain/types.ts";

const d = (iso: string) => dayOf(iso)!;
const MON = d("2026-11-02");
const plan = readPlan({
  version: 1, plan: { id: "p", name: "P", start: "2026-11-02", end: "2026-11-08" },
  phases: [{
    name: "W1", start: "2026-11-02", end: "2026-11-08",
    placement: [
      { id: "no-futsal-before-long", level: "avoid", check: { type: "not_day_before", a: { kind: "futsal" }, b: { day_type: "long" } }, text: "No futsal the day before the long run", why: "Tired legs." },
      { id: "rest", level: "avoid", check: { type: "rest_days", min: 1 }, text: "A rest day a week", why: "Rest." },
    ],
    sessions: [{ id: "long", title: "Long run", detail: "10 km", kind: "run", day_type: "long", default_date: "2026-11-08" }],
  }],
}).plan!;

const cat = (id: number, name: string): Category => ({ id, name, color: 0, defaultAlert: "REMINDER" });
const SPORTS = sportsCategoryIds([cat(1, "Personal"), cat(5, "Sports"), cat(6, "Health")]);
let n = 100;
const event = (fields: Partial<Item>) => newItem({ id: n++, type: "EVENT", title: "Tennis", startDay: MON + 2, endDay: MON + 2, allDay: true, createdAt: 1, updatedAt: 1, ...fields });

test("the Sports category: any name with the word sport or sports, any case", () => {
  for (const [name, want] of [["Sports", true], ["sport", true], ["SPORT & fitness", true], ["My sports", true], ["Personal", false], ["Transport", false], ["Sporty", false]] as const) {
    assert.equal(isSportsCategory({ name }), want, name);
  }
  assert.deepEqual([...SPORTS], [5]);
});

test("gameKind: the Sports category's events are games, futsal by the title; other categories never; 240's marks still read", () => {
  const cases: [Partial<Item>, ReturnType<typeof gameKind>][] = [
    [{ categoryId: 5, title: "Tennis" }, "sport"],
    [{ categoryId: 5, title: "Futsal with work" }, "futsal"],
    [{ categoryId: 5, title: "5-a-side FOOTBALL" }, "futsal"],
    [{ categoryId: 5, title: "Futsal", futsal: false }, "futsal"], // the switch is gone: the title decides
    [{ categoryId: 5, title: "Tennis", type: "TASK" }, null],
    [{ categoryId: 1, title: "Futsal" }, null], // another category: never on Training
    [{ categoryId: 1, title: "Football" }, null],
    [{ categoryId: 1, title: "Football", futsal: true }, "futsal"], // marked with 240's switch: still counts
    [{ categoryId: null, title: "Futsal" }, "futsal"], // 240's games (added from Training, converted): no category
    [{ categoryId: null, title: "Futsal", futsal: false }, null],
    [{ categoryId: null, title: "Football" }, null],
    [{ categoryId: null, title: "Tennis" }, null],
  ];
  for (const [f, want] of cases) assert.equal(gameKind(event(f), SPORTS), want, JSON.stringify(f));
  assert.equal(isFutsal(event({ categoryId: 5, title: "Football" }), SPORTS), true);
  assert.equal(isGame(event({ categoryId: 5, title: "Climbing" }), SPORTS), true);
  assert.equal(isGame(event({ categoryId: 5, title: "Climbing" })), false); // no Sports category known
});

test("another sport shows with its own title and counts for the days; its CSV kind is sport", () => {
  const tennis = event({ categoryId: 5, title: "Tennis", startDay: MON + 5, endDay: MON + 5 }); // the day before the long run
  const futsal = event({ categoryId: 5, title: "Futsal", startDay: MON + 2, endDay: MON + 2 });
  const dentist = event({ categoryId: 6, title: "Dentist", startDay: MON + 3, endDay: MON + 3 });
  const games = futsalGames({ start: MON, end: MON + 6 }, [tennis, futsal, dentist], [], new Map(), SPORTS);
  assert.deepEqual(games.map((g) => [g.item.title, g.sport]), [["Futsal", false], ["Tennis", true]]);

  const es = trainingEntries([plan], [], [tennis, futsal, dentist], [{ itemId: futsal.id, day: MON + 2, completedAt: 1 }], SPORTS);
  const t = es.get(futsalLogId(tennis.id, MON + 5))!;
  assert.deepEqual([t.kind, t.title, t.sport], ["futsal", "Tennis", true]);
  assert.equal(es.get(futsalLogId(futsal.id, MON + 2))!.sport, undefined);
  const v = phaseView(plan, 0, es, es.values());
  assert.deepEqual(v.days.map((x) => x.items.map((i) => i.session?.id ?? i.entry.title)), [[], [], ["Futsal"], [], [], ["Tennis"], ["long"]]);
  assert.deepEqual(weekBar(v.days, []).segments.map((s) => s.kind), ["futsal", "futsal", "run"]);
  const rows = logCsv(plan, es.values()).split("\r\n");
  assert.equal(rows[2], ",futsal,done,2026-11-04,2026-11-04,,,,,Futsal,");
  assert.equal(rows[3], ",sport,planned,2026-11-07,,,,,,Tennis,");
});

test("323: a sport the day before the long run breaks futsal's rule, in its own name; a walk or yoga doesn't", () => {
  const on = (title: string) => {
    const e = event({ categoryId: 5, title, startDay: MON + 5, endDay: MON + 5 });
    return { es: trainingEntries([plan], [], [e], [], SPORTS), id: futsalLogId(e.id, MON + 5) };
  };
  const b = on("Basketball");
  const now = brokenNow(plan, b.es).get(b.id)!;
  assert.deepEqual(now.map((x) => x.rule.id), ["no-futsal-before-long"]);
  assert.equal(ruleWords(now[0]).text, "No basketball the day before the long run");
  assert.deepEqual(brokenRules(plan, b.es, { session: "long" }, MON + 6).map((x) => ruleWords(x).text), ["No basketball the day before the long run"]);
  for (const title of ["Walk", "Morning yoga", "dog walking"]) {
    const g = on(title);
    assert.equal(brokenNow(plan, g.es).size, 0, title);
    assert.equal(brokenRules(plan, g.es, { futsal: g.id }, MON + 5).length, 0, title);
  }
  // 367: bike rides (e-bike too), walks and hikes are whole-day only, never sprinty, in English and Portuguese.
  for (const title of ["E-bike to work", "Bike ride", "Hike Sintra", "ebike home", "Cycling", "Bicicleta", "Caminhada na praia", "Trilho da Arrábida"]) {
    assert.equal(isGentleSport(title), true, title);
    const g = on(title);
    assert.equal(brokenNow(plan, g.es).size, 0, title);
    assert.equal(brokenRules(plan, g.es, { futsal: g.id }, MON + 5).length, 0, title);
  }
  // It has to be the word.
  assert.equal(isGentleSport("Sidewalk sprints"), false);
  assert.equal(isGentleSport("Bikram yoga"), true);   // yoga, not the bike
  assert.equal(isGentleSport("Spin class"), false);
  assert.equal(isGentleSport("Futsal"), false);
  assert.equal(isGentleSport("Padel"), false);
  assert.equal(isGentleSport("Sport"), false);
});

test("without a Sports category, only 240's futsal shows (as before)", () => {
  const es = trainingEntries([plan], [], [event({ categoryId: null, title: "Futsal" }), event({ categoryId: 5, title: "Tennis" })], []);
  assert.deepEqual([...es.values()].map((e) => e.title), ["Futsal"]);
});

test("the Settings switch decides once set; until then the name does (278)", () => {
  assert.equal(isSportsCategory({ name: "Sports", sport: false }), false);
  assert.equal(isSportsCategory({ name: "Futsal club", sport: true }), true);
  assert.equal(isSportsCategory({ name: "Futsal club" }), false);
  assert.equal(isSportsCategory({ name: "Sports" }), true);
  const picked = sportsCategoryIds([{ ...cat(5, "Sports"), sport: false }, { ...cat(7, "Running club"), sport: true }, { ...cat(8, "Gym"), sport: true }, cat(9, "Sport")]);
  assert.deepEqual([...picked].sort(), [7, 8, 9]);
  // An event of a category switched off leaves Training; one switched on joins it.
  assert.equal(gameKind(event({ categoryId: 5, title: "Tennis" }), picked), null);
  assert.equal(gameKind(event({ categoryId: 7, title: "Parkrun" }), picked), "sport");
  assert.equal(gameKind(event({ categoryId: 8, title: "Futsal" }), picked), "futsal");
});
