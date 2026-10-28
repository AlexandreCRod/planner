// The Training page's data on this device, built from the synced records: the plans the plan session
// pushed (read-only here, see domain/training.ts) and the user's own entries, lifts and what was seen of
// each plan, plus the runs and meals the plan session pushed (domain/trends.ts) and the weigh-ins. Rebuilt
// only when a record changes and something asks for it; a plan's planner.json, runs.json and meals.json are
// read once per pushed copy. The watch's data from Health Connect (healthSessions, healthNights, healthDays) is here too.
import { useSyncExternalStore } from "react";
import { today } from "../domain/dates.ts";
import {
  type Entry, type Lift, type Plan, type PlanFile, type SeenPlan, PLAN_FILE, activePlan, readPlan,
} from "../domain/training.ts";
import {
  type Hidden, type Meal, type Night, type PastSet, type PastWeighIn, type Run, type WeighIn, LIFT_HISTORY_FILE, MEALS_FILE, RUNS_FILE, SHARED_PLAN,
  SLEEP_FILE, WEIGHTS_FILE, byMoment, hiddenWeighIns, readLiftHistory, readMeals, readRuns, readSleep, readWeights,
} from "../domain/trends.ts";
import type { HealthDay, HealthNight, HealthSession } from "../domain/health.ts";
import { hiddenWatchRuns, mergedRuns, tickedEntry, typedRuns, watchLinks, watchRunSteps } from "../domain/healthRuns.ts";
import { listOf, putRecords, storeVersion, subscribe } from "./store.ts";

/** A plan as pushed: what it says, what's wrong with it, and its documents by file name. */
export interface LoadedPlan { plan: Plan; problems: string[]; docs: Map<string, string> }

export interface Training {
  /** Oldest first. */
  plans: LoadedPlan[];
  /** Every entry by id, deleted futsal included (views skip them). */
  entries: Map<string, Entry>;
  lifts: Lift[];
  liftById: Map<string, Lift>;
  seen: Map<string, SeenPlan>;
  /**
   * Every run, oldest first: runs.json's and the watch's from Health Connect, the same run once
   * (domain/healthRuns.ts), each watch run with the session it ticked.
   */
  runs: Run[];
  /** What was wrong in runs.json, in plain words (the entries that could be read are in [runs]). */
  runProblems: string[];
  /** Oldest first; none until the plan session pushes meals.json. */
  meals: Meal[];
  mealProblems: string[];
  /** The plate's width the meal estimates were scaled by, when meals.json says. */
  plateCm: number | null;
  /** Every weigh-in, oldest first, deleted ones included (views and trends skip them; sync needs them). */
  weighIns: WeighIn[];
  /** The history from before Planner (weights.json, lift-history.json, sleep.json), oldest first; none until pushed. */
  pastWeighIns: PastWeighIn[];
  /** The ids of the imported weigh-ins the user hid (bodyWeights leaves them out). */
  hiddenWeighIns: Set<string>;
  /** The ids of the watch runs the user said aren't plan runs (domain/healthRuns.ts). */
  hiddenWatchRuns: Set<string>;
  pastSets: PastSet[];
  nights: Night[];
  /** What was wrong in those three files, in plain words. */
  historyProblems: string[];
  /** The watch's data from Health Connect (domain/health.ts), read by the phone and synced; oldest first. */
  healthSessions: HealthSession[];
  healthNights: HealthNight[];
  healthDays: HealthDay[];
}

const read = new WeakMap<PlanFile, { plan: Plan | null; problems: string[] }>();
const readRunsOf = new WeakMap<PlanFile, ReturnType<typeof readRuns>>();
const readMealsOf = new WeakMap<PlanFile, ReturnType<typeof readMeals>>();
const readWeightsOf = new WeakMap<PlanFile, ReturnType<typeof readWeights>>();
const readLiftHistoryOf = new WeakMap<PlanFile, ReturnType<typeof readLiftHistory>>();
const readSleepOf = new WeakMap<PlanFile, ReturnType<typeof readSleep>>();
let cache: { version: number; data: Training } | null = null;

function readFile(f: PlanFile): { plan: Plan | null; problems: string[] } {
  let r = read.get(f);
  if (!r) {
    try { r = readPlan(JSON.parse(f.text)); } catch { r = { plan: null, problems: ["planner.json isn't valid JSON."] }; }
    read.set(f, r);
  }
  return r;
}

/** A shared file (runs.json, meals.json) read once per pushed copy; unreadable JSON reads as [empty] plus a problem. */
function readShared<T extends { problems: string[] }>(cache: WeakMap<PlanFile, T>, f: PlanFile | undefined, parse: (raw: unknown) => T, empty: T): T {
  if (!f) return empty;
  let r = cache.get(f);
  if (!r) {
    try { r = parse(JSON.parse(f.text)); } catch { r = { ...empty, problems: [`${f.file} isn't valid JSON.`] }; }
    cache.set(f, r);
  }
  return r;
}

