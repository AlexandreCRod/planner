// The Training page's rules. Two kinds of data, each with one owner, never mixed:
// - The plan: planner.json and its documents, written by the half marathon plan session and pushed as
//   whole files (records "trainingFiles"). Read-only here; a push replaces them and never touches the
//   user's own data.
// - The user's own: which day each session goes on, ticks, skips, notes, effort and pain, the sets
//   lifted, futsal, records ("trainingEntries", "trainingLifts"), and which plan changes were seen
//   ("trainingState"). Keyed by plan id + session id and by exercise id, never by text or position, and
//   each copies what it was logged against (title, target), so history still reads right after the plan
//   renames, replaces or drops a session.
// Exercise ids are permanent across all plans (the plan session keeps a growing catalogue), so history and
// bests carry on from one plan to the next. Session ids are per plan.
// Runs, meals, body weight and the lift and run trends are in trends.ts (same two owners).
import { epochOf, ymd } from "./dates.ts";
import { futsalItemId } from "./ids.ts";
import { occurrences } from "./recurrence.ts";
import { type Category, type Completion, type Item, newItem } from "./types.ts";

/** The planner.json format versions this app reads; a newer one is still shown as far as it goes. */
export const PLAN_VERSION = 1;

export type SessionKind = "run" | "gym" | "bike" | "physio" | "other";
export interface Card { doc: string; anchor: string }
export interface PlanDocument { file: string; title: string }
export interface Exercise {
  id: string; name: string; card: Card | null;
  type: "weighted" | "bodyweight" | "timed"; log: "sets" | "tick"; trackBests: boolean;
}
export interface Swap { exercise: string; when: string }
export interface SessionExercise {
  exercise: string;
  /** "warm-up", "main" or "filler" (drills done in the rests): for grouping on screen only. */
  group: string;
  sets: string; reps: string; targetKg: number | null; rpe: string; targetText: string; note: string; swaps: Swap[];
}
export interface Session {
  id: string; title: string; detail: string; kind: SessionKind; card: Card | null;
  /** The day the plan sets (the Sunday long run, the race); the user can still move it unless [locked]. */
  defaultDay: number | null;
  locked: boolean; optional: boolean; extra: string[]; exercises: SessionExercise[];
  /** Its phase's place in [Plan.phases]. */
  phase: number;
  /** The nutrition day type this session makes its day ("training", "long"...); null leaves it to its kind (see dayType). */
  dayType: string | null;
  /** What the placement rules pick it by besides its kind and day type ("quality"). */
  tags: string[];
}
export interface Phase {
  name: string; start: number; end: number; summary: string; rules: string[]; notes: string[]; sessions: Session[];
  /** The rules for which day things go on (see placement.ts). */
  placement: PlacementRule[];
}

/** What a placement rule applies to: sessions of a kind (or futsal), of a day type, with a tag, or named. */
export type Selector = { kind: string } | { dayType: string } | { tag: string } | { sessions: string[] };
/** "avoid" and "ideally" are broken rules, worst first; a "note" is only a hint, never broken. */
export type PlacementLevel = "avoid" | "ideally" | "note";
export type PlacementCheck =
  /** No a the day before a b. */
  | { type: "not_day_before"; a: Selector; b: Selector }
  /** No a on a b's day. */
  | { type: "not_same_day"; a: Selector; b: Selector }
  /** An a at least [days] days before a b (calendar days: Mon → Wed is 2). */
  | { type: "min_days_before"; a: Selector; b: Selector; days: number }
  /** Each a [minDays] to [maxDays] days after the one before it. */
  | { type: "gap"; a: Selector; minDays: number | null; maxDays: number | null }
  /** At least [min] days in the phase with nothing on them. */
  | { type: "rest_days"; min: number }
  /** At most [max] days in a row with something on them. */
  | { type: "max_in_a_row"; max: number }
  /** An a only on these weekdays (1 = Monday ... 7 = Sunday). */
  | { type: "weekdays"; a: Selector; days: number[] }
  /** At most [max] a in the phase. */
  | { type: "max_count"; a: Selector; max: number }
  /** An a on or before [day]. */
  | { type: "not_after"; a: Selector; day: number }
  /** A hint shown when an a and a b share a day. */
  | { type: "same_day_note"; a: Selector; b: Selector }
  /** No a at all in the phase. */
  | { type: "none"; a: Selector };
export interface PlacementRule { id: string; level: PlacementLevel; check: PlacementCheck; text: string; why: string }
export interface HistoricalBest { exercise: string; kg: number; reps: number; label: string }
export interface EstimatedMax { exercise: string; kg: number; day: number | null; from: string }
export interface RunRecord { distance: string; time: string; day: number | null; source: string; note: string }
/** [low, high]. */
export type Range = [number, number];
/** A kind of day in the nutrition plan: its carbs and kcal, or only a note (race day: "see Race day"). */
export interface DayType { carbsG: Range | null; kcal: Range | null; note: string }
export interface Nutrition {
  proteinG: Range | null;
  /** By key: "rest", "training", "long", "carb_load", "race"... */
  dayTypes: Map<string, DayType>;
  /** Days that are a given type whatever is on them (the carb load before the race). */
  dateOverrides: { day: number; dayType: string }[];
  /** The same every day. */
  fatG: Range | null;
  /** For any day; a day type's own kcal wins (see kcalTarget in trends.ts). Null while it's calibrating. */
  kcalTarget: Range | null;
}
export interface Plan {
  version: number; id: string; name: string; start: number; end: number;
  /** Rep bests count sets from this day on (the return to lifting). */
  bestsSince: number | null;
  documents: PlanDocument[]; exercises: Exercise[]; phases: Phase[];
  records: { historical: HistoricalBest[]; estimatedMax: EstimatedMax[]; runs: RunRecord[] };
  nutrition: Nutrition | null;
  /** The body weight range in kg the plan aims for, when it says. */
  bodyweightTarget: Range | null;
}

// ---------- Reading planner.json ----------

