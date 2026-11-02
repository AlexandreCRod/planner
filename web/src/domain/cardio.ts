// Progress's Cardio tab (items 294, 269): what's worked out from the runs (trends.ts, healthRuns.ts) and the
// futsal games (training.ts, watchActivities.ts) over a stretch of days, and the notes on them. Pure; nothing
// here is stored but the notes (below). Days are epoch-day numbers; a stretch is [from, to).
// - Games: a game counts once it's played: ticked, or the watch caught it. Its title is its calendar event's.
//   A football session no event took is a game too, simply "Futsal".
// - Totals: km are runs only (indoor games have no distance). Futsal joins time and sessions by the switch.
// - Notes: a run tied to a plan session and a game with an event keep theirs in the training log (Entry.note,
//   so the plan session's CSV carries them). A run or game only the watch saw has no log: its note is a record
//   "trainingNotes", one per note, id = the run's or session's id, written only by the app.
import type { HealthSession } from "./health.ts";
import type { Entry, RunRecord } from "./training.ts";
import type { Run, RunType } from "./trends.ts";
import { type GameMatches, type Venue, type WatchStats, sessionStats, venueOf } from "./watchActivities.ts";

/** A note on a run or game with no log entry (records "trainingNotes"). Soft-deleted, so clearing it syncs. */
export interface ActivityNote { id: string; note: string; updatedAt: number; deletedAt: number | null }

/** The notes not deleted, by id. */
export function activityNotes(list: Iterable<ActivityNote>): Map<string, ActivityNote> {
  const out = new Map<string, ActivityNote>();
  for (const n of list) if (n.deletedAt === null && n.note.trim()) out.set(n.id, n);
  return out;
}

/** The record holding a note on [ids] (a run's id, then its merged copies'), when any does. */
export const noteRecord = (notes: ReadonlyMap<string, ActivityNote>, ids: readonly string[]): ActivityNote | undefined => {
  for (const id of ids) { const n = notes.get(id); if (n) return n; }
  return undefined;
};

/** Every id a run has gone by. */
export const runIds = (r: Pick<Run, "id" | "otherIds">): string[] => [r.id, ...(r.otherIds ?? [])];

/** A run's log entry: that of the plan session it was, when there is one. */
export function runEntry(r: Pick<Run, "sessionId">, entries: Iterable<Entry>): Entry | null {
  if (r.sessionId === null) return null;
  for (const e of entries) if (e.kind === "session" && e.sessionId === r.sessionId && e.deletedAt === null) return e;
  return null;
}

/** A run's note: its log's, else the one kept beside it. */
export function runNote(r: Pick<Run, "id" | "otherIds" | "sessionId">, entries: Iterable<Entry>, notes: ReadonlyMap<string, ActivityNote>): string {
  return runEntry(r, entries)?.note.trim() || noteRecord(notes, runIds(r))?.note.trim() || "";
}

// ---------- Games ----------

/** A futsal game on the Cardio tab. */
export interface Game {
  /** The log's id (futsalLogId), or the session's for one no event took. */
  id: string;
  day: number;
  title: string;
  /** Its title comes from a calendar event (no event: "Futsal"). */
  fromEvent: boolean;
  /** From the event; null when untimed or there's none. */
  startMin: number | null;
  endMin: number | null;
  /** Null: a watch session no event took. */
  entry: Entry | null;
  session: HealthSession | null;
  done: boolean;
}

export interface EventTimes { startMin: number | null; endMin: number | null }

/**
 * The futsal games known, oldest first: every game among [entries] (the games of another sport stay out of
 * Futsal), and each football session no game took. [times]: the events' times, by item id.
 */
