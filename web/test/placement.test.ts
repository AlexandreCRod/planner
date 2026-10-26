import assert from "node:assert/strict";
import { test } from "node:test";
import { weekday } from "../src/domain/dates.ts";
import { type Breach, brokenNow, brokenRules, dayFit, worstLevel } from "../src/domain/placement.ts";
import { type Entry, dayOf, entryId, newEntry, readPlan } from "../src/domain/training.ts";

// A made-up plan: two weeks, Mon 1 – Sun 14 Mar 2027 (the real one stays out of this public repo).
const D = (iso: string) => dayOf(iso)!;
const MON = D("2027-03-01"), TUE = MON + 1, WED = MON + 2, THU = MON + 3, FRI = MON + 4, SAT = MON + 5, SUN = MON + 6;
const rule = (id: string, level: string, check: Record<string, unknown>) => ({ id, level, check, text: `Rule ${id}`, why: level === "note" ? "" : "Because." });

// The placement list as the plan session writes it (one week's, trimmed, whys shortened).
const REAL_LIST = [
  { id: "futsal-before-long", level: "avoid", check: { type: "not_day_before", a: { kind: "futsal" }, b: { day_type: "long" } }, text: "No futsal the day before the long run", why: "Tired legs." },
  { id: "futsal-same-day-long", level: "avoid", check: { type: "not_same_day", a: { kind: "futsal" }, b: { day_type: "long" } }, text: "No futsal on the long-run day", why: "Two big loads." },
  { id: "gym-before-quality", level: "avoid", check: { type: "not_day_before", a: { kind: "gym" }, b: { tag: "quality" } }, text: "No gym the day before the quality run", why: "Sore legs." },
  { id: "gym-gap", level: "ideally", check: { type: "gap", a: { kind: "gym" }, min_days: 2, max_days: 3 }, text: "Gym sessions about 2–3 days apart", why: "Recovery." },
  { id: "quality-before-long", level: "avoid", check: { type: "min_days_before", a: { tag: "quality" }, b: { day_type: "long" }, days: 2 }, text: "Quality run at least 2 days before the long run", why: "Recover first." },
  { id: "runs-same-day", level: "ideally", check: { type: "not_same_day", a: { kind: "run" }, b: { kind: "run" } }, text: "One run per day", why: "Spread it." },
  { id: "long-weekend", level: "ideally", check: { type: "weekdays", a: { day_type: "long" }, days: ["sat", "sun"] }, text: "Long run on Saturday or Sunday", why: "The anchor." },
  { id: "rest-day", level: "avoid", check: { type: "rest_days", min: 1 }, text: "At least one full rest day a week", why: "Recovery." },
  { id: "days-in-a-row", level: "ideally", check: { type: "max_in_a_row", max: 4 }, text: "At most 4 training days in a row", why: "Fatigue." },
  { id: "futsal-max-1", level: "ideally", check: { type: "max_count", a: { kind: "futsal" }, max: 1 }, text: "Futsal only once this week", why: "Adapt first." },
  { id: "futsal-by-thu", level: "avoid", check: { type: "not_after", a: { kind: "futsal" }, date: "2027-03-04" }, text: "No futsal after Thursday", why: "Too close." },
  { id: "primer-by-tue", level: "avoid", check: { type: "not_after", a: { session: "g1" }, date: "2027-03-02" }, text: "Primer by Tuesday", why: "Fresh legs." },
  { id: "no-futsal", level: "avoid", check: { type: "none", a: { kind: "futsal" } }, text: "No futsal in race week", why: "The race." },
  { id: "run-then-gym", level: "note", check: { type: "same_day_note", a: { kind: "run" }, b: { kind: "gym" } }, text: "Good pairing: run first, then lift.", why: "" },
];

