// The watch's activities on Training (item 268): what a session from Health Connect (healthSessions,
// domain/health.ts) adds to the activity it was. Pure; the store matches, the Training views show.
// - Futsal / football: Garmin's "football" (indoor or outdoor) arrives as Health Connect's "soccer". Each such
//   session is matched to the game (a Sports event's day, items 240 and 267) it was: the same day, and the
//   times overlap or start within 30 minutes (an untimed game takes any session that day). A futsal game is
//   preferred to another sport's; each game and each session is matched once. One left over shows on its own.
// - Distance only outdoors (indoors the watch's distance is a guess): a session with a GPS route is outdoor;
//   one whose title (or its game's) says futsal or indoor is indoor; else it can't be told, and the distance
//   (and the speed from it) shows as "≈".
// - Gym: the watch's strength sessions on a gym session's day add their time, heart rate and calories.
// - Runs: the run matched to a plan session (runs, healthRuns.ts) with its watch session's calories.
// Every stat shows only when the watch wrote it (Garmin writes no cadence, power or HRV here).
import type { HealthSession } from "./health.ts";
import type { Run } from "./trends.ts";

/** Health Connect's names for football ("soccer"; Garmin's "football", indoor or outdoor) and futsal. */
const FOOTBALL_TYPES = new Set(["soccer", "futsal"]);
/** Health Connect's names for a gym session. */
const STRENGTH_TYPES = new Set(["strength_training", "weightlifting", "calisthenics"]);
/** A session starting this close to a game's start is that game, even without an overlap (minutes). */
const NEAR_MIN = 30;

export const isFootballSession = (s: Pick<HealthSession, "exerciseType" | "title">) =>
  FOOTBALL_TYPES.has(s.exerciseType) || /futsal|football|soccer/i.test(s.title);
export const isStrengthSession = (s: Pick<HealthSession, "exerciseType">) => STRENGTH_TYPES.has(s.exerciseType);

/** Where it was played: outdoors (distance shown), indoors (no distance), or not known (distance "≈"). */
export type Venue = "outdoor" | "indoor" | "unknown";

/** [s]'s venue; [gameTitle]: the title of the game it was matched to, if any. */
export function venueOf(s: Pick<HealthSession, "route" | "title">, gameTitle = ""): Venue {
  if (s.route === true) return "outdoor";
  if (/futsal|indoor/i.test(`${s.title} ${gameTitle}`)) return "indoor";
  if (/outdoor/i.test(`${s.title} ${gameTitle}`)) return "outdoor";
  return "unknown";
}

/** What a session shows. Null where the watch wrote nothing; distance and speed null indoors. */
export interface WatchStats {
  durationS: number;
  /** Moving time, when it differs from the duration (pauses). */
  movingS: number | null;
  avgHr: number | null;
  maxHr: number | null;
  kcal: number | null;
  distanceKm: number | null;
  /** Average over the moving time, km/h. */
  speedKmh: number | null;
  /** Pace for a run, s/km. */
  paceSPerKm: number | null;
  ascentM: number | null;
  /** The distance and speed are a guess (venue unknown). */
  approx: boolean;
}

const pos = (v: number | null | undefined) => (v !== null && v !== undefined && v > 0 ? v : null);

/** A session's stats at [venue] (outdoor: all of them; indoor: no distance or speed; unknown: both "≈"). */
export function sessionStats(s: HealthSession, venue: Venue = "outdoor"): WatchStats {
  const moving = s.movingS > 0 ? s.movingS : s.durationS;
  const km = venue === "indoor" ? null : pos(s.distanceKm);
  return {
    durationS: s.durationS, movingS: s.movingS > 0 && Math.abs(s.movingS - s.durationS) >= 60 ? s.movingS : null,
    avgHr: pos(s.avgHr), maxHr: pos(s.maxHr), kcal: pos(s.kcal),
    distanceKm: km, speedKmh: km !== null && moving > 0 ? Math.round((km / (moving / 3600)) * 10) / 10 : null, paceSPerKm: null,
    ascentM: null, approx: km !== null && venue === "unknown",
  };
}

/** A run's stats (a plan run, from runs.json or the watch), with its watch session's calories when it has one. */
export function runStats(r: Run, s: HealthSession | undefined): WatchStats {
  const km = pos(r.distanceKm);
  const moving = pos(r.movingS) ?? pos(r.durationS);
  return {
    durationS: r.durationS ?? 0, movingS: r.movingS && r.durationS && Math.abs(r.movingS - r.durationS) >= 60 ? r.movingS : null,
    avgHr: pos(r.avgHr), maxHr: pos(r.maxHr), kcal: pos(s?.kcal),
    distanceKm: km, speedKmh: null,
    paceSPerKm: pos(r.paceSPerKm) ?? (km !== null && moving !== null ? Math.round(moving / km) : null),
    ascentM: pos(r.ascentM), approx: false,
  };
}