export function gamesOf(entries: Iterable<Entry>, matches: GameMatches, times: ReadonlyMap<number, EventTimes>): Game[] {
  const out: Game[] = [];
  for (const e of entries) {
    if (e.kind !== "futsal" || e.sport || e.day === null || e.deletedAt !== null) continue;
    const t = e.itemId !== undefined ? times.get(e.itemId) : undefined;
    out.push({
      id: e.id, day: e.day, title: e.title, fromEvent: true, startMin: t?.startMin ?? null, endMin: t?.endMin ?? null,
      entry: e, session: matches.byGame.get(e.id) ?? null, done: e.status === "done",
    });
  }
  for (const s of matches.loose) out.push({ id: s.id, day: s.day, title: "Futsal", fromEvent: false, startMin: null, endMin: null, entry: null, session: s, done: true });
  return out.sort((a, b) => a.day - b.day || (a.startMin ?? -1) - (b.startMin ?? -1) || a.id.localeCompare(b.id));
}

/** The games played by [today]: ticked, or the watch caught them. */
export const playedGames = (games: readonly Game[], today: number): Game[] =>
  games.filter((g) => g.day <= today && (g.done || g.session !== null));

/** A game's note: its log's, else the one kept beside it, on the watch's session when the game had no event yet. */
export const gameNote = (g: Game, notes: ReadonlyMap<string, ActivityNote>) =>
  g.entry?.note.trim() || notes.get(g.session?.id ?? g.id)?.note.trim() || "";

export const gameVenue = (g: Game): Venue => (g.session ? venueOf(g.session, g.fromEvent ? g.title : "") : "unknown");
/** What the watch said of a game; null when it didn't catch it. */
export const gameWatch = (g: Game): WatchStats | null => (g.session ? sessionStats(g.session, gameVenue(g)) : null);
/** How long it was in seconds: the watch's, else the log's; 0 when neither says. */
export const gameSeconds = (g: Game) => g.session?.durationS ?? (g.entry?.durationMin ?? 0) * 60;

// ---------- Over a stretch of days ----------

/** A run's time in seconds: moving, else its whole length. */
export const runSeconds = (r: Pick<Run, "movingS" | "durationS">) => r.movingS || r.durationS || 0;

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const between = <T extends { day: number }>(xs: readonly T[], from: number, to: number) => xs.filter((x) => x.day >= from && x.day < to);

/** What fell in [from, to). */
export interface Tally { runs: Run[]; games: Game[]; km: number; runS: number; gameS: number }

export function tally(runs: readonly Run[], games: readonly Game[], from: number, to: number): Tally {
  const r = between(runs, from, to), g = between(games, from, to);
  return { runs: r, games: g, km: sum(r.map((x) => x.distanceKm ?? 0)), runS: sum(r.map(runSeconds)), gameS: sum(g.map(gameSeconds)) };
}

/** A tally's time in hours: runs, with the games when they count. */
export const tallyHours = (t: Tally, count: boolean) => (t.runS + (count ? t.gameS : 0)) / 3600;

/** How many a week [n] comes to over the days of [from, to) gone by [today]. */
export function perWeek(n: number, from: number, to: number, today: number): number {
  const days = Math.min(to, today + 1) - from;
  return days > 0 ? (n / days) * 7 : 0;
}

/** The average of the finished bars' values (the one still filling would pull it down); null with none. */
export function finishedAverage(bars: readonly { now: boolean; future: boolean }[], values: readonly number[]): number | null {
  const v = values.filter((_, i) => !bars[i].now && !bars[i].future);
  return v.length ? sum(v) / v.length : null;
}

/** The longest run among [runs]; null when none has a distance. */
export function longestRun(runs: readonly Run[]): Run | null {
  let best: Run | null = null;
  for (const r of runs) if (r.distanceKm !== null && (!best || r.distanceKm > best.distanceKm!)) best = r;
  return best;
}

/** A run's best 5 km in seconds: 5 km splits in a row when it has them, else its average pace over 5 km; null if shorter. */
export function fastest5kOf(r: Pick<Run, "distanceKm" | "paceSPerKm" | "splits">): number | null {
  if (r.distanceKm === null || r.distanceKm < 5) return null;
  const whole = (r.splits ?? []).filter((s) => Number.isInteger(s.km));
  if (whole.length >= 5) {
    let best = Infinity;
    for (let i = 0; i + 5 <= whole.length; i++) best = Math.min(best, sum(whole.slice(i, i + 5).map((s) => s.s)));
    return best;
  }
  return r.paceSPerKm !== null ? Math.round(r.paceSPerKm * 5) : null;
}