// (Shared with trends.ts, which reads runs.json and meals.json the same tolerant way.)
export type Raw = Record<string, unknown>;
export const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const strs = (v: unknown): string[] => arr(v).map(str).filter(Boolean);
/** [low, high] from two numbers (either order) or one number (both ends); null for anything else. */
export function range(v: unknown): Range | null {
  const one = num(v);
  if (one !== null) return [one, one];
  const [a, b] = arr(v).map(num);
  return arr(v).length === 2 && a !== null && b !== null ? [Math.min(a, b), Math.max(a, b)] : null;
}

/** "2026-11-29" → local day number; null for anything else. */
export function dayOf(iso: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(iso));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const day = epochOf(y, mo, d);
  return ymd(day).d === d ? day : null;
}

/** Local day number → "2026-11-29". */
export function isoOf(day: number): string {
  const { y, m, d } = ymd(day);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function card(v: unknown): Card | null {
  const c = obj(v);
  const doc = str(c.doc), anchor = str(c.anchor);
  return doc ? { doc, anchor } : null;
}

const KINDS: SessionKind[] = ["run", "gym", "bike", "physio", "other"];
const LEVELS: PlacementLevel[] = ["avoid", "ideally", "note"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** One selector of a check; null (with a problem said) when it can't be read. Named sessions go to [named] to check later. */
function readSelector(v: unknown, bad: (text: string) => void, named: string[]): Selector | null {
  const s = obj(v);
  if (typeof s.kind === "string") {
    if (s.kind === "futsal" || KINDS.includes(s.kind as SessionKind)) return { kind: s.kind };
    bad(`picks kind "${s.kind}", which isn't futsal or a session kind (${KINDS.join(", ")}).`);
    return null;
  }
  if (str(s.day_type).trim()) return { dayType: str(s.day_type).trim() };
  if (str(s.tag).trim()) return { tag: str(s.tag).trim() };
  const ids = str(s.session).trim() ? [str(s.session).trim()] : strs(s.sessions);
  if (ids.length) { named.push(...ids); return { sessions: ids }; }
  bad(v == null ? "is missing (what the rule applies to)." : "can't be read (use kind, day_type, tag, session or sessions).");
  return null;
}

/**
 * A phase's "placement" list. A rule with an unknown check type or level, or a missing field, is left out
 * and told in [problems]; the others are read. Session ids named go to [named] with the rule, to check once
 * every session is read.
 */
function readPlacement(v: unknown, phase: string, problems: string[], named: { rule: string; ids: string[] }[]): PlacementRule[] {
  const out: PlacementRule[] = [];
  const seen = new Set<string>();
  arr(v).forEach((x, i) => {
    const r = obj(x);
    const id = str(r.id).trim();
    const what = `Placement rule ${id || i + 1} in "${phase}"`;
    let ok = true;
    const bad = (text: string) => { problems.push(`${what} ${text}`); ok = false; };
    if (!id) bad("has no id.");
    else if (seen.has(id)) bad("is there twice.");
    seen.add(id);
    const level = str(r.level) as PlacementLevel;
    if (!LEVELS.includes(level)) bad(`has level "${str(r.level)}", which isn't avoid, ideally or note.`);
    const text = str(r.text).trim(), why = str(r.why).trim();
    if (!text) bad("has no text.");
    if (!why && level !== "note") bad("has no why.");
    const c = obj(r.check);
    const ids: string[] = [];
    const sel = (key: "a" | "b") => readSelector(c[key], (t) => bad(`check ${key} ${t}`), ids);
    const whole = (key: string, min: number) => {
      const n = num(c[key]);
      if (n === null || n < min || !Number.isInteger(n)) { bad(`needs ${key}, a whole number from ${min}.`); return 0; }
      return n;
    };
    const type = str(c.type);
    let check: PlacementCheck | null = null;
    if (type === "not_day_before" || type === "not_same_day" || type === "same_day_note") {
      const a = sel("a"), b = sel("b");
      if (a && b) check = { type, a, b };
    } else if (type === "min_days_before") {
      const a = sel("a"), b = sel("b"), days = whole("days", 1);
      if (a && b) check = { type, a, b, days };
    } else if (type === "gap") {
      const a = sel("a");
      const minDays = c.min_days == null ? null : whole("min_days", 0), maxDays = c.max_days == null ? null : whole("max_days", 0);
      if (minDays === null && maxDays === null) bad("needs min_days or max_days.");
      else if (minDays !== null && maxDays !== null && maxDays < minDays) bad("has max_days below min_days.");
      if (a) check = { type, a, minDays, maxDays };
    } else if (type === "rest_days") {
      check = { type, min: whole("min", 1) };
    } else if (type === "max_in_a_row") {
      check = { type, max: whole("max", 1) };
    } else if (type === "weekdays") {
      const a = sel("a");
      const names = strs(c.days).map((d) => d.toLowerCase());
      const unknown = names.filter((d) => !WEEKDAYS.includes(d));
      if (!names.length) bad(`needs days, e.g. ["sat", "sun"].`);
      else if (unknown.length) bad(`has days it can't read (${unknown.join(", ")}); use mon, tue... sun.`);
      if (a) check = { type, a, days: names.map((d) => WEEKDAYS.indexOf(d) + 1) };
    } else if (type === "max_count") {
      const a = sel("a"), max = whole("max", 0);
      if (a) check = { type, a, max };
    } else if (type === "not_after") {
      const a = sel("a"), day = dayOf(c.date);
      if (day === null) bad("needs a date (YYYY-MM-DD).");
      if (a && day !== null) check = { type, a, day };
    } else if (type === "none") {
      const a = sel("a");
      if (a) check = { type, a };
    } else bad(type ? `has check type "${type}", which this Planner doesn't know.` : "has no check type.");
    if (ids.length) named.push({ rule: what, ids });
    if (ok && check) out.push({ id, level, check, text, why });
  });
  return out;
}

/** The "nutrition" block of planner.json; null when the plan has none. Adds to [problems] what it can't read. */
function readNutrition(v: unknown, problems: string[]): Nutrition | null {
  if (v === undefined || v === null) return null;
  if (!v || typeof v !== "object" || Array.isArray(v)) { problems.push("The nutrition block must be an object."); return null; }
  const n = obj(v);
  const asRange = (x: unknown, what: string) => {
    const r = range(x);
    if (r === null && x != null) problems.push(`Nutrition ${what} must be [low, high].`);
    return r;
  };
  const dayTypes = new Map<string, DayType>();
  for (const [key, d] of Object.entries(obj(n.day_types))) {
    dayTypes.set(key, { carbsG: asRange(obj(d).carbs_g, `${key} carbs_g`), kcal: asRange(obj(d).kcal, `${key} kcal`), note: str(obj(d).note) });
  }
  const dateOverrides: Nutrition["dateOverrides"] = [];
  for (const o of arr(n.date_overrides).map(obj)) {
    const day = dayOf(o.date), dayType = str(o.day_type).trim();
    if (day === null || !dayType) { problems.push(`A nutrition date override needs a date and a day_type ("${str(o.date)}").`); continue; }
    if (!dayTypes.has(dayType)) problems.push(`The nutrition override for ${str(o.date)} uses day type ${dayType}, which isn't in day_types.`);
    dateOverrides.push({ day, dayType });
  }
  return {
    proteinG: asRange(n.protein_g, "protein_g"), dayTypes, dateOverrides, fatG: asRange(n.fat_g, "fat_g"), kcalTarget: asRange(n.kcal_target, "kcal_target"),
  };
}

/**
 * Reads planner.json (already parsed) into a [Plan], filling in what's missing and ignoring fields it
 * doesn't know. [problems] lists what's wrong in plain words; the push script refuses to push while there
 * are any, and the page still shows what it can.
 */
export function readPlan(raw: unknown): { plan: Plan | null; problems: string[] } {
  const problems: string[] = [];
  const root = obj(raw);
  const version = num(root.version) ?? 0;
  if (version < 1) problems.push("No format version.");
  else if (version > PLAN_VERSION) problems.push(`Format version ${version} is newer than this Planner reads (${PLAN_VERSION}); update Planner.`);
  const p = obj(root.plan);
  const id = str(p.id).trim();
  if (!id) problems.push("The plan has no id.");
  else if (!/^[A-Za-z0-9._-]{1,60}$/.test(id)) problems.push(`The plan id "${id}" may only use letters, digits, ".", "_" and "-".`);
  const start = dayOf(p.start), end = dayOf(p.end);
  if (start === null || end === null) problems.push("The plan needs a start and an end date (YYYY-MM-DD).");
  else if (end < start) problems.push("The plan ends before it starts.");

  const exercises: Exercise[] = [];
  const exIds = new Set<string>();
  for (const e of arr(root.exercises).map(obj)) {
    const eid = str(e.id).trim();
    if (!eid) { problems.push(`An exercise has no id ("${str(e.name)}").`); continue; }
    if (exIds.has(eid)) { problems.push(`Exercise id ${eid} is used twice.`); continue; }
    exIds.add(eid);
    const type = str(e.type);
    exercises.push({
      id: eid, name: str(e.name) || eid, card: card(e.card),
      type: type === "bodyweight" || type === "timed" ? type : "weighted",
      log: str(e.log) === "tick" ? "tick" : "sets",
      trackBests: e.track_bests === true,
    });
  }

  const nutrition = readNutrition(root.nutrition, problems);
  const bodyweight = obj(root.bodyweight);
  const bodyweightTarget = range(bodyweight.target_kg_range);
  if (bodyweightTarget === null && bodyweight.target_kg_range != null) problems.push("The bodyweight target_kg_range must be [low, high].");

  const sessionIds = new Set<string>();
  const named: { rule: string; ids: string[] }[] = [];
  const phases: Phase[] = arr(root.phases).map(obj).map((ph, index) => {
    const name = str(ph.name) || `Phase ${index + 1}`;
    const ps = dayOf(ph.start), pe = dayOf(ph.end);
    if (ps === null || pe === null) problems.push(`Phase "${name}" needs a start and an end date.`);
    const sessions: Session[] = [];
    for (const s of arr(ph.sessions).map(obj)) {
      const sid = str(s.id).trim();
      const title = str(s.title);
      if (!sid) { problems.push(`A session in "${name}" has no id ("${title}").`); continue; }
      if (sessionIds.has(sid)) { problems.push(`Session id ${sid} is used twice.`); continue; }
      sessionIds.add(sid);
      const defaultDay = dayOf(s.default_date);
      if (s.default_date != null && s.default_date !== "" && defaultDay === null) problems.push(`Session ${sid} has an unreadable default_date.`);
      if (defaultDay !== null && ps !== null && pe !== null && (defaultDay < ps || defaultDay > pe)) {
        problems.push(`Session ${sid}'s default_date is outside its phase "${name}".`);
      }
      const kind = str(s.kind) as SessionKind;
      const locked = s.locked === true;
      if (locked && defaultDay === null) problems.push(`Session ${sid} is locked but has no default_date.`);
      const dayType = str(s.day_type).trim() || null;
      if (dayType && nutrition && !nutrition.dayTypes.has(dayType)) problems.push(`Session ${sid} has day_type ${dayType}, which isn't in the nutrition day types.`);
      sessions.push({
        id: sid, title: title || sid, detail: str(s.detail), kind: KINDS.includes(kind) ? kind : "other", card: card(s.card),
        defaultDay, locked, optional: s.optional === true, extra: strs(s.extra), phase: index, dayType, tags: strs(s.tags),
        exercises: arr(s.exercises).map(obj).map((x) => {
          const ex = str(x.exercise);
          if (!exIds.has(ex)) problems.push(`Session ${sid} uses exercise ${ex || "(none)"}, which isn't in the exercise list.`);
          const swaps = arr(x.swaps).map(obj).map((w) => ({ exercise: str(w.exercise), when: str(w.when) }));
          for (const w of swaps) if (!exIds.has(w.exercise)) problems.push(`Session ${sid} offers swap ${w.exercise || "(none)"}, which isn't in the exercise list.`);
          return {
            exercise: ex, group: str(x.group) || "main", sets: str(x.sets), reps: str(x.reps), targetKg: num(x.target_kg),
            rpe: str(x.rpe), targetText: str(x.target_text), note: str(x.note), swaps,
          };
        }),
      });
    }
    const placement = readPlacement(ph.placement, name, problems, named);
    return { name, start: ps ?? 0, end: pe ?? 0, summary: str(ph.summary), rules: strs(ph.rules), notes: strs(ph.notes), sessions, placement };
  });
  for (const n of named) for (const sid of n.ids) if (!sessionIds.has(sid)) problems.push(`${n.rule} names session ${sid}, which isn't in the plan.`);
  phases.forEach((a, i) => {
    const b = phases[i + 1];
    if (b && a.end && b.start && b.start <= a.end) problems.push(`Phases "${a.name}" and "${b.name}" overlap.`);
  });

  const documents = arr(root.documents).map(obj).map((d) => ({ file: str(d.file), title: str(d.title) || str(d.file) })).filter((d) => d.file);
  for (const d of documents) if (!/^[^/\\:]+\.md$/i.test(d.file)) problems.push(`Document "${d.file}" must be a .md file in the plan's folder.`);
  const r = obj(root.records);
  const plan: Plan | null = id && start !== null && end !== null ? {
    version, id, name: str(p.name) || id, start, end, bestsSince: dayOf(root.bests_since), documents, exercises, phases,
    records: {
      historical: arr(r.historical).map(obj).map((h) => ({ exercise: str(h.exercise), kg: num(h.kg) ?? 0, reps: num(h.reps) ?? 1, label: str(h.label) })),
      estimatedMax: arr(r.estimated_1rm).map(obj).map((h) => ({ exercise: str(h.exercise), kg: num(h.kg) ?? 0, day: dayOf(h.date), from: str(h.from) })),
      runs: arr(r.runs).map(obj).map((h) => ({ distance: str(h.distance), time: str(h.time), day: dayOf(h.date), source: str(h.source), note: str(h.note) })),
    },
    nutrition, bodyweightTarget,
  } : null;
  return { plan, problems };
}

/** Cards that point at a document or anchor that isn't there ([anchors]: each document's ids). */
export function missingCards(plan: Plan, anchors: (file: string) => ReadonlySet<string> | null): string[] {
  const out: string[] = [];
  const check = (c: Card | null, what: string) => {
    if (!c) return;
    const ids = anchors(c.doc);
    if (!ids) out.push(`${what} points at ${c.doc}, which isn't among the documents.`);
    else if (c.anchor && !ids.has(c.anchor)) out.push(`${what} points at ${c.doc}#${c.anchor}, which isn't in it.`);
  };
  for (const e of plan.exercises) check(e.card, `Exercise ${e.id}`);
  for (const ph of plan.phases) for (const s of ph.sessions) check(s.card, `Session ${s.id}`);
  return out;
}

export const exerciseById = (plan: Plan) => new Map(plan.exercises.map((e) => [e.id, e]));
export const sessionsOf = (plan: Plan) => plan.phases.flatMap((p) => p.sessions);

/** The phase a day falls in, else the next one, else the last. */
export function phaseIndexAt(plan: Plan, day: number): number {
  const i = plan.phases.findIndex((p) => day <= p.end);
  return i >= 0 ? i : Math.max(0, plan.phases.length - 1);
}

/** The plan shown: the latest one that has started, else the next to start. Older ones stay read-only. */
export function activePlan<P extends Pick<Plan, "start">>(plans: P[], today: number): P | null {
  const started = plans.filter((p) => p.start <= today).sort((a, b) => b.start - a.start);
  if (started.length) return started[0];
  return [...plans].sort((a, b) => a.start - b.start)[0] ?? null;
}

/**
 * A file of a plan as the plan session's script pushes it ("trainingFiles"): planner.json or one of its
 * documents, whole. Only the script writes these; the app reads them.
 */
export interface PlanFile {
  /** "<plan id>:<file name>". */
  id: string;
  planId: string;
  file: string;
  text: string;
  updatedAt: number;
}
export const planFileId = (planId: string, file: string) => `${planId}:${file}`;
export const PLAN_FILE = "planner.json";

// ---------- The user's own records ----------

/** One session's state, a futsal game, or a record the user added. */
export interface Entry {
  /** "<plan id>:<session id>" for a session (so two devices can't make two), random for futsal and records. */
  id: string;
  planId: string;
  sessionId: string | null;
  kind: "session" | "futsal" | "record";
  status: "planned" | "done" | "skipped";
  /** The day it's on (a session's placed day, futsal's day); null puts a session back in "To place". */
  day: number | null;
  doneDay: number | null;
  durationMin: number | null;
  pain: number | null;
  effort: number | null;
  note: string;
  /** Tick-only exercises (warm-ups, drills) ticked in this session. */
  ticks: string[];
  /** What it was logged against, kept so history reads right after the plan changes. */
  title: string;
  detail: string;
  /** The watch run (Health Connect, "hc:�") that ticked this session, or was picked for it (domain/healthRuns.ts). */
  watchRunId?: string | null;
  /** Watch runs that ticked it and were unticked: they never tick it again. */
  watchRunsDismissed?: string[];
  /** A futsal game's log (item 240): the event it's about. Its id is futsalLogId(itemId, day); its own day is null. */
  itemId?: number;
  /** A game of another sport, not futsal (267): set on the Entries gameEntry makes, never stored. */
  sport?: boolean;
  /** An old futsal entry (from before 240), once converted: the event it became, 0 for none (it was skipped). Kept so a 2.8 phone still shows it. */
  convertedTo?: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** One exercise lifted in one session: its sets, and how hard it felt. */
export interface Lift {
  /** "<plan id>:<session id>:<planned exercise id>". */
  id: string;
  planId: string;
  sessionId: string;
  /** The exercise the plan put there. */
  planned: string;
  /** The one actually done: [planned], or the swap picked. */
  exercise: string;
  day: number;
  sets: LiftSet[];
  rpe: number | null;
  pain: number | null;
  note: string;
  /** Copies at the time of logging: the exercise's name and the target ("3×5 @ ~60 kg · RPE 5–6"). */
  name: string;
  target: string;
  updatedAt: number;
}
export interface LiftSet { kg: number | null; reps: number | null; done: boolean }

/** What the user has seen of a plan, for the warning after a plan update; one per plan. */
export interface SeenPlan {
  id: string; // the plan id
  sessions: Record<string, { title: string; defaultDay: number | null }>;
  seenAt: number;
  /** Changes already shown and dismissed ([changeKey]), so a day left outside its phase isn't raised again. */
  dismissed?: string[];
  updatedAt?: number;
}

export const entryId = (planId: string, sessionId: string) => `${planId}:${sessionId}`;
export const liftId = (planId: string, sessionId: string, planned: string) => `${planId}:${sessionId}:${planned}`;

export function newEntry(fields: Partial<Entry> & Pick<Entry, "id" | "planId" | "kind">): Entry {
  return {
    sessionId: null, status: "planned", day: null, doneDay: null, durationMin: null, pain: null, effort: null, note: "",
    ticks: [], title: "", detail: "", updatedAt: Date.now(), deletedAt: null, ...fields,
  };
}

/** A session's entry, made from the plan when there isn't one yet. */
export function entryFor(plan: Plan, s: Session, entries: ReadonlyMap<string, Entry>): Entry {
  return entries.get(entryId(plan.id, s.id)) ?? newEntry({
    id: entryId(plan.id, s.id), planId: plan.id, sessionId: s.id, kind: "session", day: s.defaultDay, title: s.title, detail: s.detail, updatedAt: 0,
  });
}

/** The day a session is on: the one the user picked, else the plan's own. A locked one never moves. */
export function dayOfSession(s: Session, e: Entry | undefined): number | null {
  if (s.locked) return s.defaultDay;
  return e ? e.day : s.defaultDay;
}

/**
 * The day a session counts on (for the day's type and the placement rules): the day it was done, else the
 * day it's on; none if skipped.
 */
export function countedDay(s: Session, e: Entry | undefined): number | null {
  if (e?.status === "skipped") return null;
  const placed = dayOfSession(s, e);
  return e?.status === "done" ? e.doneDay ?? placed : placed;
}

/** The day a futsal game counts on, the same way; none if deleted or skipped. */
export function futsalDay(e: Entry): number | null {
  if (e.kind !== "futsal" || e.deletedAt !== null || e.status === "skipped") return null;
  return e.status === "done" ? e.doneDay ?? e.day : e.day;
}

// ---------- Futsal and other sports: calendar events (items 240, 267) ----------
// A game is a normal calendar event of the Sports category (267): futsal when its title says futsal or
// football, else another sport (its own title, a generic icon). One counts on every day it occurs.
// Done is a Completion {itemId, day}, as for routines. What was logged (how long, pain, effort, a note) is an
// Entry with the id futsalLogId(itemId, day), made only when something is logged. The views (phaseView,
// the placement rules, the week bar, logCsv, the day's type) read games as Entries made by gameEntry, put
// in place of every stored futsal entry by trainingEntries. Old futsal entries convert once (convertFutsal).

/** A Sports category (267): the user names categories, so any whose name has the word "sport" or "sports" (any case). */
export const isSportsCategory = (c: Pick<Category, "name">) => /\bsports?\b/i.test(c.name);
/** The ids of the Sports categories. */
export const sportsCategoryIds = (cats: Iterable<Category>): Set<number> => new Set([...cats].filter(isSportsCategory).map((c) => c.id));
const NO_SPORTS: ReadonlySet<number> = new Set();

/** What an event is on Training: futsal, another sport, or nothing. */
export type GameKind = "futsal" | "sport";

/**
 * Whether an event is on Training, and as what (267). Only events count:
 * - marked futsal (Item.futsal true, 240's switch, still read): futsal, whatever its category;
 * - in a Sports category ([sports]): futsal when its title says futsal or football, else another sport
 *   (the switch is gone, so a "not futsal" mark no longer counts there);
 * - with no category, a title with "futsal" in it (240's games added from Training or converted): futsal;
 * - anything else (another category): nothing.
 */
export function gameKind(item: Item, sports: ReadonlySet<number> = NO_SPORTS): GameKind | null {
  if (item.type !== "EVENT") return null;
  if (item.futsal === true) return "futsal";
  if (item.categoryId != null && sports.has(item.categoryId)) return /futsal|football/i.test(item.title) ? "futsal" : "sport";
  if (item.categoryId == null && item.futsal === undefined && /futsal/i.test(item.title)) return "futsal";
  return null;
}

/** Whether an event counts as futsal (gameKind). */
export const isFutsal = (item: Item, sports: ReadonlySet<number> = NO_SPORTS) => gameKind(item, sports) === "futsal";
/** Whether an event is on Training at all: futsal or another sport (gameKind). */
export const isGame = (item: Item, sports: ReadonlySet<number> = NO_SPORTS) => gameKind(item, sports) !== null;

/** The id of a game's log: one per event and day. */
export const futsalLogId = (itemId: number, day: number) => `futsal:${itemId}:${day}`;

export interface FutsalGame {
  itemId: number;
  day: number;
  /** Ticked: a Completion on that day. */
  done: boolean;
  /** What was logged, when anything was. */
  log: Entry | null;
  /** The event. */
  item: Item;
  /** Another sport, not futsal (267). */
  sport: boolean;
}

/**
 * Every futsal game from [range.start] to [range.end] (a phase, a plan): each day a futsal event that isn't
 * in the trash occurs on (repeats expanded, days taken out left out), by day, then time, then id.
 */
export function futsalGames(
  range: { start: number; end: number }, items: Iterable<Item>, completions: Iterable<Completion>, entries: ReadonlyMap<string, Entry>,
  sports: ReadonlySet<number> = NO_SPORTS,
): FutsalGame[] {
  const done = new Set<string>();
  for (const c of completions) done.add(`${c.itemId}:${c.day}`);
  const out: FutsalGame[] = [];
  for (const item of items) {
    const kind = item.deletedAt === null ? gameKind(item, sports) : null;
    if (!kind) continue;
    for (const day of occurrences(item, range.start, range.end)) {
      const log = entries.get(futsalLogId(item.id, day));
      out.push({ itemId: item.id, day, done: done.has(`${item.id}:${day}`), log: log && log.deletedAt === null ? log : null, item, sport: kind === "sport" });
    }
  }
  return out.sort((a, b) => a.day - b.day || (a.item.startMin ?? -1) - (b.item.startMin ?? -1) || a.itemId - b.itemId);
}

/** A game as the views read it: a futsal Entry with the log's id, on its day, done or planned. */
export function gameEntry(g: FutsalGame, planId: string): Entry {
  const l = g.log;
  return {
    id: futsalLogId(g.itemId, g.day), planId, sessionId: null, kind: "futsal", status: g.done ? "done" : "planned",
    day: g.day, doneDay: g.done ? g.day : null, durationMin: l?.durationMin ?? null, pain: l?.pain ?? null, effort: l?.effort ?? null,
    note: l?.note ?? "", ticks: [], title: g.item.title.trim() || (g.sport ? "Sport" : "Futsal"), detail: "", itemId: g.itemId, updatedAt: l?.updatedAt ?? 0, deletedAt: null,
    ...(g.sport ? { sport: true } : {}),
  };
}

/**
 * The entries the Training views read: every stored one except futsal (old entries, converted or not, and
 * the games' logs), plus each plan's games as Entries (gameEntry). A day in two plans' ranges goes to the
 * one that starts later, as the page shows.
 */
export function trainingEntries(
  plans: readonly Pick<Plan, "id" | "start" | "end">[], entries: Iterable<Entry>, items: Iterable<Item>, completions: Iterable<Completion>,
  sports: ReadonlySet<number> = NO_SPORTS,
): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const stored = new Map<string, Entry>();
  for (const e of entries) { stored.set(e.id, e); if (e.kind !== "futsal") out.set(e.id, e); }
  const sorted = [...plans].sort((a, b) => a.start - b.start);
  if (!sorted.length) return out;
  const games = futsalGames({ start: Math.min(...sorted.map((p) => p.start)), end: Math.max(...sorted.map((p) => p.end)) }, items, completions, stored, sports);
  const latestFirst = [...sorted].reverse();
  for (const g of games) {
    const plan = latestFirst.find((p) => g.day >= p.start && g.day <= p.end);
    if (plan) { const e = gameEntry(g, plan.id); out.set(e.id, e); }
  }
  return out;
}

/**
 * trainingEntries with the old futsal entries converted in memory first (nothing saved): for the plan
 * session's pull, which may run before any app has converted them.
 */
export function entriesWithGames(
  plans: readonly Pick<Plan, "id" | "start" | "end">[], entries: Iterable<Entry>, items: Iterable<Item>, completions: Iterable<Completion>,
  sports: ReadonlySet<number> = NO_SPORTS,
): Map<string, Entry> {
  const es = [...entries], is = [...items];
  const c = convertFutsal(es, is);
  const byId = new Map(es.map((e) => [e.id, e]));
  for (const e of c.entries) byId.set(e.id, e);
  return trainingEntries(plans, byId.values(), [...is, ...c.items], [...completions, ...c.completions], sports);
}

/** What converting the old futsal entries writes. */
export interface FutsalConversion { items: Item[]; completions: Completion[]; entries: Entry[] }

/** An old futsal entry not yet converted (not a game's log, not in the trash). */
const unconverted = (e: Entry) => e.kind === "futsal" && e.deletedAt === null && e.convertedTo === undefined && e.itemId === undefined && !e.id.startsWith("futsal:");

/**
 * The old futsal entries (from before 240) as events, once: each becomes an untimed event "Futsal" (or its
 * title) on the day it counts on (futsalDay: the day it was done, else its day), with the id
 * futsalItemId(entry id); a Completion that day if it was done; its duration, pain, effort and note in the
 * game's log. The old entry is kept, marked convertedTo (0 for a skipped one, which becomes nothing), so a
 * 2.8 phone still shows it and this app doesn't convert it again. Every record is made from the entry alone
 * (its edit time included), so two devices converting the same entry write the same records; an event
 * already there (from another device) isn't written again, nor its tick or log, so edits made since stay.
 */
export function convertFutsal(entries: Iterable<Entry>, items: Iterable<Item>): FutsalConversion {
  const have = new Set<number>();
  for (const i of items) have.add(i.id);
  const out: FutsalConversion = { items: [], completions: [], entries: [] };
  for (const e of entries) {
    if (!unconverted(e)) continue;
    const day = futsalDay(e);
    const at = e.updatedAt;
    if (day === null) { out.entries.push({ ...e, convertedTo: 0, updatedAt: at + 1 }); continue; }
    const id = futsalItemId(e.id);
    const title = e.title.trim() || "Futsal";
    if (!have.has(id)) {
      out.items.push(newItem({
        id, type: "EVENT", title, startDay: day, endDay: day, allDay: true, createdAt: at, updatedAt: at, ...(isFutsal({ type: "EVENT", title, categoryId: null } as Item) ? {} : { futsal: true }),
      }));
      if (e.status === "done") out.completions.push({ itemId: id, day, completedAt: at });
    }
    if (!have.has(id) && (e.durationMin !== null || e.pain !== null || e.effort !== null || e.note.trim())) {
      out.entries.push(newEntry({
        id: futsalLogId(id, day), planId: e.planId, kind: "futsal", itemId: id, durationMin: e.durationMin, pain: e.pain, effort: e.effort,
        note: e.note, title, updatedAt: at,
      }));
    }
    out.entries.push({ ...e, convertedTo: id, updatedAt: at + 1 });
  }
  return out;
}

export interface WeekItem { session: Session | null; entry: Entry }
export interface PhaseView {
  /** Sessions with no day yet, in the plan's order. */
  toPlace: Session[];
  /** Every day of the phase, with what's on it: sessions in the plan's order, then futsal. */
  days: { day: number; items: WeekItem[] }[];
}

/**
 * A phase as the page shows it: what's left to place, and each day with its sessions and futsal. Futsal is
 * read from [allEntries] as trainingEntries gives them: the calendar's futsal events.
 */
export function phaseView(plan: Plan, phase: number, entries: ReadonlyMap<string, Entry>, allEntries: Iterable<Entry>): PhaseView {
  const ph = plan.phases[phase];
  const toPlace: Session[] = [];
  const byDay = new Map<number, WeekItem[]>();
  for (let d = ph.start; d <= ph.end; d++) byDay.set(d, []);
  for (const s of ph.sessions) {
    const e = entryFor(plan, s, entries);
    const day = dayOfSession(s, entries.get(e.id));
    if (day === null) {
      // Done without being placed: on the day it was done. Skipped: stays with To place, shown as skipped.
      if (e.status === "done" && e.doneDay !== null) {
        if (!byDay.has(e.doneDay)) byDay.set(e.doneDay, []);
        byDay.get(e.doneDay)!.push({ session: s, entry: e });
      } else toPlace.push(s);
      continue;
    }
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push({ session: s, entry: e });
  }
  for (const e of allEntries) {
    if (e.planId !== plan.id || e.kind !== "futsal" || e.deletedAt !== null || e.day === null) continue;
    if (e.day >= ph.start && e.day <= ph.end) byDay.get(e.day)!.push({ session: null, entry: e });
  }
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, items]) => ({ day, items }));
  return { toPlace, days };
}

