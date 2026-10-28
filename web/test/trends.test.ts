import assert from "node:assert/strict";
import { test } from "node:test";
import { type Entry, type Lift, dayOf, entryId, isoOf, newEntry, readPlan } from "../src/domain/training.ts";
import {
  type Hidden, type Run, type WeighIn, bodyWeights, hiddenId, hiddenWeighIns, carbsTarget, dayType, e1rmOf, easyRuns, kcalTarget, liftPoints, longRuns, longestIn, readLiftHistory, readMeals,
  readRuns, readSleep, readWeights, rpeFor, sourceName,
  targetRpeOf, topRpe, topSetOf, trendAt, weeklyChange, weeklyHardSets, weeklyKm, weighInsCsv, weightTrend,
} from "../src/domain/trends.ts";

const d = (iso: string) => dayOf(iso)!;
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

// ---------- Lifts ----------

let n = 0;
const lift = (sets: [number | null, number | null][], extra: Partial<Lift> = {}): Lift => ({
  id: `l${++n}`, planId: "p", sessionId: "s1", planned: "x001", exercise: "x001", day: 100,
  sets: sets.map(([kg, reps]) => ({ kg, reps, done: true })), rpe: 7, pain: null, note: "", name: "Front squat", target: "3×5", updatedAt: 1, ...extra,
});

test("e1RM: heaviest done set of 1 to 6 reps, with the RPE, to the nearest 0.5 kg", () => {
  assert.equal(e1rmOf(lift([[60, 5]])), 76);                                   // 60 × (1 + (5 + 3) ÷ 30)
  assert.equal(e1rmOf(lift([[60, 5]], { rpe: null })), null);                  // no RPE, no number
  assert.equal(e1rmOf(lift([[50, 8], [40, 12]])), null);                       // only sets over 6 reps
  assert.equal(e1rmOf(lift([[50, 8], [40, 6]], { rpe: 10 })), 48);             // the 8-rep set is skipped: 40 × (1 + 6 ÷ 30)
  assert.equal(e1rmOf(lift([[60, 5], [70, 3]], { rpe: 8 })), 81.5);            // the heavier set, even with fewer reps: 81.67 → 81.5
  assert.equal(e1rmOf(lift([[80, 3], [80, 5]], { rpe: 9 })), 96);              // same weight: the one with more reps
  assert.equal(e1rmOf(lift([[72.5, 5]], { rpe: 8 })), 89.5);                   // 89.42 → 89.5
  assert.equal(e1rmOf(lift([[100, 3]], { sets: [{ kg: 120, reps: 3, done: false }, { kg: 100, reps: 3, done: true }] })), 120);   // not done: ignored (the 100 kg set: 100 × (1 + 6 ÷ 30))
  assert.equal(e1rmOf(lift([[0, 5], [null, 5], [60, 0]])), null);              // no weight, or no reps
});

test("the top set is the heaviest done set at any reps", () => {
  assert.deepEqual(topSetOf(lift([[60, 5], [100, 8], [100, 10]])), { kg: 100, reps: 10 });
  assert.deepEqual(topSetOf(lift([[60, 5]], { sets: [{ kg: 120, reps: 1, done: false }, { kg: 60, reps: 5, done: true }] })), { kg: 60, reps: 5 });
  assert.equal(topSetOf(lift([[null, 12], [0, 10]])), null);
});

test("lift points: one per time lifted, across plans, by the exercise actually done", () => {
  const a = lift([[60, 5]], { day: 110, planId: "p1", sessionId: "s2", pain: 2 });
  const b = lift([[65, 5]], { day: 100, planId: "p0", sessionId: "s9", rpe: null });
  const swapped = lift([[50, 8]], { day: 105, planned: "x001", exercise: "x002" });           // done as another exercise
  const none = lift([[60, 5]], { day: 120, sets: [{ kg: 60, reps: 5, done: false }] });         // nothing done
  assert.deepEqual(liftPoints([a, swapped, none, b], "x001"), [
    { day: 100, topKg: 65, topReps: 5, e1rm: null, rpeBasis: null, pain: null, planId: "p0", sessionId: "s9", source: "planner" },
    { day: 110, topKg: 60, topReps: 5, e1rm: 76, rpeBasis: "logged", pain: 2, planId: "p1", sessionId: "s2", source: "planner" },
  ]);
  assert.equal(liftPoints([a, b], "x999").length, 0);
});

test("the top of a plan's RPE", () => {
  assert.deepEqual(["6–7", "7", "5-6", "7.5", "", "easy", "RPE 12"].map(topRpe), [7, 7, 6, 7.5, null, null, null]);
});

