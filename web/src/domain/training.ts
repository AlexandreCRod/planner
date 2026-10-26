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
}
export interface Phase { name: string; start: number; end: number; summary: string; rules: string[]; notes: string[]; sessions: Session[] }
export interface HistoricalBest { exercise: string; kg: number; reps: number; label: string }
export interface EstimatedMax { exercise: string; kg: number; day: number | null; from: string }
export interface RunRecord { distance: string; time: string; day: number | null; source: string; note: string }
/** [low, high]. */
export type Range = [number, number];
/** A kind of day in the nutrition plan: its carbs, or only a note (race day: "see Race day"). */
export interface DayType { carbsG: Range | null; note: string }
export interface Nutrition {
  proteinG: Range | null;
  /** By key: "rest", "training", "long", "carb_load", "race"... */
  dayTypes: Map<string, DayType>;
  /** Days that are a given type whatever is on them (the carb load before the race). */
  dateOverrides: { day: number; dayType: string }[];
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
    dayTypes.set(key, { carbsG: asRange(obj(d).carbs_g, `${key} carbs_g`), note: str(obj(d).note) });
  }
  const dateOverrides: Nutrition["dateOverrides"] = [];
  for (const o of arr(n.date_overrides).map(obj)) {
    const day = dayOf(o.date), dayType = str(o.day_type).trim();
    if (day === null || !dayType) { problems.push(`A nutrition date override needs a date and a day_type ("${str(o.date)}").`); continue; }
    if (!dayTypes.has(dayType)) problems.push(`The nutrition override for ${str(o.date)} uses day type ${dayType}, which isn't in day_types.`);
    dateOverrides.push({ day, dayType });
  }
  return { proteinG: asRange(n.protein_g, "protein_g"), dayTypes, dateOverrides, kcalTarget: asRange(n.kcal_target, "kcal_target") };
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
        defaultDay, locked, optional: s.optional === true, extra: strs(s.extra), phase: index, dayType,
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
    return { name, start: ps ?? 0, end: pe ?? 0, summary: str(ph.summary), rules: strs(ph.rules), notes: strs(ph.notes), sessions };
  });
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

export interface WeekItem { session: Session | null; entry: Entry }
export interface PhaseView {
  /** Sessions with no day yet, in the plan's order. */
  toPlace: Session[];
  /** Every day of the phase, with what's on it: sessions in the plan's order, then futsal. */
  days: { day: number; items: WeekItem[] }[];
}

/** A phase as the page shows it: what's left to place, and each day with its sessions and futsal. */
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
 * records. New columns only ever go at the end (the plan session reads them by name).
 */
export function logCsv(plan: Plan, entries: Iterable<Entry>): string {
  const mine = [...entries].filter((e) => e.planId === plan.id && e.deletedAt === null);
  const byId = new Map(mine.map((e) => [e.id, e]));
  const rows: (string | number | null)[][] = [[
    "session_id", "kind", "status", "scheduled_date", "date_done", "duration_min", "pain_0_10", "effort_1_10", "note", "title", "detail",
  ]];
  const row = (e: Entry, day: number | null) => rows.push([
    e.sessionId ?? "", e.kind, e.status, isoOrEmpty(day), isoOrEmpty(e.doneDay), e.durationMin, e.pain, e.effort, e.note, e.title, e.detail,
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