/** What's on a day across the plan: for the Today line and the calendar's marks. */
export function sessionsOnDay(plan: Plan, day: number, entries: ReadonlyMap<string, Entry>): { session: Session; entry: Entry }[] {
  const out: { session: Session; entry: Entry }[] = [];
  for (const s of sessionsOf(plan)) {
    const e = entries.get(entryId(plan.id, s.id));
    if (dayOfSession(s, e) === day) out.push({ session: s, entry: entryFor(plan, s, entries) });
  }
  return out;
}

/** Days with a session on them (placed or set by the plan), for the calendar's light marks. */
export function markedDays(plan: Plan, entries: ReadonlyMap<string, Entry>): Set<number> {
  const out = new Set<number>();
  for (const s of sessionsOf(plan)) {
    const day = dayOfSession(s, entries.get(entryId(plan.id, s.id)));
    if (day !== null && entries.get(entryId(plan.id, s.id))?.status !== "skipped") out.add(day);
  }
  return out;
}

/** Sessions of the phase around [day] still to place: for Today's "N to place this week". */
export function leftToPlace(plan: Plan, day: number, entries: ReadonlyMap<string, Entry>): Session[] {
  const ph = plan.phases[phaseIndexAt(plan, day)];
  if (!ph || day < ph.start) return [];
  return ph.sessions.filter((s) => !s.optional && dayOfSession(s, entries.get(entryId(plan.id, s.id))) === null &&
    (entries.get(entryId(plan.id, s.id))?.status ?? "planned") === "planned");
}