function rawWith(week1: unknown[], week2: unknown[] = []) {
  return {
    version: 1, plan: { id: "p", start: "2027-03-01", end: "2027-03-14" }, exercises: [],
    phases: [
      {
        name: "Week 1", start: "2027-03-01", end: "2027-03-07", placement: week1, sessions: [
          { id: "e1", title: "Easy run", kind: "run", day_type: "training" },
          { id: "q1", title: "Intervals", kind: "run", day_type: "training", tags: ["quality"] },
          { id: "g1", title: "Gym A", kind: "gym" },
          { id: "g2", title: "Gym B", kind: "gym" },
          { id: "l1", title: "Long run", kind: "run", day_type: "long" },
          { id: "o1", title: "Optional run", kind: "run", optional: true },
        ],
      },
      {
        name: "Week 2", start: "2027-03-08", end: "2027-03-14", placement: week2, sessions: [
          { id: "e2", title: "Easy run", kind: "run" },
          { id: "q2", title: "Tempo", kind: "run", tags: ["quality"] },
          { id: "r1", title: "Race", kind: "run", day_type: "race", default_date: "2027-03-14", locked: true },
        ],
      },
    ],
  };
}
function planWith(week1: unknown[], week2: unknown[] = []) {
  const r = readPlan(rawWith(week1, week2));
  assert.deepEqual(r.problems, []);
  return r.plan!;
}
const only = (...ids: string[]) => REAL_LIST.filter((r) => ids.includes(r.id));
const at = (sid: string, day: number | null, more: Partial<Entry> = {}) =>
  newEntry({ id: entryId("p", sid), planId: "p", sessionId: sid, kind: "session", day, ...more });
const futsal = (id: string, day: number, more: Partial<Entry> = {}) => newEntry({ id, planId: "p", kind: "futsal", day, ...more });
const map = (...es: Entry[]) => new Map(es.map((e) => [e.id, e]));
const ids = (bs: Breach[]) => bs.map((b) => b.rule.id);
const others = (b: Breach | undefined) => b?.others.map((it) => `${it.key}@${it.day - MON}`);

test("the dates are a Monday-first week", () => assert.deepEqual([weekday(MON), weekday(SUN)], [1, 7]));

test("placement: the plan session's list reads with no problems", () => {
  const p = planWith(REAL_LIST);
  const rules = p.phases[0].placement;
  assert.equal(rules.length, REAL_LIST.length);
  assert.deepEqual(rules.find((r) => r.id === "long-weekend")!.check, { type: "weekdays", a: { dayType: "long" }, days: [6, 7] });
  assert.deepEqual(rules.find((r) => r.id === "primer-by-tue")!.check, { type: "not_after", a: { sessions: ["g1"] }, day: TUE });
  assert.deepEqual(rules.find((r) => r.id === "gym-gap")!.check, { type: "gap", a: { kind: "gym" }, minDays: 2, maxDays: 3 });
  assert.deepEqual(p.phases[0].sessions[1].tags, ["quality"]);
  assert.deepEqual(p.phases[0].sessions[0].tags, []);
  assert.deepEqual(p.phases[1].placement, []);
});

test("placement: unknown types, levels, missing fields and sessions are problems; the rest still reads", () => {
  const { plan, problems } = readPlan(rawWith([
    rule("a", "avoid", { type: "far_apart", a: { kind: "run" } }),
    rule("b", "must", { type: "rest_days", min: 1 }),
    rule("c", "avoid", { type: "not_same_day", a: { kind: "run" } }),
    rule("d", "avoid", { type: "weekdays", a: { kind: "run" }, days: ["sat", "sunday"] }),
    rule("e", "avoid", { type: "not_after", a: { session: "t999" }, date: "2027-03-02" }),
    rule("f", "avoid", { type: "none", a: { kind: "swim" } }),
    rule("g", "avoid", { type: "max_count", a: { kind: "futsal" } }),
    { id: "h", level: "avoid", check: { type: "rest_days", min: 1 }, text: "No why" },
    rule("ok", "avoid", { type: "rest_days", min: 1 }),
  ]));
  assert.deepEqual(problems, [
    `Placement rule a in "Week 1" has check type "far_apart", which this Planner doesn't know.`,
    `Placement rule b in "Week 1" has level "must", which isn't avoid, ideally or note.`,
    `Placement rule c in "Week 1" check b is missing (what the rule applies to).`,
    `Placement rule d in "Week 1" has days it can't read (sunday); use mon, tue... sun.`,
    `Placement rule f in "Week 1" check a picks kind "swim", which isn't futsal or a session kind (run, gym, bike, physio, other).`,
    `Placement rule g in "Week 1" needs max, a whole number from 0.`,
    `Placement rule h in "Week 1" has no why.`,
    `Placement rule e in "Week 1" names session t999, which isn't in the plan.`,
  ]);
  // An unknown session is still a rule (it just never matches); the unreadable ones are left out.
  assert.deepEqual(plan!.phases[0].placement.map((r) => r.id), ["e", "ok"]);
});

