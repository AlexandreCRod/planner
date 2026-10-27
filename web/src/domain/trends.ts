// Training trends: what is tracked beside the plan, and the numbers drawn from it. Same rule as
// training.ts: each kind of data has one owner, never mixed.
// - Runs (runs.json) and meals (meals.json): written by the plan session (runs converted from the user's
//   Garmin exports, meals estimated from photos) and pushed as whole files like the plan's own
//   ("trainingFiles"). They belong to no plan, so their files go under the plan id "shared". Read-only here.
// - Body weight: the weigh-ins the user enters, records "trainingWeighIns", written only by the app. The
//   script pulls them back as bodyweight.csv for the plan session.
// - Everything else here (lift e1RM and top sets, weekly hard sets, weekly km, the weight trend, a day's
//   nutrition type) is worked out on the fly from those and from the user's lifts and entries; none of it
//   is stored.
// Days are epoch-day numbers (domain/dates.ts); weeks start on Monday.
import { startOfWeek } from "./dates.ts";
import {
  type Entry, type Lift, type LiftSet, type Plan, type Raw, type Range, arr, countedDay, csv, dayOf, entryId, futsalDay, isoOf, num, obj, range, sessionsOf, str,
} from "./training.ts";

export type { DayType, Nutrition } from "./training.ts";

/** The plan id the files that belong to no plan are pushed under: planFileId(SHARED_PLAN, RUNS_FILE). */
export const SHARED_PLAN = "shared";
export const RUNS_FILE = "runs.json";
export const MEALS_FILE = "meals.json";
/** The runs.json and meals.json format versions this app reads; a newer one is still read as far as it goes. */
export const RUNS_VERSION = 1;
export const MEALS_VERSION = 1;

// ---------- Reading runs.json and meals.json ----------

export type RunType = "easy" | "quality" | "long" | "race" | "other";
const RUN_TYPES: RunType[] = ["easy", "quality", "long", "race", "other"];
/** One Garmin running activity. Any number may be null (no heart rate strap, no cadence...). */
export interface Run {
  /** Stable, e.g. "g2026-10-31T09:12". */
  id: string;
  day: number;
  /** "09:12". */
  time: string | null;
  title: string;
  /** The plan session it was, when the plan session matched it. */
  sessionId: string | null;
  type: RunType;
  distanceKm: number | null;
  durationS: number | null;
  paceSPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  cadenceSpm: number | null;
  ascentM: number | null;
}

export type MealKind = "breakfast" | "lunch" | "dinner" | "snack";
const MEAL_KINDS: MealKind[] = ["breakfast", "lunch", "dinner", "snack"];
export type Confidence = "low" | "medium" | "high";
const CONFIDENCES: Confidence[] = ["low", "medium", "high"];
/** One meal as estimated from its photo: every amount is a [low, high] guess. */
export interface Meal {
  /** E.g. "m2026-10-27-1". */
  id: string;
  day: number;
  time: string | null;
  meal: MealKind;
  items: string;
  kcal: Range | null;
  proteinG: Range | null;
  carbsG: Range | null;
  fatG: Range | null;
  confidence: Confidence;
  note: string;
}