test("a lift without an RPE: the session's target (assumed), else a lower bound for imports only", () => {
  const plan = readPlan({
    version: 1, plan: { id: "p", start: "2026-10-26", end: "2026-11-29" },
    exercises: [{ id: "x001", name: "Front squat" }, { id: "x002", name: "RDL" }],
    phases: [{
      name: "Weeks", start: "2026-10-26", end: "2026-11-29", sessions: [
        { id: "s1", title: "Gym A", kind: "gym", default_date: null, exercises: [
          { exercise: "x001", group: "warm-up", sets: "2", reps: "5", rpe: "" },
          { exercise: "x001", sets: "3", reps: "5", rpe: "6–7" },
          { exercise: "x002", sets: "3", reps: "6", rpe: "7–8" },
        ] },
        { id: "s2", title: "Gym B", kind: "gym", default_date: null, exercises: [{ exercise: "x001", sets: "3", reps: "5", rpe: "" }] },
      ],
    }],
  }).plan!;
  const noRpe = (extra: Partial<Lift> = {}) => lift([[60, 5]], { rpe: null, ...extra });
  assert.equal(targetRpeOf([plan], noRpe()), 7);                                 // the main sets' 6–7, not the warm-up's none
  assert.equal(targetRpeOf([plan], noRpe({ planned: "x002", exercise: "x001" })), 8);   // a swap keeps the planned slot's target
  assert.equal(targetRpeOf([plan], noRpe({ sessionId: "s2" })), null);           // no target
  assert.equal(targetRpeOf([plan], noRpe({ planId: "gone" })), null);
  assert.equal(targetRpeOf([], noRpe()), null);

  assert.deepEqual(rpeFor(lift([[60, 5]], { rpe: 9 }), 7), { rpe: 9, basis: "logged" });    // a logged RPE always wins
  assert.deepEqual(rpeFor(noRpe(), 7), { rpe: 7, basis: "assumed" });
  assert.equal(rpeFor(noRpe(), null), null);                                      // a plan lift is never RPE 10
  assert.deepEqual(rpeFor(noRpe(), null, true), { rpe: 10, basis: "lowerBound" });
  assert.equal(e1rmOf(noRpe(), 10), 70);                                          // plain Epley: 60 × (1 + 5 ÷ 30)

  const points = liftPoints([noRpe({ day: 101 }), noRpe({ day: 102, sessionId: "s2" }), lift([[60, 5]], { day: 103, rpe: 8 })], "x001", [plan]);
  assert.deepEqual(points.map((p) => [p.e1rm, p.rpeBasis]), [[76, "assumed"], [null, null], [74, "logged"]]);   // RPE 7: 60 × (1 + 8 ÷ 30); RPE 8: 60 × (1 + 7 ÷ 30)
});

test("weekly hard sets: every Monday-first week of the range, empty ones as 0", () => {
  const mon = d("2026-11-02");   // a Monday
  const ls = [
    lift([[60, 5], [60, 5], [60, 5]], { day: mon + 1 }),
    lift([[60, 5]], { day: mon + 6, sets: [{ kg: 60, reps: 5, done: true }, { kg: 60, reps: 5, done: false }, { kg: 60, reps: 0, done: true }] }),
    lift([[60, 5], [60, 5]], { day: mon + 22, exercise: "x002" }),     // 3 weeks later, a different exercise in the list
    lift([[60, 5], [60, 5]], { day: mon + 8, exercise: "x003" }),      // not one of the exercises asked about
  ];
  assert.deepEqual(weeklyHardSets(ls, ["x001", "x002"], mon, mon + 27), [
    { weekStart: mon, sets: 4 }, { weekStart: mon + 7, sets: 0 }, { weekStart: mon + 14, sets: 0 }, { weekStart: mon + 21, sets: 2 },
  ]);
  // A range that starts and ends mid-week still gives whole weeks.
  assert.deepEqual(weeklyHardSets(ls, new Set(["x001"]), mon + 3, mon + 4), [{ weekStart: mon, sets: 4 }]);
  assert.deepEqual(weeklyHardSets([], ["x001"], mon, mon + 6), [{ weekStart: mon, sets: 0 }]);
});

// ---------- Runs ----------

const run = (id: string, day: string, extra: Partial<Run> = {}): Run => ({
  id, day: d(day), time: null, title: "", sessionId: null, type: "easy", distanceKm: 5, durationS: 1800, paceSPerKm: 360,
  avgHr: 140, maxHr: 160, cadenceSpm: 170, ascentM: 20, ...extra,
});