// ---------- After a plan update ----------

export interface PlanChange {
  kind: "removed" | "moved" | "outside";
  sessionId: string;
  title: string;
  /** The day the user had (removed, outside), or the plan's old day (moved). */
  day: number | null;
  /** The plan's new day (moved). */
  newDay?: number | null;
}

/** One change, as remembered once dismissed. */
export const changeKey = (c: PlanChange) => `${c.kind}:${c.sessionId}:${c.day ?? ""}:${c.newDay ?? ""}`;

/** A copy of what matters for the warning, saved when the user has seen the plan. */
export function seenOf(plan: Plan, now = Date.now()): SeenPlan {
  const sessions: SeenPlan["sessions"] = {};
  for (const s of sessionsOf(plan)) sessions[s.id] = { title: s.title, defaultDay: s.defaultDay };
  return { id: plan.id, sessions, seenAt: now };
}

/**
 * The changes in a plan update that affect a day, against what the user last saw: a session they had put
 * on a day was removed (or replaced, which gives it a new id); the plan moved a session's own day; or a
 * day the user picked is now outside its session's phase. Their own choices are kept either way.
 */
export function planChanges(plan: Plan, seen: SeenPlan | null, entries: Iterable<Entry>): PlanChange[] {
  const out: PlanChange[] = [];
  const now = new Map(sessionsOf(plan).map((s) => [s.id, s]));
  for (const e of entries) {
    if (e.planId !== plan.id || e.kind !== "session" || !e.sessionId || e.deletedAt !== null) continue;
    const s = now.get(e.sessionId);
    if (!s) {
      if (e.day !== null && e.status === "planned" && (!seen || seen.sessions[e.sessionId])) {
        out.push({ kind: "removed", sessionId: e.sessionId, title: e.title || e.sessionId, day: e.day });
      }
      continue;
    }
    const ph = plan.phases[s.phase];
    if (!s.locked && e.day !== null && e.status === "planned" && (e.day < ph.start || e.day > ph.end)) {
      out.push({ kind: "outside", sessionId: s.id, title: s.title, day: e.day });
    }
  }
  if (seen?.id === plan.id) {
    for (const s of now.values()) {
      const was = seen.sessions[s.id];
      if (was && was.defaultDay !== s.defaultDay) out.push({ kind: "moved", sessionId: s.id, title: s.title, day: was.defaultDay, newDay: s.defaultDay });
    }
  }
  return out;
}

