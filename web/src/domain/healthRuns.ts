// The watch's runs from Health Connect (healthSessions, domain/health.ts) beside runs.json's (trends.ts), and
// what the phone does with them (items 213 and 217, 2.8.1's data plan). Pure; the store and the Training page
// call it.
// - mergedRuns: runs.json ∪ the running sessions. The same run (starts within 2 minutes, distances within 5%)
//   keeps one copy, by source: Health Connect, then the Garmin export (or the Garmin account), then Strava. The
//   kept copy takes what the plan session added to the other (its session and run type) when it has none.
// - The watch run ticks its session: a run from the watch on a day with exactly one run session of the plan,
//   not done yet, ticks it (and links it, Entry.watchRunId); with two run sessions that day or none, a chip asks
//   which. An untick remembers the run on the entry (watchRunsDismissed), "Not a plan run" hides it (records
//   "trainingHidden", kind "watchRun"), so neither comes back.
import type { HealthDay, HealthSession } from "./health.ts";
import { type Entry, type Plan, type Session, countedDay, csv, isoOf, dayOfSession, entryFor, entryId, phaseIndexAt, sessionsOf } from "./training.ts";
import { type Hidden, type Run, type RunType, byMoment } from "./trends.ts";

// ---------- Merging ----------

/** Health Connect's exercise types that are runs. */
const RUN_TYPES = new Set(["running", "running_treadmill"]);
export const isRunSession = (s: Pick<HealthSession, "exerciseType">) => RUN_TYPES.has(s.exerciseType) || s.exerciseType.startsWith("running");

/** Which copy of the same run is kept: lower first. */
export function sourceRank(source: string | null): number {
  if (source === "health_connect") return 0;
  if (source?.startsWith("garmin")) return 1;
  if (source === "strava") return 2;
  return 3;
}

/** A running session as a run: pace over moving time, the splits kept. Its type is "other" until something says. */
export function runOfSession(s: HealthSession): Run {
  const moving = s.movingS > 0 ? s.movingS : s.durationS;
  return {
    id: s.id, day: s.day, time: s.time, title: s.title || (s.exerciseType === "running_treadmill" ? "Treadmill run" : "Run"),
    sessionId: null, type: "other", source: "health_connect",
    distanceKm: s.distanceKm, durationS: s.durationS, movingS: s.movingS,
    paceSPerKm: s.distanceKm !== null && s.distanceKm > 0 && moving > 0 ? Math.round(moving / s.distanceKm) : null,
    avgHr: s.avgHr, maxHr: s.maxHr, cadenceSpm: s.cadenceSpm, ascentM: s.ascentM, splits: s.splits,
  };
}

const minuteOf = (r: Run) => (r.time ? r.day * 1440 + Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3, 5)) : null);

/**
 * Whether [a] and [b] are the same run: starts within 2 minutes (the same day when either has no time) and
 * distances within 5% of the longer (any, when either has none).
 */
export function sameRun(a: Run, b: Run): boolean {
  const ma = minuteOf(a), mb = minuteOf(b);
  if (ma !== null && mb !== null ? Math.abs(ma - mb) > 2 : a.day !== b.day) return false;
  if (a.distanceKm === null || b.distanceKm === null) return ma !== null && mb !== null;
  const most = Math.max(a.distanceKm, b.distanceKm);
  return most === 0 || Math.abs(a.distanceKm - b.distanceKm) <= 0.05 * most;
}

/**
 * Every run once, oldest first: runs.json's and the running sessions, the same run kept by [sourceRank].
 * [links] (run id → session id, from the entries' watchRunId) names the session a watch run ticked.
 */
export function mergedRuns(runsJson: readonly Run[], sessions: readonly HealthSession[], links: ReadonlyMap<string, string> = new Map()): Run[] {
  const all = [...sessions.filter(isRunSession).map(runOfSession), ...runsJson]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => sourceRank(a.r.source) - sourceRank(b.r.source) || a.i - b.i)
    .map((x) => x.r);
  const kept: Run[] = [];
  for (const r of all) {
    const twin = kept.find((k) => sameRun(k, r));
    if (!twin) { kept.push({ ...r }); continue; }
    // The plan session's own matching and type, when the kept copy has none.
    if (twin.sessionId === null) twin.sessionId = r.sessionId;
    if (twin.type === "other") twin.type = r.type;
  }
  for (const r of kept) { const sid = links.get(r.id); if (sid) r.sessionId = sid; }
  return kept.sort(byMoment);
}