test("weekly km: Monday weeks, zeros included, whole weeks", () => {
  const runs = [run("a", "2026-11-02", { distanceKm: 10 }), run("b", "2026-11-18", { distanceKm: 5.1 }), run("c", "2026-11-19", { distanceKm: 4.2 }), run("e", "2026-11-04", { distanceKm: null })];
  assert.deepEqual(weeklyKm(runs, d("2026-11-02"), d("2026-11-22")), [
    { weekStart: d("2026-11-02"), km: 10 }, { weekStart: d("2026-11-09"), km: 0 }, { weekStart: d("2026-11-16"), km: 9.3 },
  ]);
  assert.deepEqual(weeklyKm(runs, d("2026-11-04"), d("2026-11-04")), [{ weekStart: d("2026-11-02"), km: 10 }]);
});

test("long runs, easy runs for pace against heart rate, and the longest in the last 30 days", () => {
  const runs = [
    run("c", "2026-10-20", { type: "long", distanceKm: 16 }),
    run("a", "2026-09-01", { type: "long", distanceKm: 12, avgHr: null }),
    run("b", "2026-10-05", { avgHr: 148 }),
    run("x", "2026-10-06", { avgHr: 149 }),
    run("y", "2026-10-07", { paceSPerKm: null }),
    run("z", "2026-10-08", { type: "quality", distanceKm: 8, avgHr: 165 }),
    run("w", "2026-10-09", { paceSPerKm: 541, avgHr: 120 }),
    run("v", "2026-10-10", { paceSPerKm: 540, avgHr: 125 }),
  ];
  assert.deepEqual(longRuns(runs).map((r) => r.id), ["a", "c"]);
  assert.deepEqual(easyRuns(runs).map((r) => r.id), ["b", "v", "c"]);    // 148 and 9:00 /km count; no pace, no heart rate, too high or slower: out
  assert.deepEqual(easyRuns(runs, 140).map((r) => r.id), ["v", "c"]);
  assert.equal(longestIn(runs, d("2026-10-26")), 16);
  assert.equal(longestIn(runs, d("2026-10-26"), 5), null);               // nothing in the last 5 days
  assert.equal(longestIn(runs, d("2026-09-30")), 12);                    // a 30-day window ending on the 30th starts on the 1st
  assert.equal(longestIn(runs, d("2026-10-01")), null);                  // and one ending on the 1st has left it behind
  assert.equal(longestIn(runs, d("2026-10-06")), 5);
});

// ---------- Weight ----------

const w = (day: number, kg: number, extra: Partial<WeighIn> = {}): WeighIn => ({
  id: `w${++n}`, day, time: null, kg, note: "", updatedAt: 1, deletedAt: null, ...extra,
});

test("the weight trend: every weigh-in, a day's average, gaps count for more", () => {
  const list = [
    w(10, 80), w(11, 79, { time: "07:00" }), w(11, 80, { time: "19:00" }),    // a day with two counts their average
    w(11, 81, { time: "12:00", when: "post-run" }),                             // an old record's time of day is ignored
    w(13, 50, { deletedAt: 5 }),                                                // deleted ones aren't counted
    w(14, 78),
  ];
  const t = weightTrend(list);
  assert.deepEqual(t.map((p) => [p.day, p.kg, p.count]), [[10, 80, 1], [11, 80, 3], [14, 78, 1]]);
  close(t[0].trend, 80);                                  // the first day starts it
  close(t[1].trend, 80);                                  // 10% of the way to the day's average (80)
  close(t[2].trend, 80 + (1 - 0.9 ** 3) * (78 - 80));     // 3 days since: 27.1% of the way
  assert.deepEqual(weightTrend([]), []);
});

test("trend at a day, and its change over a week", () => {
  const list = Array.from({ length: 8 }, (_, i) => w(100 + i, 80));
  list.push(w(108, 79));
  const t = weightTrend(list);
  assert.equal(trendAt(t, 99), null);
  assert.equal(trendAt(t, 100), 80);
  close(trendAt(t, 150), 79.9);                           // after the last: the last
  close(weeklyChange(t), -0.1);                           // 108 against 101
  close(weeklyChange(t, 107), 0);
  assert.equal(weeklyChange(t, 104), null);               // nothing a week before
  assert.equal(weeklyChange(t, 99), null);
  assert.equal(weeklyChange([]), null);
});