export function training(): Training {
  const v = storeVersion();
  if (cache?.version === v) return cache.data;
  const byPlan = new Map<string, PlanFile[]>();
  for (const f of listOf<PlanFile>("trainingFiles")) {
    const list = byPlan.get(f.planId);
    if (list) list.push(f); else byPlan.set(f.planId, [f]);
  }
  const plans: LoadedPlan[] = [];
  for (const [planId, files] of byPlan) {
    if (planId === SHARED_PLAN) continue; // runs.json and meals.json: no plan of their own
    const main = files.find((f) => f.file === PLAN_FILE);
    const r = main ? readFile(main) : null;
    if (!r?.plan) continue;
    plans.push({ plan: r.plan, problems: r.problems, docs: new Map(files.filter((f) => f !== main).map((f) => [f.file, f.text])) });
  }
  plans.sort((a, b) => a.plan.start - b.plan.start);
  const lifts = listOf<Lift>("trainingLifts");
  const shared = byPlan.get(SHARED_PLAN) ?? [];
  const runs = readShared(readRunsOf, shared.find((f) => f.file === RUNS_FILE), readRuns, { runs: [], problems: [] });
  const meals = readShared(readMealsOf, shared.find((f) => f.file === MEALS_FILE), readMeals, { meals: [], plateCm: null, problems: [] });
  const weights = readShared(readWeightsOf, shared.find((f) => f.file === WEIGHTS_FILE), readWeights, { weighIns: [], measurements: [], problems: [] });
  const pastLifts = readShared(readLiftHistoryOf, shared.find((f) => f.file === LIFT_HISTORY_FILE), readLiftHistory, { sets: [], problems: [] });
  const sleep = readShared(readSleepOf, shared.find((f) => f.file === SLEEP_FILE), readSleep, { nights: [], problems: [] });
  const entries = listOf<Entry>("trainingEntries");
  const healthSessions = listOf<HealthSession>("healthSessions").sort((a, b) => a.startMs - b.startMs);
  const data: Training = {
    plans,
    entries: new Map(entries.map((e) => [e.id, e])),
    lifts,
    liftById: new Map(lifts.map((l) => [l.id, l])),
    seen: new Map(listOf<SeenPlan>("trainingState").map((s) => [s.id, s])),
    runs: typedRuns(mergedRuns(runs.runs, healthSessions, watchLinks(entries)), plans.map((p) => p.plan)), runProblems: runs.problems,
    meals: meals.meals, mealProblems: meals.problems, plateCm: meals.plateCm,
    weighIns: listOf<WeighIn>("trainingWeighIns").sort(byMoment),
    hiddenWeighIns: hiddenWeighIns(listOf<Hidden>("trainingHidden")),
    hiddenWatchRuns: hiddenWatchRuns(listOf<Hidden>("trainingHidden")),
    pastWeighIns: weights.weighIns, pastSets: pastLifts.sets, nights: sleep.nights,
    historyProblems: [...weights.problems, ...pastLifts.problems, ...sleep.problems],
    healthSessions,
    healthNights: listOf<HealthNight>("healthNights").sort((a, b) => a.day - b.day || a.bed.localeCompare(b.bed)),
    healthDays: listOf<HealthDay>("healthDays").sort((a, b) => a.day - b.day),
  };
  cache = { version: v, data };
  return data;
}

export function useTraining(): Training {
  useSyncExternalStore(subscribe, storeVersion);
  return training();
}

/** The plan shown: the latest one that has started, else the next to start. */
export function activeOf(t: Training, day = today()): LoadedPlan | null {
  const pick = activePlan(t.plans.map((p, i) => ({ start: p.plan.start, i })), day);
  return pick ? t.plans[pick.i] : null;
}

export function saveEntry(e: Entry) { putRecords("trainingEntries", [{ ...e, updatedAt: Date.now() }]); }
export function saveLift(l: Lift) { putRecords("trainingLifts", [{ ...l, updatedAt: Date.now() }]); }
export function saveSeen(s: SeenPlan) { putRecords("trainingState", [{ ...s, updatedAt: Date.now() }]); }
export function saveWeighIn(w: WeighIn) { putRecords("trainingWeighIns", [{ ...w, updatedAt: Date.now() }]); }
export function saveHidden(h: Hidden) { putRecords("trainingHidden", [{ ...h, updatedAt: Date.now() }]); }

/**
 * The phone, after each Health Connect read and when Training opens: each new watch run on a day with one
 * run session not done ticks it (domain/healthRuns.ts). Returns how many it ticked.
 */
export function applyWatchRuns(day = today()): number {
  const t = training();
  const lp = activeOf(t, day);
  if (!lp) return 0;
  const ticks = watchRunSteps(lp.plan, t.entries, t.runs, t.hiddenWatchRuns, day).filter((x) => x.kind === "tick");
  if (!ticks.length) return 0;
  const work = new Map(t.entries);
  const out: Entry[] = [];
  for (const x of ticks) { const e = { ...tickedEntry(lp.plan, x.session, work, x.run), updatedAt: Date.now() }; work.set(e.id, e); out.push(e); }
  putRecords("trainingEntries", out);
  return out.length;
}