test("not_day_before: gym the day before the long run", () => {
  const p = planWith([rule("gym-before-long", "avoid", { type: "not_day_before", a: { kind: "gym" }, b: { day_type: "long" } })]);
  const es = map(at("l1", SUN));
  const b = brokenRules(p, es, { session: "g1" }, SAT);
  assert.deepEqual(ids(b), ["gym-before-long"]);
  assert.deepEqual(others(b[0]), ["l1@6"]);
  assert.deepEqual(brokenRules(p, es, { session: "g1" }, FRI), []);
  // Moving the long run itself sees the gym on the day before.
  assert.deepEqual(others(brokenRules(p, map(at("g1", FRI)), { session: "l1" }, SAT)[0]), ["g1@4"]);
});

test("not_same_day: futsal on the long-run day, and a futsal selector", () => {
  const p = planWith(only("futsal-same-day-long", "futsal-before-long"));
  const es = map(at("l1", SUN));
  assert.deepEqual(ids(brokenRules(p, es, { futsal: null }, SUN)), ["futsal-same-day-long"]);
  assert.deepEqual(ids(brokenRules(p, es, { futsal: null }, SAT)), ["futsal-before-long"]);
  assert.deepEqual(brokenRules(p, es, { futsal: null }, FRI), []);
  // Already there: both the game and the long run are marked.
  const now = brokenNow(p, map(at("l1", SUN), futsal("f1", SAT)));
  assert.deepEqual([...now.keys()].sort(), ["f1", "l1"]);
  assert.deepEqual(others(now.get("l1")![0]), ["f1@5"]);
});

test("same selector on both sides means two different items", () => {
  const p = planWith(only("runs-same-day"));
  assert.deepEqual(brokenRules(p, map(), { session: "e1" }, TUE), []);
  const b = brokenRules(p, map(at("e1", TUE), at("l1", TUE)), { session: "q1" }, TUE);
  assert.equal(b.length, 1);
  assert.deepEqual(others(b[0]), ["e1@1", "l1@1"]);
  const now = brokenNow(p, map(at("e1", TUE), at("q1", TUE)));
  assert.deepEqual(now.get("e1")!.map((x) => others(x)), [["q1@1"]]);
  assert.deepEqual(now.get("q1")!.map((x) => others(x)), [["e1@1"]]);
});

test("min_days_before counts calendar days, and only a b after the a", () => {
  const p = planWith(only("quality-before-long"));
  const es = map(at("l1", SUN));
  assert.deepEqual(brokenRules(p, es, { session: "q1" }, FRI), []);
  assert.deepEqual(ids(brokenRules(p, es, { session: "q1" }, SAT)), ["quality-before-long"]);
  assert.deepEqual(ids(brokenRules(p, es, { session: "q1" }, SUN)), ["quality-before-long"]);
  assert.deepEqual(brokenRules(p, map(at("l1", WED)), { session: "q1" }, THU), []);
});

test("gap: each gym 2 to 3 days after the last", () => {
  const p = planWith(only("gym-gap"));
  const es = map(at("g1", MON));
  assert.deepEqual([TUE, WED, THU, FRI].map((d) => ids(brokenRules(p, es, { session: "g2" }, d)).length), [1, 0, 0, 1]);
  assert.deepEqual(others(brokenRules(p, es, { session: "g2" }, FRI)[0]), ["g1@0"]);
});