test("bodyweight.csv: sorted, deleted ones left out, notes quoted like the other CSVs", () => {
  const list = [
    w(d("2026-10-27"), 80.2, { time: "07:10", note: 'felt "heavy", ok' }),
    w(d("2026-10-26"), 81, { when: "post-run", time: "11:00" }),               // an old record's when isn't written
    w(d("2026-10-26"), 80.5, { time: "07:05" }),
    w(d("2026-10-28"), 79.9),                                                   // no time: blank
    w(d("2026-10-25"), 99, { deletedAt: 9 }),
  ];
  assert.equal(weighInsCsv(list), [
    "date,time,kg,note",
    "2026-10-26,07:05,80.5,",
    "2026-10-26,11:00,81,",
    '2026-10-27,07:10,80.2,"felt ""heavy"", ok"',
    "2026-10-28,,79.9,",
    "",
  ].join("\r\n"));
  assert.equal(weighInsCsv([]), "date,time,kg,note\r\n");
});

// ---------- runs.json and meals.json ----------

test("runs.json reads what it can: a bad entry is skipped with a line naming it, unknown fields are ignored", () => {
  const { runs, problems } = readRuns({
    version: 1, extra: true,
    runs: [
      { id: "g2026-10-31T09:12", date: "2026-10-31", start_time: "09:12", title: "Long", session_id: "t004", run_type: "long", distance_km: 16.2, duration_s: 5400, pace_s_per_km: 333, avg_hr: 146, max_hr: 160, cadence_spm: null, ascent_m: 80, shoes: "x" },
      { id: "g2026-10-24T08:00", date: "2026-10-24", start_time: null, title: "Easy", session_id: null, run_type: "easy", distance_km: 6 },
      { id: "bad-date", date: "31/10/2026", run_type: "easy" },
      { date: "2026-10-30", run_type: "easy" },
      { id: "g2026-10-24T08:00", date: "2026-10-25", run_type: "easy" },
      { id: "odd", date: "2026-10-26", start_time: "9am", run_type: "tempo", distance_km: "5" },
      "nonsense",
    ],
  });
  assert.deepEqual(runs.map((r) => r.id), ["g2026-10-24T08:00", "odd", "g2026-10-31T09:12"]);   // by day
  const long = runs[2];
  assert.deepEqual([long.day, long.time, long.sessionId, long.type, long.distanceKm, long.paceSPerKm, long.cadenceSpm, long.ascentM], [d("2026-10-31"), "09:12", "t004", "long", 16.2, 333, null, 80]);
  assert.deepEqual([runs[0].sessionId, runs[0].time, runs[0].maxHr, runs[0].ascentM], [null, null, null, null]);   // missing numbers are null
  assert.equal(runs[1].type, "other");
  assert.equal(runs[1].time, null);
  assert.equal(runs[1].distanceKm, null);
  assert.equal(isoOf(runs[1].day), "2026-10-26");
  assert.equal(problems.length, 7);
  assert.ok(problems.some((p) => p.includes("bad-date") && p.includes("unreadable date")));
  assert.ok(problems.some((p) => p.includes("Run 4 has no id")));
  assert.ok(problems.some((p) => p.includes("g2026-10-24T08:00 is used twice")));
  assert.ok(problems.some((p) => p.includes("Run odd") && p.includes("run_type") && p.includes("tempo")));
  assert.ok(problems.some((p) => p.includes("Run odd") && p.includes("start_time")));
  assert.ok(problems.some((p) => p.includes("Run odd") && p.includes("distance_km")));
  assert.ok(problems.some((p) => p.includes("Run 7 isn't an object")));
});

test("runs.json: the wrong shape gives no runs and one line; a newer version still reads", () => {
  for (const raw of [null, [], "x", { version: 1 }, { version: 1, runs: {} }]) {
    const r = readRuns(raw);
    assert.deepEqual(r.runs, []);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /runs\.json must look like/);
  }
  const newer = readRuns({ version: 2, runs: [{ id: "a", date: "2026-10-31", run_type: "easy", new_field: 1 }] });
  assert.equal(newer.runs.length, 1);
  assert.match(newer.problems[0], /newer than this Planner reads/);
  assert.match(readRuns({ runs: [] }).problems[0], /No format version/);
  assert.deepEqual(readRuns({ version: 1, runs: [] }), { runs: [], problems: [] });
});

