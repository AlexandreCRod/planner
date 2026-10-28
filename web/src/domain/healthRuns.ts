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
import type { HealthSession } from "./health.ts";
import { type Plan, type Session, sessionsOf } from "./training.ts";
import { type Run, type RunType, byMoment } from "./trends.ts";

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