const versionProblem = (v: unknown, supported: number): string | null => {
  const version = num(v) ?? 0;
  if (version < 1) return "No format version.";
  return version > supported ? `Format version ${version} is newer than this Planner reads (${supported}); update Planner.` : null;
};
/** "09:12" stays; anything else is no time. */
const clockOf = (v: unknown): string | null => (/^([01]\d|2[0-3]):[0-5]\d$/.test(str(v)) ? str(v) : null);
const inList = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);
/** Day, then time of day (none last), then id: how runs, meals and weigh-ins are listed. */
export const byMoment = (a: { day: number; time: string | null; id: string }, b: { day: number; time: string | null; id: string }) =>
  a.day - b.day || (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.id.localeCompare(b.id);

/**
 * Reads the entries of a list in runs.json or meals.json ([key]), each by [read]: an entry with no id, a
 * repeated id or no readable date is skipped and told in plain words. [what] names an entry for the
 * messages ("Run").
 */
function readList<T extends { id: string; day: number; time: string | null }>(
  raw: unknown, file: string, key: string, supported: number, what: string,
  read: (e: Raw, id: string, day: number, problem: (text: string) => void) => T,
): { list: T[]; root: Raw; problems: string[] } {
  const root = obj(raw);
  if (!Array.isArray(root[key])) return { list: [], root, problems: [`${file} must look like {"version": 1, "${key}": [...]}.`] };
  const problems: string[] = [];
  const v = versionProblem(root.version, supported);
  if (v) problems.push(v);
  const list: T[] = [], seen = new Set<string>();
  arr(root[key]).forEach((x, i) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) { problems.push(`${what} ${i + 1} isn't an object; skipped.`); return; }
    const e = obj(x);
    const id = str(e.id).trim();
    if (!id) { problems.push(`${what} ${i + 1} has no id; skipped.`); return; }
    if (seen.has(id)) { problems.push(`${what} id ${id} is used twice; the second is skipped.`); return; }
    seen.add(id);
    const day = dayOf(e.date);
    if (day === null) { problems.push(`${what} ${id} has an unreadable date ("${str(e.date)}"); skipped.`); return; }
    list.push(read(e, id, day, (text) => problems.push(`${what} ${id} ${text}`)));
  });
  return { list: list.sort(byMoment), root, problems };
}

/**
 * Reads runs.json (already parsed). [problems] lists what's wrong in plain words; the push script refuses
 * to push while there are any, and the app still shows what it can.
 */
export function readRuns(raw: unknown): { runs: Run[]; problems: string[] } {
  const { list, problems } = readList(raw, RUNS_FILE, "runs", RUNS_VERSION, "Run", (e, id, day, problem) => {
    const n = (field: string) => {
      const x = num(e[field]);
      if (x === null && e[field] != null) problem(`has a ${field} that isn't a number; left blank.`);
      return x;
    };
    const time = clockOf(e.start_time);
    if (time === null && e.start_time != null) problem(`has a start_time that isn't HH:MM ("${str(e.start_time)}"); left blank.`);
    const type = e.run_type;
    if (!inList(RUN_TYPES, type)) problem(`has run_type "${str(type)}", which isn't one of ${RUN_TYPES.join(", ")}; read as other.`);
    return {
      id, day, time, title: str(e.title), sessionId: str(e.session_id).trim() || null, type: inList(RUN_TYPES, type) ? type : "other",
      distanceKm: n("distance_km"), durationS: n("duration_s"), paceSPerKm: n("pace_s_per_km"), avgHr: n("avg_hr"), maxHr: n("max_hr"),
      cadenceSpm: n("cadence_spm"), ascentM: n("ascent_m"),
    };
  });
  return { runs: list, problems };
}

/** Reads meals.json (already parsed), like [readRuns]. [plateCm] is the plate's width the estimates were scaled by. */
export function readMeals(raw: unknown): { meals: Meal[]; plateCm: number | null; problems: string[] } {
  const { list, root, problems } = readList(raw, MEALS_FILE, "meals", MEALS_VERSION, "Meal", (e, id, day, problem) => {
    const r = (field: string) => {
      const x = range(e[field]);
      if (x === null && e[field] != null) problem(`has a ${field} that isn't [low, high]; left blank.`);
      return x;
    };
    const time = clockOf(e.time);
    if (time === null && e.time != null) problem(`has a time that isn't HH:MM ("${str(e.time)}"); left blank.`);
    const meal = e.meal, confidence = e.confidence;
    if (!inList(MEAL_KINDS, meal)) problem(`has meal "${str(meal)}", which isn't one of ${MEAL_KINDS.join(", ")}; read as snack.`);
    if (!inList(CONFIDENCES, confidence)) problem(`has confidence "${str(confidence)}", which isn't one of ${CONFIDENCES.join(", ")}; read as low.`);
    return {
      id, day, time, meal: inList(MEAL_KINDS, meal) ? meal : "snack", items: str(e.items),
      kcal: r("kcal"), proteinG: r("protein_g"), carbsG: r("carbs_g"), fatG: r("fat_g"),
      confidence: inList(CONFIDENCES, confidence) ? confidence : "low", note: str(e.note),
    };
  });
  return { meals: list, plateCm: num(root.plate_cm), problems };
}