test("meals.json reads like runs.json, with [low, high] amounts", () => {
  const { meals, plateCm, problems } = readMeals({
    version: 1, plate_cm: 27, more: 1,
    meals: [
      { id: "m2026-10-27-2", date: "2026-10-27", time: "19:30", meal: "dinner", items: "pasta, chicken", kcal: [700, 850], protein_g: [45, 55], carbs_g: [80, 100], fat_g: [15, 25], confidence: "medium", note: "big plate", extra: 1 },
      { id: "m2026-10-27-1", date: "2026-10-27", time: null, meal: "brunch", items: "eggs", kcal: [400, "lots"], protein_g: 30, confidence: "sure" },
      { id: "m-bad", date: "yesterday", meal: "lunch" },
    ],
  });
  assert.equal(plateCm, 27);
  assert.deepEqual(meals.map((m) => m.id), ["m2026-10-27-2", "m2026-10-27-1"]);      // same day: the one with no time last
  assert.deepEqual([meals[0].kcal, meals[0].proteinG, meals[0].carbsG, meals[0].fatG, meals[0].confidence, meals[0].meal, meals[0].time], [[700, 850], [45, 55], [80, 100], [15, 25], "medium", "dinner", "19:30"]);
  assert.deepEqual([meals[1].meal, meals[1].confidence, meals[1].kcal, meals[1].proteinG, meals[1].carbsG], ["snack", "low", null, [30, 30], null]);
  assert.equal(problems.length, 4);
  assert.ok(problems.some((p) => p.includes("m-bad") && p.includes("unreadable date")));
  assert.ok(problems.some((p) => p.includes("Meal m2026-10-27-1") && p.includes("brunch")));
  assert.ok(problems.some((p) => p.includes("Meal m2026-10-27-1") && p.includes("kcal")));
  assert.ok(problems.some((p) => p.includes("Meal m2026-10-27-1") && p.includes("confidence")));
  const bad = readMeals({ meals: "none", version: 1 });
  assert.deepEqual([bad.meals, bad.plateCm, bad.problems.length], [[], null, 1]);
  assert.equal(readMeals({ version: 1, meals: [] }).plateCm, null);
});

// ---------- A day's nutrition type ----------

const planWith = (extra: Record<string, unknown> = {}) => {
  const r = readPlan({
    version: 1, plan: { id: "p", start: "2026-11-02", end: "2026-11-15" },
    nutrition: {
      protein_g: [135, 150],
      day_types: { rest: { carbs_g: [330, 415] }, training: { carbs_g: [415, 580] }, long: { carbs_g: [500, 665] }, carb_load: { carbs_g: [600, 800] }, race: { note: "see Race day" } },
      date_overrides: [{ date: "2026-11-12", day_type: "carb_load" }],
      kcal_target: null,
    },
    phases: [{
      name: "Weeks", start: "2026-11-02", end: "2026-11-15", sessions: [
        { id: "run", title: "Easy run", kind: "run", default_date: null },
        { id: "long", title: "Long run", kind: "run", day_type: "long", default_date: "2026-11-08" },
        { id: "gym", title: "Gym", kind: "gym", default_date: null },
        { id: "physio", title: "Physio", kind: "physio", default_date: null },
        { id: "walk", title: "Walk", kind: "other", day_type: "training", default_date: null },
        { id: "race", title: "RACE", kind: "run", day_type: "race", locked: true, default_date: "2026-11-15" },
      ],
    }],
    ...extra,
  });
  assert.deepEqual(r.problems, []);
  return r.plan!;
};
const placed = (id: string, day: string, extra: Partial<Entry> = {}) =>
  newEntry({ id: entryId("p", id), planId: "p", sessionId: id, kind: "session", day: d(day), ...extra });
const futsal = (day: string, extra: Partial<Entry> = {}) => newEntry({ id: `f${++n}`, planId: "p", kind: "futsal", day: d(day), ...extra });
const entries = (...es: Entry[]) => new Map(es.map((e) => [e.id, e]));