test("rest_days: a day in the phase with nothing on it", () => {
  const p = planWith(only("rest-day"));
  const es = map(at("e1", MON), at("q1", TUE), at("g1", WED), at("g2", THU), at("o1", FRI), at("l1", SAT));
  const b = brokenRules(p, es, { futsal: null }, SUN);
  assert.deepEqual(ids(b), ["rest-day"]);
  assert.deepEqual([b[0].others, b[0].span], [[], [MON, SUN]]);
  assert.deepEqual(brokenRules(p, es, { futsal: null }, SAT), []);
  // Breaking it marks the whole week.
  assert.equal(brokenNow(p, map(...es.values(), futsal("f1", SUN))).size, 7);
});

test("max_in_a_row: days in a row with anything on them", () => {
  const p = planWith([rule("row", "ideally", { type: "max_in_a_row", max: 2 })]);
  const es = map(at("e1", MON), futsal("f1", TUE));
  const b = brokenRules(p, es, { session: "g1" }, WED);
  assert.deepEqual([ids(b), b[0].span], [["row"], [MON, WED]]);
  assert.deepEqual(brokenRules(p, es, { session: "g1" }, THU), []);
  // Marks what's on the days past the max only.
  assert.deepEqual([...brokenNow(p, map(...es.values(), at("g1", WED))).keys()], ["g1"]);
});

test("max_in_a_row runs across the phase boundary, each day held to its own phase's rule", () => {
  const p = planWith([rule("row", "ideally", { type: "max_in_a_row", max: 4 })], [rule("row", "ideally", { type: "max_in_a_row", max: 2 })]);
  const es = map(at("g1", FRI), at("l1", SAT), at("g2", SUN));
  // Mon 8 is the 4th day in a row: fine for week 1's 4, not for week 2's 2.
  const b = brokenRules(p, es, { session: "e2" }, SUN + 1);
  assert.deepEqual([ids(b), b[0].phase, b[0].span], [["row"], 1, [FRI, SUN + 1]]);
  assert.deepEqual(brokenNow(p, es).size, 0);
  const p2 = planWith([rule("row", "ideally", { type: "max_in_a_row", max: 2 })], [rule("row", "ideally", { type: "max_in_a_row", max: 4 })]);
  assert.deepEqual(brokenRules(p2, map(at("l1", SAT), at("g2", SUN)), { session: "e2" }, SUN + 1), []);
  assert.deepEqual(ids(brokenRules(p2, map(at("g1", FRI), at("l1", SAT)), { session: "g2" }, SUN)), ["row"]);
});

test("rules between two items see across the phase boundary", () => {
  const p = planWith([], [rule("futsal-before-quality", "ideally", { type: "not_day_before", a: { kind: "futsal" }, b: { tag: "quality" } })]);
  const b = brokenRules(p, map(at("q2", SUN + 1)), { futsal: null }, SUN);
  assert.deepEqual([ids(b), b[0].phase], [["futsal-before-quality"], 1]);
});

test("weekdays, not_after and none", () => {
  const p = planWith(only("long-weekend", "primer-by-tue", "futsal-by-thu"), [rule("no-futsal", "avoid", { type: "none", a: { kind: "futsal" } })]);
  assert.deepEqual(brokenRules(p, map(), { session: "l1" }, SAT), []);
  assert.deepEqual(ids(brokenRules(p, map(), { session: "l1" }, FRI)), ["long-weekend"]);
  assert.deepEqual(brokenRules(p, map(), { session: "g1" }, TUE), []);
  assert.deepEqual(ids(brokenRules(p, map(), { session: "g1" }, WED)), ["primer-by-tue"]);
  assert.deepEqual(brokenRules(p, map(), { futsal: null }, THU), []);
  assert.deepEqual(ids(brokenRules(p, map(), { futsal: null }, FRI)), ["futsal-by-thu"]);
  assert.deepEqual(ids(brokenRules(p, map(), { futsal: null }, SUN + 3)), ["no-futsal"]);
});

test("max_count: placing one too many breaks it; the later ones are marked", () => {
  const p = planWith(only("futsal-max-1"));
  assert.deepEqual(brokenRules(p, map(), { futsal: null }, MON), []);
  const b = brokenRules(p, map(futsal("f1", WED)), { futsal: null }, MON);
  assert.deepEqual([ids(b), others(b[0])], [["futsal-max-1"], ["f1@2"]]);
  assert.deepEqual([...brokenNow(p, map(futsal("f1", WED), futsal("f2", MON))).keys()], ["f1"]);
  // Moving the one game there is doesn't count it twice.
  assert.deepEqual(brokenRules(p, map(futsal("f1", WED)), { futsal: "f1" }, FRI), []);
});

