// The Training page's data on this device, built from the synced records: the plans the plan session
// pushed (read-only here, see domain/training.ts) and the user's own entries, lifts and what was seen of
// each plan. Rebuilt only when a record changes and something asks for it; a plan's planner.json is read
// once per pushed copy.
import { useSyncExternalStore } from "react";
import { today } from "../domain/dates.ts";
import {
  type Entry, type Lift, type Plan, type PlanFile, type SeenPlan, PLAN_FILE, activePlan, readPlan,
} from "../domain/training.ts";
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
}

const read = new WeakMap<PlanFile, { plan: Plan | null; problems: string[] }>();
let cache: { version: number; data: Training } | null = null;

function readFile(f: PlanFile): { plan: Plan | null; problems: string[] } {
  let r = read.get(f);
  if (!r) {
    try { r = readPlan(JSON.parse(f.text)); } catch { r = { plan: null, problems: ["planner.json isn't valid JSON."] }; }
    read.set(f, r);
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
  for (const files of byPlan.values()) {
    const main = files.find((f) => f.file === PLAN_FILE);
    const r = main ? readFile(main) : null;
    if (!r?.plan) continue;
    plans.push({ plan: r.plan, problems: r.problems, docs: new Map(files.filter((f) => f !== main).map((f) => [f.file, f.text])) });
  }
  plans.sort((a, b) => a.plan.start - b.plan.start);
  const lifts = listOf<Lift>("trainingLifts");
  const data: Training = {
    plans,
    entries: new Map(listOf<Entry>("trainingEntries").map((e) => [e.id, e])),
    lifts,
    liftById: new Map(lifts.map((l) => [l.id, l])),
    seen: new Map(listOf<SeenPlan>("trainingState").map((s) => [s.id, s])),
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