test("a day's type: override, then long, training, rest; futsal is training", () => {
  const p = planWith();
  const on = (day: string, ...es: Entry[]) => dayType(p, d(day), entries(...es));
  assert.equal(on("2026-11-05"), "rest");                                       // nothing on it
  assert.equal(on("2026-11-08"), "long");                                       // the plan's own long run
  assert.equal(on("2026-11-15"), "race");
  assert.equal(on("2026-11-03", placed("run", "2026-11-03")), "training");
  assert.equal(on("2026-11-03", placed("run", "2026-11-03"), placed("gym", "2026-11-03")), "training");
  assert.equal(on("2026-11-04", placed("physio", "2026-11-04")), "rest");       // physio alone: still rest
  assert.equal(on("2026-11-08", placed("gym", "2026-11-08")), "long");          // long beats training
  assert.equal(on("2026-11-10", placed("walk", "2026-11-10")), "training");     // a session's own day_type counts whatever its kind
  assert.equal(on("2026-11-06", futsal("2026-11-06")), "training");
  assert.equal(on("2026-11-06", futsal("2026-11-06", { status: "done", doneDay: d("2026-11-06") })), "training");
  assert.equal(on("2026-11-07", futsal("2026-11-07", { status: "skipped" })), "rest");
  assert.equal(on("2026-11-09", futsal("2026-11-09", { deletedAt: 5 })), "rest");
  assert.equal(on("2026-11-04", futsal("2026-11-04", { planId: "another" })), "rest");
  // The plan's override wins over what's on the day.
  assert.equal(on("2026-11-12"), "carb_load");
  assert.equal(on("2026-11-12", placed("run", "2026-11-12"), futsal("2026-11-12")), "carb_load");
});

test("a session counts on the day it was done, not skipped", () => {
  const p = planWith();
  const moved = entries(placed("run", "2026-11-03", { status: "done", doneDay: d("2026-11-04") }));
  assert.equal(dayType(p, d("2026-11-03"), moved), "rest");
  assert.equal(dayType(p, d("2026-11-04"), moved), "training");
  assert.equal(dayType(p, d("2026-11-03"), entries(placed("run", "2026-11-03", { status: "skipped" }))), "rest");
  assert.equal(dayType(p, d("2026-11-15"), entries(placed("race", "2026-11-15", { status: "skipped" }))), "rest");   // even a locked one
  assert.equal(dayType(p, d("2026-11-05"), entries(placed("run", "2026-11-03", { day: null, status: "done", doneDay: d("2026-11-05") }))), "training");
});

test("the carbs target is the plan's range for the day's type", () => {
  const p = planWith();
  assert.deepEqual(carbsTarget(p, d("2026-11-05"), entries()), [330, 415]);
  assert.deepEqual(carbsTarget(p, d("2026-11-08"), entries()), [500, 665]);
  assert.deepEqual(carbsTarget(p, d("2026-11-12"), entries()), [600, 800]);
  assert.equal(carbsTarget(p, d("2026-11-15"), entries()), null);               // race day only has a note
  const bare = planWith({ nutrition: undefined });
  assert.equal(bare.nutrition, null);
  assert.equal(carbsTarget(bare, d("2026-11-05"), entries()), null);
  assert.equal(dayType(bare, d("2026-11-08"), entries()), "long");              // the type still works without a nutrition block
});

test("the kcal target: the day type's own, else the plan's for any day, else none (calibrating)", () => {
  assert.equal(kcalTarget(planWith(), d("2026-11-05"), entries()), null);
  const p = planWith({ nutrition: {
    protein_g: [135, 150], kcal_target: [2400, 2700],
    day_types: { rest: { carbs_g: [330, 415] }, training: { carbs_g: [415, 580] }, long: { carbs_g: [500, 665], kcal: [2900, 3200] }, race: { note: "see Race day" } },
  } });
  assert.deepEqual(kcalTarget(p, d("2026-11-08"), entries()), [2900, 3200]);
  assert.deepEqual(kcalTarget(p, d("2026-11-05"), entries()), [2400, 2700]);
  assert.equal(kcalTarget(planWith({ nutrition: undefined }), d("2026-11-05"), entries()), null);
});

// ---------- History from before Planner ----------

test("runs.json: each run's source, null when it doesn't say", () => {
  const { runs } = readRuns({ version: 1, runs: [
    { id: "s1", date: "2024-01-02", run_type: "easy", source: "strava" }, { id: "g1", date: "2024-01-03", run_type: "easy" },
  ] });
  assert.deepEqual(runs.map((r) => r.source), ["strava", null]);
});