/** 3725 → "1:02:05", 2700 → "45:00". */
export function clock(s: number): string {
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}
const km1 = (km: number) => (Math.round(km * 10) / 10).toFixed(1).replace(/\.0$/, "");

/** The stats as label and value, in the order shown; only what's there. */
export function statItems(st: WatchStats): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null) => { if (value !== null) out.push({ label, value }); };
  const ap = st.approx ? "≈ " : "";
  add("Time", st.durationS > 0 ? clock(st.durationS) : null);
  add("Moving", st.movingS !== null ? clock(st.movingS) : null);
  add("Distance", st.distanceKm !== null ? `${ap}${km1(st.distanceKm)} km` : null);
  add("Pace", st.paceSPerKm !== null ? `${clock(st.paceSPerKm)} /km` : null);
  add("Speed", st.speedKmh !== null ? `${ap}${st.speedKmh.toFixed(1)} km/h` : null);
  add("Avg HR", st.avgHr !== null ? `${Math.round(st.avgHr)} bpm` : null);
  add("Max HR", st.maxHr !== null ? `${Math.round(st.maxHr)} bpm` : null);
  add("Calories", st.kcal !== null ? `${Math.round(st.kcal)} kcal` : null);
  add("Climb", st.ascentM !== null ? `${Math.round(st.ascentM)} m` : null);
  return out;
}

/** A row's short line: "62 min · 151 bpm · 540 kcal". */
export function statLine(st: WatchStats): string {
  return [
    st.durationS >= 60 ? `${Math.round(st.durationS / 60)} min` : "",
    st.avgHr !== null ? `${Math.round(st.avgHr)} bpm` : "",
    st.kcal !== null ? `${Math.round(st.kcal)} kcal` : "",
  ].filter(Boolean).join(" · ");
}

/** The note under an "≈" distance. */
export const APPROX_NOTE = "Indoors or out isn't known, so the distance is a guess (indoors it's often wrong).";

// ---------- Matching football sessions to games ----------

/** A game to match: its entry id (futsalLogId), its day and the event's times (null: untimed), futsal or another sport. */
export interface GameSlot { id: string; day: number; startMin: number | null; endMin: number | null; futsal: boolean }

/** Minutes from the day's start of a session's local start ("HH:MM"). */
const startMinOf = (s: HealthSession) => Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5));

export interface GameMatches {
  /** The session each game was, by the game's id. */
  byGame: Map<string, HealthSession>;
  /** Football sessions no game took, oldest first. */
  loose: HealthSession[];
}

/**
 * Each football session (isFootballSession) matched to the game it was: the same day, and the times overlap
 * or start within 30 minutes; an untimed game takes any that day. Best first: a futsal game over another
 * sport's, then the longest overlap, then the nearest start. Each game and session is taken once.
 */
export function matchGames(slots: readonly GameSlot[], sessions: readonly HealthSession[]): GameMatches {
  const football = sessions.filter(isFootballSession);
  const pairs: { slot: GameSlot; s: HealthSession; rank: number[] }[] = [];
  for (const s of football) {
    const a = startMinOf(s), b = a + s.durationS / 60;
    for (const slot of slots) {
      if (slot.day !== s.day) continue;
      if (slot.startMin === null) { pairs.push({ slot, s, rank: [slot.futsal ? 0 : 1, 1, 0, 0] }); continue; }
      const end = slot.endMin !== null && slot.endMin > slot.startMin ? slot.endMin : slot.startMin + 60;
      const overlap = Math.max(0, Math.min(b, end) - Math.max(a, slot.startMin));
      const near = Math.abs(a - slot.startMin);
      if (overlap <= 0 && near > NEAR_MIN) continue;
      pairs.push({ slot, s, rank: [slot.futsal ? 0 : 1, 0, -overlap, near] });
    }
  }
  pairs.sort((x, y) => x.rank.reduce((d, v, i) => d || v - y.rank[i], 0) || x.s.startMs - y.s.startMs);
  const byGame = new Map<string, HealthSession>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (byGame.has(p.slot.id) || used.has(p.s.id)) continue;
    byGame.set(p.slot.id, p.s);
    used.add(p.s.id);
  }
  return { byGame, loose: football.filter((s) => !used.has(s.id)).sort((a, b) => a.startMs - b.startMs) };
}

/** The watch's strength sessions on [day], oldest first: what a gym session that day adds. */
export const strengthOn = (sessions: readonly HealthSession[], day: number) =>
  sessions.filter((s) => s.day === day && isStrengthSession(s)).sort((a, b) => a.startMs - b.startMs);