// ---------- A day's nutrition type ----------

/** Which type wins when a day has more than one; a type the plan made up counts as "training". */
const DAY_TYPE_ORDER = ["race", "carb_load", "long", "training", "rest"];
const dayTypeRank = (t: string) => { const i = DAY_TYPE_ORDER.indexOf(t); return i >= 0 ? i : DAY_TYPE_ORDER.indexOf("training"); };

/**
 * The nutrition type of a day: the plan's date override if there is one, else the strongest of what's on
 * it (race, carb load, long, training, then rest). A session counts on the day it was done, else on the day
 * it's placed, and not if skipped; it's the session's own day_type, else "training" for a run, gym or bike
 * session and nothing for physio and the rest. Futsal counts as "training".
 */
export function dayType(plan: Plan, day: number, entries: ReadonlyMap<string, Entry>): string {
  const over = plan.nutrition?.dateOverrides.find((o) => o.day === day);
  if (over) return over.dayType;
  const found: string[] = [];
  for (const s of sessionsOf(plan)) {
    if (countedDay(s, entries.get(entryId(plan.id, s.id))) !== day) continue;
    const type = s.dayType ?? (s.kind === "run" || s.kind === "gym" || s.kind === "bike" ? "training" : null);
    if (type) found.push(type);
  }
  for (const e of entries.values()) {
    if (e.planId === plan.id && futsalDay(e) === day) found.push("training");
  }
  return found.sort((a, b) => dayTypeRank(a) - dayTypeRank(b))[0] ?? "rest";
}

/** The carbs [low, high] in grams the plan sets for the day's type; null when it sets none. */
export function carbsTarget(plan: Plan, day: number, entries: ReadonlyMap<string, Entry>): Range | null {
  return plan.nutrition?.dayTypes.get(dayType(plan, day, entries))?.carbsG ?? null;
}

/** The kcal [low, high] for the day: its type's own, else the plan's one for any day; null while it sets none (calibrating). */
export function kcalTarget(plan: Plan, day: number, entries: ReadonlyMap<string, Entry>): Range | null {
  const n = plan.nutrition;
  return n ? n.dayTypes.get(dayType(plan, day, entries))?.kcal ?? n.kcalTarget : null;
}

// ---------- Body weight ----------

export type WeighWhen = "morning" | "pre-run" | "post-run";
/** One weigh-in. Soft-deleted (not removed) so the delete syncs. */
export interface WeighIn {
  /** Random. */
  id: string;
  day: number;
  /** "07:10". */
  time: string | null;
  kg: number;
  when: WeighWhen;
  note: string;
  updatedAt: number;
  deletedAt: number | null;
}

export interface WeightPoint { day: number; kg: number; trend: number }

/**
 * The weight trend, from the morning weigh-ins only (before-run and after-run weights swing with water):
 * the first of each day, as an exponentially weighted average that gives 10% of the gap to each new day's
 * weight, more after days without one (1 − 0.9 ^ days since the last). The first weigh-in starts it.
 */
export function weightTrend(weighIns: Iterable<WeighIn>): WeightPoint[] {
  const out: WeightPoint[] = [];
  for (const w of [...weighIns].filter((w) => w.when === "morning" && w.deletedAt === null).sort(byMoment)) {
    const prev = out[out.length - 1];
    if (prev && prev.day === w.day) continue;
    out.push({ day: w.day, kg: w.kg, trend: prev ? prev.trend + (1 - 0.9 ** (w.day - prev.day)) * (w.kg - prev.trend) : w.kg });
  }
  return out;
}

/** The trend as of [day]: that of the last weigh-in on or before it; null if none yet. [points] are in day order. */
export function trendAt(points: readonly WeightPoint[], day: number): number | null {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].day <= day) return points[i].trend;
  return null;
}