// ---------- Lifting: pre-fill and bests ----------

/** The numbers in a target like "2–3", "6–8/side", "30 s": [low, high]; null when there are none. */
export function rangeOf(text: string): [number, number] | null {
  const ns = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(",", ".")));
  if (!ns.length) return null;
  return [ns[0], ns[Math.min(ns.length, 2) - 1]];
}

/** "3×5 @ 60 kg · RPE 5–6": the target as one line, kept with the logged sets. */
export function targetLine(x: SessionExercise): string {
  const parts = [`${x.sets || "?"}×${x.reps || "?"}${x.targetKg !== null ? ` @ ~${x.targetKg} kg` : ""}`];
  if (x.rpe) parts.push(`RPE ${x.rpe}`);
  return parts.join(" · ");
}

/** The latest earlier lift of an exercise (by the exercise actually done), for pre-filling. */
export function lastLift(lifts: Iterable<Lift>, exercise: string, before: { day: number; id: string }): Lift | null {
  let best: Lift | null = null;
  for (const l of lifts) {
    if (l.exercise !== exercise || l.id === before.id || l.day > before.day || !l.sets.some((s) => s.done)) continue;
    if (!best || l.day > best.day || (l.day === best.day && l.updatedAt > best.updatedAt)) best = l;
  }
  return best;
}