test("weights.json: weigh-ins with their source and time (when is ignored), the other measurements kept, bad ones skipped", () => {
  const { weighIns, measurements, problems } = readWeights({
    version: 1,
    weights: [
      { id: "f2024-01-31T10:49", date: "2024-01-31", time: "10:49", kg: 85.9, when: null, source: "fitnotes", note: "Manhã" },
      { id: "g2025-09-10T14:00", date: "2025-09-10", time: "14:00", kg: 84.1, when: "later", source: "garmin", note: "" },
      { id: "nokg", date: "2025-09-11", time: "08:00", when: "morning", source: "fitnotes" },
      { id: "odd", date: "2025-09-12", time: "8am", kg: 84, when: "evening", source: "fitnotes" },
    ],
    measurements: [{ date: "2024-02-01", time: "13:28", name: "Cold Shower Day", value: 1, unit: "kgs", note: "1st day", source: "fitnotes" }, { name: "no date" }],
  });
  assert.deepEqual(weighIns.map((w) => [w.id, w.kg, w.source, w.time]), [
    ["f2024-01-31T10:49", 85.9, "fitnotes", "10:49"], ["g2025-09-10T14:00", 84.1, "garmin", "14:00"], ["odd", 84, "fitnotes", null],
  ]);
  assert.deepEqual(measurements, [{ day: d("2024-02-01"), time: "13:28", name: "Cold Shower Day", value: 1, unit: "kgs", note: "1st day", source: "fitnotes" }]);
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes("nokg") && p.includes("no weight")));
  assert.ok(problems.some((p) => p.includes("odd") && p.includes("time")));    // "evening" says nothing: when isn't read
  assert.match(readWeights({ weights: "x" }).problems[0], /weights\.json must look like/);
});

test("body weights: a day keeps its best source's weigh-ins; the trend takes them all, a day's average", () => {
  const own = (id: string, day: string, kg: number, extra: Partial<WeighIn> = {}): WeighIn =>
    ({ id, day: d(day), time: "08:00", kg, note: "", updatedAt: 1, deletedAt: null, ...extra });
  const past = (id: string, day: string, kg: number, source: string, time = "10:00") => ({ id, day: d(day), time, kg, source, note: "" });
  const all = bodyWeights(
    [own("p1", "2026-10-28", 82), own("p2", "2026-10-29", 81, { deletedAt: 5 })],
    [past("f1", "2026-10-28", 83, "fitnotes"), past("g1", "2026-10-27", 84, "garmin"), past("f2", "2026-10-27", 83.5, "fitnotes"),
      past("f3", "2026-10-27", 84.5, "fitnotes", "19:00"), past("g2", "2026-10-29", 80, "garmin")],
  );
  assert.deepEqual(all.map((w) => [w.id, w.source, w.time]), [
    ["f2", "fitnotes", "10:00"], ["f3", "fitnotes", "19:00"], ["p1", "planner", "08:00"], ["g2", "garmin", "10:00"],
  ]);
  assert.deepEqual(weightTrend(all).map((p) => [p.kg, p.count]), [[84, 2], [82, 1], [80, 1]]);
});

test("hidden imported weigh-ins are left out, before the day picks its best source; unhiding brings them back", () => {
  const past = (id: string, day: string, kg: number, source: string) => ({ id, day: d(day), time: "10:00", kg, source, note: "" });
  const list = [past("f1", "2026-10-27", 83, "fitnotes"), past("g1", "2026-10-27", 84, "garmin"), past("f2", "2026-10-28", 82, "fitnotes")];
  const hide = (pastId: string, deletedAt: number | null = null): Hidden => ({ id: hiddenId(pastId), kind: "weighIn", pastId, hiddenAt: 1, updatedAt: 1, deletedAt });
  const hidden = hiddenWeighIns([hide("f1"), hide("f2", 5)]);
  assert.deepEqual([...hidden], ["f1"]);
  assert.deepEqual(bodyWeights([], list, hidden).map((w) => w.id), ["g1", "f2"]);   // f1 hidden: Garmin's shows that day; f2 was unhidden
  assert.deepEqual(bodyWeights([], list).map((w) => w.id), ["f1", "f2"]);
  assert.equal(hiddenId("g2026-10-31T09:12"), "weighIn:g2026-10-31T09:12");
});

test("imported weigh-ins weights.json calls \"later\" count in the trend (the gap of 11 to 20 Oct)", () => {
  const { weighIns } = readWeights({ version: 1, weights: [
    { id: "g1", date: "2026-10-10", time: "08:00", kg: 83, when: "morning", source: "garmin" },
    { id: "g2", date: "2026-10-12", time: "18:30", kg: 82.6, when: "later", source: "garmin" },
    { id: "g3", date: "2026-10-16", time: "21:10", kg: 82.4, when: "later", source: "garmin" },
    { id: "g4", date: "2026-10-20", time: "07:50", kg: 82, when: null, source: "garmin" },
  ] });
  const t = weightTrend(bodyWeights([], weighIns));
  assert.deepEqual(t.map((p) => isoOf(p.day)), ["2026-10-10", "2026-10-12", "2026-10-16", "2026-10-20"]);
});