/** The fastest 5 km among [runs]: its run and time; null with no run of 5 km. */
export function fastest5k(runs: readonly Run[]): { run: Run; s: number } | null {
  let best: { run: Run; s: number } | null = null;
  for (const run of runs) { const s = fastest5kOf(run); if (s !== null && (!best || s < best.s)) best = { run, s }; }
  return best;
}

/** The plan's record for a distance ("5 km"), when it has one. */
export const recordFor = (records: readonly RunRecord[], distance: string): RunRecord | undefined =>
  records.find((r) => r.distance.trim().toLowerCase() === distance.toLowerCase());

// ---------- A run type's stats ----------

/** The types shown, in order, with their names. */
export const RUN_TYPE_NAMES: [RunType, string][] = [["easy", "Easy"], ["long", "Long"], ["quality", "Quality"], ["race", "Race"], ["other", "Other"]];
export const runTypeName = (t: string) => RUN_TYPE_NAMES.find(([k]) => k === t)?.[1] ?? "Other";

export interface TypeStats {
  count: number;
  km: number;
  /** Over the runs with both a distance and a time: total time ÷ total km; null with none. */
  paceS: number | null;
  /** The average of the runs' average heart rates; null with none. */
  hr: number | null;
  longestKm: number | null;
  /** Seconds a km faster from the first run with a pace to the last (negative: slower); null under two. */
  faster: number | null;
  /** Bpm up from the first run with a heart rate to the last; null under two. */
  hrChange: number | null;
}

/** The stats of [runs], oldest first. */
export function typeStats(runs: readonly Run[]): TypeStats {
  const timed = runs.filter((r) => r.distanceKm && runSeconds(r));
  const km = sum(runs.map((r) => r.distanceKm ?? 0));
  const paced = runs.filter((r) => r.paceSPerKm !== null), hrs = runs.filter((r) => r.avgHr !== null);
  const dist = runs.filter((r) => r.distanceKm !== null).map((r) => r.distanceKm!);
  return {
    count: runs.length, km,
    paceS: timed.length ? sum(timed.map(runSeconds)) / sum(timed.map((r) => r.distanceKm!)) : null,
    hr: hrs.length ? sum(hrs.map((r) => r.avgHr!)) / hrs.length : null,
    longestKm: dist.length ? Math.max(...dist) : null,
    faster: paced.length > 1 ? paced[0].paceSPerKm! - paced[paced.length - 1].paceSPerKm! : null,
    hrChange: hrs.length > 1 ? hrs[hrs.length - 1].avgHr! - hrs[0].avgHr! : null,
  };
}

// ---------- Games' stats ----------

export interface GameStats {
  count: number;
  seconds: number;
  /** A usual game: the middle length in minutes, of those with one; null with none. */
  usualMin: number | null;
  usualKcal: number | null;
  avgHr: number | null;
  /** The game with the highest heart rate. */
  hardest: Game | null;
  kcal: number;
}

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function gameStats(games: readonly Game[]): GameStats {
  const hr = games.filter((g) => g.session?.avgHr), kcal = games.filter((g) => g.session?.kcal);
  let hardest: Game | null = null;
  for (const g of games) if (g.session?.maxHr && (!hardest || g.session.maxHr > hardest.session!.maxHr!)) hardest = g;
  return {
    count: games.length, seconds: sum(games.map(gameSeconds)),
    usualMin: median(games.map(gameSeconds).filter((s) => s > 0).map((s) => s / 60)),
    usualKcal: median(kcal.map((g) => g.session!.kcal!)),
    avgHr: hr.length ? sum(hr.map((g) => g.session!.avgHr!)) / hr.length : null,
    hardest, kcal: sum(kcal.map((g) => g.session!.kcal!)),
  };
}