/** How much the trend moved over the 7 days to [day] (default: the last weigh-in); null if it has no value at either end. */
export function weeklyChange(points: readonly WeightPoint[], day = points[points.length - 1]?.day): number | null {
  if (day === undefined) return null;
  const now = trendAt(points, day), before = trendAt(points, day - 7);
  return now === null || before === null ? null : now - before;
}

/** bodyweight.csv for the plan session: one row per weigh-in not deleted. */
export function weighInsCsv(list: Iterable<WeighIn>): string {
  const rows: (string | number | null)[][] = [["date", "kg", "when", "note"]];
  for (const w of [...list].filter((w) => w.deletedAt === null).sort(byMoment)) rows.push([isoOf(w.day), w.kg, w.when, w.note]);
  return csv(rows);
}

// ---------- Lifts ----------

/** The heaviest weight done in [sets] whose reps [fit] (ties: more reps). */
function heaviest(sets: readonly LiftSet[], fit: (reps: number | null) => boolean): { kg: number; reps: number | null } | null {
  let best: { kg: number; reps: number | null } | null = null;
  for (const s of sets) {
    if (!s.done || s.kg === null || s.kg <= 0 || !fit(s.reps)) continue;
    if (!best || s.kg > best.kg || (s.kg === best.kg && (s.reps ?? 0) > (best.reps ?? 0))) best = { kg: s.kg, reps: s.reps };
  }
  return best;
}

/**
 * Where the RPE behind an e1RM comes from: logged with the lift; "assumed" from its session's target in the
 * plan (drawn as a hollow dot); or a "lowerBound": RPE 10 for imported history that never had one (FitNotes),
 * so the real max was at least that.
 */
export type RpeBasis = "logged" | "assumed" | "lowerBound";

/** The top of a plan's RPE text ("6–7" → 7, "7" → 7); null when it gives none. */
export function topRpe(text: string): number | null {
  const all = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((x) => x >= 1 && x <= 10);
  return all.length ? Math.max(...all) : null;
}

/** The RPE a lift's plan set for its exercise in its session (the higher if it's there twice); null when the plan, session or target is missing. */
export function targetRpeOf(plans: readonly Plan[], lift: Lift): number | null {
  const plan = plans.find((p) => p.id === lift.planId);
  let best: number | null = null;
  for (const s of plan ? sessionsOf(plan) : []) {
    if (s.id !== lift.sessionId) continue;
    for (const x of s.exercises) {
      const r = x.exercise === lift.planned ? topRpe(x.rpe) : null;
      if (r !== null && (best === null || r > best)) best = r;
    }
  }
  return best;
}

/**
 * The RPE to estimate a lift's max with, and where it came from: the logged one always wins; else the
 * session's [target]; else, only for [imported] history, RPE 10 as a lower bound. A plan lift with neither
 * has none: the user stops 2–3 reps short, so RPE 10 would draw false dips.
 */
export function rpeFor(lift: Lift, target: number | null, imported = false): { rpe: number; basis: RpeBasis } | null {
  if (lift.rpe !== null) return { rpe: lift.rpe, basis: "logged" };
  if (target !== null) return { rpe: target, basis: "assumed" };
  return imported ? { rpe: 10, basis: "lowerBound" } : null;
}

/**
 * The estimated one-rep max of a lift, to the nearest 0.5 kg: from its heaviest done set of 1 to 6 reps,
 * kg × (1 + (reps + reps left in the tank) ÷ 30), the tank being 10 − [rpe] (the logged one unless given;
 * see rpeFor). Null without an RPE (the number would be a guess) or without such a set.
 */
export function e1rmOf(lift: Lift, rpe: number | null = lift.rpe): number | null {
  if (rpe === null) return null;
  const top = heaviest(lift.sets, (r) => r !== null && r >= 1 && r <= 6);
  if (!top) return null;
  return Math.round(top.kg * (1 + ((top.reps ?? 0) + (10 - rpe)) / 30) * 2) / 2;
}

/** The heaviest set done in a lift, any reps (ties: more reps); null when none has a weight. */
export const topSetOf = (lift: Lift) => heaviest(lift.sets, () => true);

export interface LiftPoint {
  day: number; topKg: number | null; topReps: number | null; e1rm: number | null;
  /** Where e1rm's RPE came from; null when there's no e1rm. */
  rpeBasis: RpeBasis | null;
  pain: number | null; planId: string; sessionId: string;
}