test("lift-history.json: sets with their exercise, bad ones skipped", () => {
  const { sets, problems } = readLiftHistory({ version: 1, sets: [
    { id: "f2024-02-19-000", date: "2024-02-19", exercise_id: "x036", name: "Deadlift", kg: 205, reps: 1, source: "fitnotes", note: "" },
    { id: "f2024-02-19-001", date: "2024-02-19", exercise_id: "", name: "Mystery", kg: 50, reps: 5, source: "fitnotes" },
    { id: "f2024-02-19-002", date: "2024-02-19", exercise_id: "x013", name: "Pull-up", kg: 0, reps: 16, source: "fitnotes" },
    { id: "f2024-02-19-003", date: "2024-02-19", exercise_id: "x015", kg: 100, reps: 0 },
  ] });
  assert.deepEqual(sets.map((s) => [s.id, s.exerciseId, s.kg, s.reps]), [["f2024-02-19-000", "x036", 205, 1], ["f2024-02-19-002", "x013", 0, 16]]);
  assert.equal(problems.length, 2);
});

test("lift points with history: one per day, a lower bound from sets of up to 6 reps; a day logged in Planner wins", () => {
  const past = (id: string, day: string, kg: number, reps: number) =>
    ({ id, day: d(day), exerciseId: "x001", name: "Front squat", kg, reps, source: "fitnotes", note: "" });
  const planned = lift([[60, 5]], { day: d("2025-03-02") });
  const points = liftPoints([planned], "x001", [], [
    past("a", "2025-03-01", 140, 3), past("b", "2025-03-01", 100, 8), past("c", "2025-03-02", 150, 1), past("e", "2025-03-03", 90, 10),
  ]);
  assert.deepEqual(points.map((p) => [p.day, p.topKg, p.topReps, p.e1rm, p.rpeBasis, p.source]), [
    [d("2025-03-01"), 140, 3, 154, "lowerBound", "fitnotes"],
    [d("2025-03-02"), 60, 5, 76, "logged", "planner"],
    [d("2025-03-03"), 90, 10, null, null, "fitnotes"],
  ]);
});

test("sleep.json: one night per date, blanks where Garmin had nothing", () => {
  const { nights, problems } = readSleep({ version: 1, nights: [
    { date: "2026-10-27", bed: "2026-10-27T04:10", wake: "2026-10-27T12:40", total_min: 470, awake_min: 40, deep_min: 80, light_min: 280, rem_min: 110, score: 78, resting_hr: 47, hrv_ms: 52, avg_spo2: 95, avg_respiration: 14.5 },
    { date: "2025-09-09", bed: null, wake: null, total_min: null, resting_hr: 54 },
    { date: "2025-09-09", resting_hr: 50 },
    { date: "2025-09-10", bed: "late", resting_hr: 53 },
  ] });
  assert.deepEqual(nights.map((n) => [n.id, n.restingHr, n.totalMin, n.bed]), [
    ["2025-09-09", 54, null, null], ["2025-09-10", 53, null, null], ["2026-10-27", 47, 470, "2026-10-27T04:10"],
  ]);
  assert.equal(nights[2].hrvMs, 52);
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes("2025-09-09 is used twice")));
  assert.ok(problems.some((p) => p.includes("2025-09-10") && p.includes("bed")));
});

// ---------- Progress: sources, history in the hard sets ----------

test("source names: history says where it came from, Planner's own says nothing", () => {
  assert.equal(sourceName("fitnotes"), "FitNotes");
  assert.equal(sourceName("strava"), "Strava");
  assert.equal(sourceName("garmin_export"), "Garmin");
  assert.equal(sourceName("garmin_account"), "Garmin");
  assert.equal(sourceName("garmin"), "Garmin");
  assert.equal(sourceName("health_connect"), "Health Connect");
  assert.equal(sourceName("planner"), null);
  assert.equal(sourceName(null), null);
  assert.equal(sourceName("polar"), "polar");
});

test("hard sets count the history's sets too, except on days logged in Planner", () => {
  const mon = d("2026-11-02");
  const past = (id: string, day: number, exerciseId = "x001") => ({ id, day, exerciseId, name: "", kg: 100, reps: 3, source: "fitnotes", note: "" });
  const ls = [lift([[60, 5], [60, 5]], { day: mon + 1 })];
  assert.deepEqual(weeklyHardSets(ls, ["x001"], mon, mon + 13, [past("a", mon + 1), past("b", mon + 3), past("c", mon + 3), past("d", mon + 8), past("e", mon + 8, "x002")]), [
    { weekStart: mon, sets: 4 }, { weekStart: mon + 7, sets: 1 },
  ]);
});