/**
 * The sets to start from: as many as the target's upper number ("2–3" → 3), each with the target's
 * weight, else last time's top weight, and the reps last done, else the target's lower number (never
 * to failure).
 */
export function prefillSets(x: SessionExercise, last: Lift | null): LiftSet[] {
  const count = Math.max(1, Math.min(10, rangeOf(x.sets)?.[1] ?? last?.sets.length ?? 3));
  const done = last?.sets.filter((s) => s.done) ?? [];
  const lastKg = done.reduce<number | null>((m, s) => (s.kg !== null && (m === null || s.kg > m) ? s.kg : m), null);
  const kg = x.targetKg ?? lastKg;
  const reps = done.length ? done[done.length - 1].reps : rangeOf(x.reps)?.[0] ?? null;
  return Array.from({ length: count }, () => ({ kg, reps, done: false }));
}

export const BEST_REPS = [1, 3, 5] as const;
export type Bests = Map<string, Map<number, { kg: number; day: number }>>;

/**
 * Rep bests per tracked exercise: the heaviest weight done for at least 1, 3 and 5 reps, counting only
 * sets from [since] on. Informational only: the plan says never to chase old numbers.
 */
export function repBests(lifts: Iterable<Lift>, tracked: ReadonlySet<string>, since: number | null, skip?: string): Bests {
  const out: Bests = new Map();
  for (const l of lifts) {
    if (l.id === skip || !tracked.has(l.exercise) || (since !== null && l.day < since)) continue;
    for (const s of l.sets) {
      if (!s.done || s.kg === null || s.reps === null || s.kg <= 0) continue;
      for (const n of BEST_REPS) {
        if (s.reps < n) continue;
        const m = out.get(l.exercise) ?? new Map();
        const cur = m.get(n);
        if (!cur || s.kg > cur.kg) m.set(n, { kg: s.kg, day: l.day });
        out.set(l.exercise, m);
      }
    }
  }
  return out;
}