/** A run's type from the plan session it ticked: race or long by its day type, quality by its tag, else easy. */
export function runTypeOf(s: Session): RunType {
  if (s.dayType === "race") return "race";
  if (s.dayType === "long" || /\blong\b/i.test(s.title)) return "long";
  if (s.tags.includes("quality")) return "quality";
  return "easy";
}

/** [runs] with the type of the session each is linked to, where it has none of its own. */
export function typedRuns(runs: Run[], plans: readonly Plan[]): Run[] {
  const byId = new Map<string, Session>();
  for (const p of plans) for (const s of sessionsOf(p)) byId.set(s.id, s);
  return runs.map((r) => {
    const s = r.type === "other" && r.sessionId ? byId.get(r.sessionId) : undefined;
    return s && s.kind === "run" ? { ...r, type: runTypeOf(s) } : r;
  });
}

// ---------- The watch run ticks its session ----------

/** The watch runs the entries link to their sessions (run id → session id): done, not deleted. */
export function watchLinks(entries: Iterable<Entry>): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entries) if (e.watchRunId && e.sessionId && e.deletedAt === null && e.status === "done") out.set(e.watchRunId, e.sessionId);
  return out;
}

/** The "trainingHidden" id of a watch run that isn't a plan run. */
export const hiddenRunId = (runId: string) => `watchRun:${runId}`;
/** The ids of the watch runs said not to be plan runs. */
export const hiddenWatchRuns = (list: Iterable<Hidden>): Set<string> =>
  new Set([...list].filter((h) => h.kind === "watchRun" && h.deletedAt === null).map((h) => h.pastId));

/** What a watch run does: tick its one run session that day, or ask which (the phase's run sessions not done, nearest first). */
export type WatchRunStep =
  | { kind: "tick"; run: Run; session: Session }
  | { kind: "ask"; run: Run; choices: Session[] };

/** Session [s] done by [run]: on the run's day, as long as it moved, linked to it. */
export function tickedEntry(plan: Plan, s: Session, entries: ReadonlyMap<string, Entry>, run: Run): Entry {
  const e = entryFor(plan, s, entries);
  const moving = run.movingS || run.durationS;
  return {
    ...e, title: s.title, detail: s.detail, status: "done", doneDay: run.day, day: s.locked ? e.day : run.day,
    durationMin: moving ? Math.round(moving / 60) : e.durationMin, watchRunId: run.id,
  };
}

/** Session [s] unticked: back to planned, and the watch run that ticked it never does again. */
export function untickedEntry(e: Entry): Partial<Entry> {
  if (!e.watchRunId) return {};
  return { watchRunId: null, watchRunsDismissed: [...new Set([...(e.watchRunsDismissed ?? []), e.watchRunId])] };
}

/**
 * What each watch run not yet used does, oldest first: Health Connect's runs within the plan, up to [today],
 * not linked to a session (by a tick or by the plan session), not unticked and not said to be no plan run.
 * Exactly one run session on its day (placed, or the plan's day), not done: it's ticked. One already done:
 * nothing. None, or two or more with one not done: ask. A tick counts for the runs after it (a second run that day finds the
 * session done).
 */