test("skipped and unplaced sessions don't count", () => {
  const p = planWith([...only("runs-same-day", "rest-day"), rule("gym-before-long", "avoid", { type: "not_day_before", a: { kind: "gym" }, b: { day_type: "long" } })]);
  assert.deepEqual(brokenRules(p, map(at("l1", SUN, { status: "skipped" })), { session: "g1" }, SAT), []);
  assert.deepEqual(brokenRules(p, map(at("l1", null)), { session: "g1" }, SAT), []);
  // The optional run has no day: Tuesday holds one run only.
  assert.deepEqual(brokenRules(p, map(), { session: "e1" }, TUE), []);
  const full = map(at("e1", MON), at("q1", TUE), at("g1", WED), at("g2", THU), at("o1", null), at("l1", SAT));
  assert.deepEqual(brokenRules(p, full, { futsal: null }, FRI), []);
  assert.deepEqual(brokenRules(p, map(...full.values(), futsal("f1", SUN, { status: "skipped" })), { futsal: null }, FRI), []);
});

test("a done session counts on the day it was done", () => {
  const p = planWith([rule("gym-before-long", "avoid", { type: "not_day_before", a: { kind: "gym" }, b: { day_type: "long" } })]);
  const es = map(at("l1", SUN, { status: "done", doneDay: SAT }));
  assert.deepEqual(ids(brokenRules(p, es, { session: "g1" }, FRI)), ["gym-before-long"]);
  assert.deepEqual(brokenRules(p, es, { session: "g1" }, SAT), []);
  const done = brokenRules(p, map(futsal("f1", TUE, { status: "done", doneDay: FRI })), { session: "l1" }, SAT);
  assert.deepEqual(done, []);
});

test("a moved item's old day no longer counts", () => {
  const p = planWith([rule("gym-before-long", "avoid", { type: "not_day_before", a: { kind: "gym" }, b: { day_type: "long" } })]);
  const es = map(at("g1", SAT), at("l1", SUN));
  assert.deepEqual([...brokenNow(p, es).keys()], ["g1", "l1"]);
  assert.deepEqual(brokenRules(p, es, { session: "g1" }, THU), []);
  assert.deepEqual(brokenRules(p, es, { session: "l1" }, MON), []);
});

test("notes are listed, never breaches", () => {
  const p = planWith(only("run-then-gym", "runs-same-day"));
  const es = map(at("e1", TUE));
  const b = brokenRules(p, es, { session: "g1" }, TUE);
  assert.deepEqual([ids(b), b[0].rule.level, others(b[0])], [["run-then-gym"], "note", ["e1@1"]]);
  assert.equal(worstLevel(b), "none");
  assert.equal(dayFit(p, es, { session: "g1" }, [TUE]).get(TUE), "none");
  assert.equal(brokenNow(p, map(at("e1", TUE), at("g1", TUE))).size, 0);
  // Worst first: a broken rule comes before a note.
  assert.deepEqual(ids(brokenRules(p, map(at("e1", TUE), at("g1", TUE)), { session: "q1" }, TUE)), ["runs-same-day", "run-then-gym"]);
});

test("dayFit: the worst level on each day", () => {
  const p = planWith(only("futsal-before-long", "futsal-same-day-long", "runs-same-day", "gym-gap", "long-weekend", "run-then-gym"));
  const fit = dayFit(p, map(at("l1", SUN), at("e1", TUE)), { futsal: null }, [MON, TUE, WED, THU, FRI, SAT, SUN]);
  assert.deepEqual([...fit.values()], ["none", "none", "none", "none", "none", "avoid", "avoid"]);
  const runFit = dayFit(p, map(at("l1", SUN), at("e1", TUE)), { session: "q1" }, [MON, TUE, SUN]);
  assert.deepEqual([...runFit.values()], ["none", "ideally", "ideally"]);
  assert.deepEqual(brokenRules(p, map(), { session: "nope" }, MON), []);
});