/** The rep counts a lift sets a new best at, against every other lift: for the quiet "new best" mark. The first lift of an exercise sets none (nothing to beat yet). */
export function newBestsIn(lift: Lift, others: Iterable<Lift>, tracked: ReadonlySet<string>, since: number | null): number[] {
  if (!tracked.has(lift.exercise) || (since !== null && lift.day < since)) return [];
  const before = repBests(others, tracked, since, lift.id).get(lift.exercise);
  const mine = repBests([lift], tracked, since).get(lift.exercise);
  if (!mine || !before) return [];
  return BEST_REPS.filter((n) => { const m = mine.get(n); return !!m && (!before.get(n) || m.kg > before.get(n)!.kg); });
}

// ---------- The logs back to the plan session ----------

export function csv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
const isoOrEmpty = (d: number | null) => (d === null ? "" : isoOf(d));

/**
 * training-log-<plan id>.csv: one row per session that's on a day, done or skipped, then futsal and
 * records. New columns only ever go at the end (the plan session reads them by name). [entries] as
 * trainingEntries (or entriesWithGames) gives them: futsal rows are the calendar's games, with no session id.
 */
export function logCsv(plan: Plan, entries: Iterable<Entry>): string {
  const mine = [...entries].filter((e) => e.planId === plan.id && e.deletedAt === null);
  const byId = new Map(mine.map((e) => [e.id, e]));
  const rows: (string | number | null)[][] = [[
    "session_id", "kind", "status", "scheduled_date", "date_done", "duration_min", "pain_0_10", "effort_1_10", "note", "title", "detail",
  ]];
  const row = (e: Entry, day: number | null) => rows.push([
    e.sessionId ?? "", e.sport ? "sport" : e.kind, e.status, isoOrEmpty(day), isoOrEmpty(e.doneDay), e.durationMin, e.pain, e.effort, e.note, e.title, e.detail,
  ]);
  const listed = new Set<string>();
  for (const s of sessionsOf(plan)) {
    const e = byId.get(entryId(plan.id, s.id));
    const day = dayOfSession(s, e);
    if (day === null && (!e || e.status === "planned")) continue;
    row(e ?? entryFor(plan, s, byId), day);
    if (e) listed.add(e.id);
  }
  // Sessions the plan no longer has, but the user did or skipped: still history.
  for (const e of mine) if (e.kind === "session" && !listed.has(e.id) && e.status !== "planned") row(e, e.day);
  for (const e of mine.filter((e) => e.kind !== "session").sort((a, b) => (a.day ?? 0) - (b.day ?? 0))) row(e, e.day);
  return csv(rows);
}

/** training-sets-<plan id>.csv: one row per set done. RPE and pain are per exercise, on each of its rows. */
export function setsCsv(plan: Plan, lifts: Iterable<Lift>): string {
  const rows: (string | number | null)[][] = [[
    "session_id", "date", "exercise_id", "swapped_from", "set_no", "kg", "reps", "rpe", "pain_0_10", "note", "exercise_name",
  ]];
  const mine = [...lifts].filter((l) => l.planId === plan.id).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
  for (const l of mine) {
    let n = 0;
    for (const s of l.sets) {
      if (!s.done) continue;
      rows.push([l.sessionId, isoOf(l.day), l.exercise, l.exercise !== l.planned ? l.planned : "", ++n, s.kg, s.reps, l.rpe, l.pain, l.note, l.name]);
    }
  }
  return csv(rows);
}