/**
 * One point per time an exercise was lifted (the exercise actually done, across all plans, since exercise
 * ids are permanent), oldest first; a lift with no set done is no point. A lift logged without an RPE takes
 * its session's target from [plans].
 */
export function liftPoints(lifts: Iterable<Lift>, exerciseId: string, plans: readonly Plan[] = []): LiftPoint[] {
  return [...lifts]
    .filter((l) => l.exercise === exerciseId && l.sets.some((s) => s.done))
    .sort((a, b) => a.day - b.day || a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
    .map((l) => {
      const top = topSetOf(l);
      const rpe = rpeFor(l, l.rpe === null ? targetRpeOf(plans, l) : null);
      const e1rm = e1rmOf(l, rpe?.rpe ?? null);
      return {
        day: l.day, topKg: top?.kg ?? null, topReps: top?.reps ?? null, e1rm, rpeBasis: e1rm === null ? null : rpe!.basis,
        pain: l.pain, planId: l.planId, sessionId: l.sessionId,
      };
    });
}

/**
 * Each Monday-first week of the range, with the sets that count as hard: the sets done (with reps) of the
 * given exercises. Whole weeks: the first and last count their days outside the range too. Weeks with none
 * are there with 0.
 */
export function weeklyHardSets(lifts: Iterable<Lift>, exerciseIds: Iterable<string>, fromDay: number, toDay: number): { weekStart: number; sets: number }[] {
  const ids = new Set(exerciseIds);
  const items: [number, number][] = [];
  for (const l of lifts) if (ids.has(l.exercise)) items.push([l.day, l.sets.filter((s) => s.done && (s.reps ?? 0) > 0).length]);
  return weekTotals(fromDay, toDay, items).map(([weekStart, sets]) => ({ weekStart, sets }));
}

// ---------- Runs ----------

/** [day, amount] pairs added up per Monday-first week from [fromDay]'s to [toDay]'s; weeks with none are 0. */
function weekTotals(fromDay: number, toDay: number, items: Iterable<[day: number, amount: number]>): [number, number][] {
  const totals = new Map<number, number>();
  for (let w = startOfWeek(fromDay, true); w <= toDay; w += 7) totals.set(w, 0);
  for (const [day, amount] of items) {
    const w = startOfWeek(day, true);
    if (totals.has(w)) totals.set(w, totals.get(w)! + amount);
  }
  return [...totals];
}

/** Km run per week over the range (whole weeks, like [weeklyHardSets]), to 10 m. */
export function weeklyKm(runs: Iterable<Run>, fromDay: number, toDay: number): { weekStart: number; km: number }[] {
  const items: [number, number][] = [];
  for (const r of runs) items.push([r.day, r.distanceKm ?? 0]);
  return weekTotals(fromDay, toDay, items).map(([weekStart, km]) => ({ weekStart, km: Math.round(km * 100) / 100 }));
}

/** The long runs, oldest first. */
export const longRuns = (runs: Iterable<Run>): Run[] => [...runs].filter((r) => r.type === "long").sort(byMoment);

/**
 * Runs at an easy heart rate (average at most [maxHr]) with a pace no slower than [slowestPace] s/km, oldest
 * first: for pace against heart rate. Slower than 9:00 /km are walk/run mixes and short treadmill runs.
 */
export const easyRuns = (runs: Iterable<Run>, maxHr = 148, slowestPace = 540): Run[] =>
  [...runs].filter((r) => r.avgHr !== null && r.avgHr <= maxHr && r.paceSPerKm !== null && r.paceSPerKm <= slowestPace).sort(byMoment);

/** The longest run in km among the [days] days up to and including [day]; null when there's none. For the plan's 10% rule against a sudden jump. */
export function longestIn(runs: Iterable<Run>, day: number, days = 30): number | null {
  let best: number | null = null;
  for (const r of runs) if (r.day <= day && r.day > day - days && r.distanceKm !== null && (best === null || r.distanceKm > best)) best = r.distanceKm;
  return best;
}