export function watchRunSteps(plan: Plan, entries: ReadonlyMap<string, Entry>, runs: readonly Run[], hidden: ReadonlySet<string>, today: number): WatchRunStep[] {
  const used = new Set<string>();
  for (const e of entries.values()) {
    if (e.planId !== plan.id) continue;
    if (e.watchRunId) used.add(e.watchRunId);
    for (const id of e.watchRunsDismissed ?? []) used.add(id);
  }
  const work = new Map(entries);
  const runSessions = sessionsOf(plan).filter((s) => s.kind === "run");
  const out: WatchRunStep[] = [];
  for (const run of [...runs].sort(byMoment)) {
    if (run.source !== "health_connect" || !run.id.startsWith("hc:") || run.sessionId !== null || used.has(run.id) || hidden.has(run.id)) continue;
    if (run.day < plan.start || run.day > plan.end || run.day > today) continue;
    const onDay = runSessions.filter((s) => countedDay(s, work.get(entryId(plan.id, s.id))) === run.day);
    if (onDay.length === 1) {
      const s = onDay[0];
      if ((work.get(entryId(plan.id, s.id))?.status ?? "planned") !== "planned") continue;
      const e = tickedEntry(plan, s, work, run);
      work.set(e.id, e);
      out.push({ kind: "tick", run, session: s });
      continue;
    }
    // Two or more, all done or skipped already: nothing left to tick.
    if (onDay.length > 1 && onDay.every((s) => (work.get(entryId(plan.id, s.id))?.status ?? "planned") !== "planned")) continue;
    const ph = phaseIndexAt(plan, run.day);
    const choices = runSessions
      .filter((s) => s.phase === ph && (work.get(entryId(plan.id, s.id))?.status ?? "planned") === "planned")
      .map((s, i) => ({ s, i, day: dayOfSession(s, work.get(entryId(plan.id, s.id))) }))
      .sort((a, b) => (a.day === null ? Infinity : Math.abs(a.day - run.day)) - (b.day === null ? Infinity : Math.abs(b.day - run.day)) || a.i - b.i)
      .map((x) => x.s);
    out.push({ kind: "ask", run, choices });
  }
  return out;
}

// ---------- The pull's CSVs for the plan session (columns sent 2026-10-28; new ones only at the end) ----------

/** runs.csv: every run once (mergedRuns), oldest first; session_id is the session it ticked, else runs.json's own. */
export function runsCsv(runs: Iterable<Run>): string {
  const rows: (string | number | null)[][] = [[
    "id", "date", "time", "title", "session_id", "type", "source", "distance_km", "duration_s", "moving_s", "pace_s_per_km",
    "avg_hr", "max_hr", "cadence_spm", "ascent_m", "splits_json",
  ]];
  for (const r of [...runs].sort(byMoment)) {
    rows.push([
      r.id, isoOf(r.day), r.time, r.title, r.sessionId, r.type, r.source, r.distanceKm, r.durationS, r.movingS ?? null, r.paceSPerKm,
      r.avgHr, r.maxHr, r.cadenceSpm, r.ascentM, r.splits?.length ? JSON.stringify(r.splits) : null,
    ]);
  }
  return csv(rows);
}

/** workouts.csv: the watch's other sessions (walks, gym, futsal...), oldest first. */
export function workoutsCsv(sessions: Iterable<HealthSession>): string {
  const rows: (string | number | null)[][] = [["id", "date", "time", "type", "title", "duration_s", "distance_km", "kcal", "avg_hr", "max_hr"]];
  for (const s of [...sessions].filter((x) => !isRunSession(x)).sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))) {
    rows.push([s.id, isoOf(s.day), s.time, s.exerciseType, s.title, s.durationS, s.distanceKm, s.kcal, s.avgHr, s.maxHr]);
  }
  return csv(rows);
}

/** daily.csv: one row per day Health Connect has, oldest first. */
export function dailyCsv(days: Iterable<HealthDay>): string {
  const rows: (string | number | null)[][] = [[
    "date", "steps", "distance_km", "kcal_total", "kcal_active", "floors", "ascent_m", "resting_hr", "hrv_ms", "avg_spo2", "avg_respiration",
    "hr_min", "hr_avg", "hr_max", "vo2max",
  ]];
  for (const x of [...days].sort((a, b) => a.day - b.day)) {
    rows.push([
      isoOf(x.day), x.steps, x.distanceKm, x.kcalTotal, x.kcalActive, x.floors, x.ascentM, x.restingHr, x.hrvMs, x.spo2, x.respiration,
      x.hrMin, x.hrAvg, x.hrMax, x.vo2max,
    ]);
  }
  return csv(rows);
}
