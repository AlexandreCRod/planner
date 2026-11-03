// Estimated stats for a fitness event marked done with no watch data (item 340): a game (futsal or another
// sport) or a plan run the watch didn't record. Pure and worked out on read: nothing is stored, so an estimate
// goes by itself once the watch's data arrives. Shown with "≈" and "Estimate: no watch data", and never counted
// in records, bests, "hardest", pace or heart-rate trends or a chart's recorded points.
// - The sample: the latest 8 recorded occurrences of the same event (the same calendar series, or the same
//   title), up to its day; with fewer than 3 of those, the latest 8 of the same kind (games of that sport, or
//   runs). Recorded: the watch wrote a time and calories or a heart rate.
// - Calories: the sample's median kcal per minute × this event's own length. Heart rate: the sample's median
//   average heart rate. Medians, so one odd game (a watch left running) doesn't pull it.
// - A run's distance: the plan's target when the session names one ("8 km"), else its length ÷ the usual pace
//   of that kind of run; its length, when not logged, from the plan ("45 min") or the target ÷ the usual pace.
//   Reps ("6 x 1 km", "4×4 min", "8x1' / 1'") are never taken for the run's distance or time (review of 2.10.1,
//   finding 3); an interval session that names nothing else takes its logged length, else the usual length of that
//   same session's recorded runs (3 or more), else it gets no estimate.
// - Every guessed value has "≈", the time too when it isn't the logged (or, for a game, the event's) length.
import type { HealthSession } from "./health.ts";
import type { Entry, Session } from "./training.ts";
import type { Run } from "./trends.ts";

/** How many recorded occurrences an estimate takes, and how many of the same event it needs before the kind's. */
export const SAMPLE = 8, MIN_SAME = 3;

/** One recorded occurrence: what the watch said of it. */
export interface Recorded {
  day: number;
  /** The calendar series (event id) or the plan session's title, lower case: "the same event". */
  series: string;
  title: string;
  durationS: number;
  kcal: number | null;
  avgHr: number | null;
  /** Runs: seconds a km; null for games. */
  paceSPerKm: number | null;
}

export interface Estimate {
  /** Its own length (logged or planned), seconds; 0 when not known. */
  durationS: number;
  /** The length is a guess (the plan's, or the usual), not logged or the event's: shown with "≈". */
  timeGuessed: boolean;
  kcal: number | null;
  avgHr: number | null;
  /** Runs only. */
  distanceKm: number | null;
  /** How many occurrences it's from, and whether they were the same event or only the same kind. */
  from: number;
  same: boolean;
}

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const norm = (s: string) => s.trim().toLowerCase();
const pos = (v: number | null | undefined) => (v !== null && v !== undefined && v > 0 ? v : null);

/** The occurrences an estimate for [day]'s [series] is made from (see the top), newest first. */
export function sampleFor<T extends Recorded>(series: string, day: number, history: readonly T[]): { list: T[]; same: boolean } {
  const usable = history.filter((h) => h.durationS > 0 && (h.kcal !== null || h.avgHr !== null || h.paceSPerKm !== null));
  // Up to its day; an event older than everything recorded takes the earliest ones there are.
  const before = usable.filter((h) => h.day <= day);
  const pool = (before.length ? before : usable).sort((a, b) => b.day - a.day);
  const same = pool.filter((h) => h.series === series);
  return same.length >= MIN_SAME ? { list: same.slice(0, SAMPLE), same: true } : { list: pool.slice(0, SAMPLE), same: false };
}

/** The usual calories and heart rate of [list] for [durationS] seconds; null when there's nothing to go by. */
function usual(list: readonly Recorded[], durationS: number): { kcal: number | null; avgHr: number | null } {
  const perMin = median(list.filter((h) => h.kcal !== null).map((h) => h.kcal! / (h.durationS / 60)));
  const hr = median(list.filter((h) => h.avgHr !== null).map((h) => h.avgHr!));
  return { kcal: perMin !== null && durationS > 0 ? Math.round(perMin * (durationS / 60)) : null, avgHr: hr !== null ? Math.round(hr) : null };
}

/** A game's estimate: [durationS] its logged (or its event's) length; null with no length or nothing recorded to go by. */
export function estimateGame(series: string, day: number, durationS: number, history: readonly Recorded[]): Estimate | null {
  if (durationS <= 0) return null;
  const { list, same } = sampleFor(series, day, history);
  if (!list.length) return null;
  const u = usual(list, durationS);
  if (u.kcal === null && u.avgHr === null) return null;
  return { durationS, timeGuessed: false, ...u, distanceKm: null, from: list.length, same };
}

/** A game's series: its calendar event when it has one, else its title. */
export const gameSeries = (e: Pick<Entry, "itemId" | "title">) => (e.itemId !== undefined ? `event:${e.itemId}` : `title:${norm(e.title)}`);

/** A game's length in seconds: the log's, else its event's; 0 when neither says. */
export const gameLength = (e: Pick<Entry, "durationMin">, times: { startMin: number | null; endMin: number | null } | undefined) =>
  e.durationMin ? e.durationMin * 60 : times && times.startMin !== null && times.endMin !== null && times.endMin > times.startMin ? (times.endMin - times.startMin) * 60 : 0;

/**
 * The recorded games of one kind (futsal, or another sport: [sport]) among [entries], with the watch's session
 * each was matched to ([byGame], by the entry's id); for futsal also the football sessions no game took ([loose]).
 */
export function recordedGames(entries: Iterable<Entry>, byGame: ReadonlyMap<string, HealthSession>, sport: boolean, loose: readonly HealthSession[] = []): Recorded[] {
  const out: Recorded[] = [];
  for (const e of entries) {
    if (e.kind !== "futsal" || !!e.sport !== sport || e.day === null || e.deletedAt !== null) continue;
    const s = byGame.get(e.id);
    if (!s || !(s.durationS > 0)) continue;
    out.push({ day: e.day, series: gameSeries(e), title: e.title, durationS: s.durationS, kcal: pos(s.kcal), avgHr: pos(s.avgHr), paceSPerKm: null });
  }
  if (!sport) for (const s of loose) if (s.durationS > 0) out.push({ day: s.day, series: "", title: s.title, durationS: s.durationS, kcal: pos(s.kcal), avgHr: pos(s.avgHr), paceSPerKm: null });
  return out;
}

/** A game marked done that the watch didn't catch: its estimate from the others of its kind; null otherwise. */
export function gameEstimate(e: Entry, watched: boolean, entries: Iterable<Entry>, byGame: ReadonlyMap<string, HealthSession>,
  times: { startMin: number | null; endMin: number | null } | undefined, loose: readonly HealthSession[] = []): Estimate | null {
  if (watched || e.status !== "done" || e.day === null) return null;
  return estimateGame(gameSeries(e), e.day, gameLength(e, times), recordedGames(entries, byGame, !!e.sport, loose));
}

// ---------- Runs ----------

// A set of reps, with its recovery: "6 x 1 km", "5x1km", "4×4 min", "Fartlek 8x1' / 1'", "6 x 400 m".
const UNIT = String.raw`(?:km\b|k\b|mins?\b|minutes?\b|m\b|secs?\b|s\b|'|")?`;
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const REPS = new RegExp(String.raw`\d+\s*[x×]\s*${NUM}\s*${UNIT}(?:\s*\/\s*${NUM}\s*${UNIT})?`, "gi");

/** [text] without its reps, which say nothing of the whole run's distance or time. */
export const withoutReps = (text: string) => text.replace(REPS, " ");
/** Whether [text] names reps ("6 x 1 km"): an interval session. */
export const namesReps = (text: string) => withoutReps(text) !== text;

/** The kilometres a plan session names ("Easy 8 km", "10K"), never a rep's ("6 x 1 km"); null when it names none. */
export function targetKm(text: string): number | null {
  text = withoutReps(text);
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:km|k)\b/i);
  const v = m ? Number(m[1].replace(",", ".")) : NaN;
  return v > 0 && v < 100 ? v : null;
}

/** The minutes a plan session names ("45 min", "1 h 10 min", "60'"), never a rep's ("4×4 min"); null when it names none. */
export function targetMin(text: string): number | null {
  text = withoutReps(text);
  const h = text.match(/(\d+(?:[.,]\d+)?)\s*h(?:ours?|rs?)?\b(?:\s*(\d+)\s*(?:min|m)\b)?/i);
  if (h) return Math.round(Number(h[1].replace(",", ".")) * 60 + Number(h[2] ?? 0));
  const m = text.match(/(\d+)\s*(?:min(?:utes?|s)?|')(?![a-z])/i);
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

/** The recorded runs, with the calories of the watch session each was (by id). */
export function recordedRuns(runs: readonly Run[], sessions: readonly HealthSession[]): (Recorded & { type: Run["type"] })[] {
  const kcal = new Map(sessions.map((s) => [s.id, pos(s.kcal)]));
  return runs.flatMap((r) => {
    const s = pos(r.movingS) ?? pos(r.durationS);
    return s === null ? [] : [{ day: r.day, series: `title:${norm(r.title)}`, title: r.title, durationS: s, kcal: kcal.get(r.id) ?? null, avgHr: pos(r.avgHr), paceSPerKm: pos(r.paceSPerKm), type: r.type }];
  });
}

/**
 * A plan run marked done that the watch didn't record ([s] the session, [e] its log, [day] the day it was done):
 * its estimate from the recorded runs (see the top). Null when it isn't one, or nothing says how long or how far.
 */
export function runEstimate(s: Pick<Session, "title" | "detail">, e: Pick<Entry, "status" | "durationMin">, day: number, runs: readonly Run[], sessions: readonly HealthSession[]): Estimate | null {
  if (e.status !== "done") return null;
  const history = recordedRuns(runs, sessions);
  const series = `title:${norm(s.title)}`;
  const { list, same } = sampleFor(series, day, history);
  if (!list.length) return null;
  // The usual pace of that kind of run: of the same session's runs, else of runs of their type, else of all.
  const type = same ? list[0].type : null;
  const paceOf = (xs: readonly { paceSPerKm: number | null }[]) => median(xs.filter((h) => h.paceSPerKm !== null).map((h) => h.paceSPerKm!));
  const pace = paceOf(list) ?? (type ? paceOf(history.filter((h) => h.type === type)) : null) ?? paceOf(history);
  const text = `${s.title} ${s.detail}`;
  const km = targetKm(text);
  let durationS = e.durationMin ? e.durationMin * 60 : (targetMin(text) ?? 0) * 60;
  if (!durationS && km !== null && pace !== null) durationS = Math.round(km * pace);
  // Intervals that name only their reps: the usual length of that same session, when it has been recorded.
  if (!durationS && same && namesReps(text)) durationS = Math.round(median(list.map((h) => h.durationS))!);
  if (!durationS) return null;
  const distanceKm = km ?? (pace !== null ? Math.round((durationS / pace) * 10) / 10 : null);
  const u = usual(list, durationS);
  return { durationS, timeGuessed: !e.durationMin, ...u, distanceKm, from: list.length, same };
}

// ---------- Words ----------

/** An estimate's length: "45 min", or "≈ 45 min" when it's a guess. */
export const estimateTime = (x: Estimate) => `${x.timeGuessed ? "≈ " : ""}${Math.round(x.durationS / 60)} min`;

/**
 * "≈ 640 kcal · ≈ 148 bpm" (with its length first when [withTime]); with [tag] it ends "· estimate", for a row
 * whose heading doesn't already say "Estimate: no watch data" (the week plan, Today's done card).
 */
export function estimateLine(x: Estimate, withTime = true, tag = false): string {
  return [
    withTime && x.durationS >= 60 ? estimateTime(x) : "",
    x.distanceKm !== null ? `≈ ${x.distanceKm.toFixed(1).replace(/\.0$/, "")} km` : "",
    x.avgHr !== null ? `≈ ${x.avgHr} bpm` : "",
    x.kcal !== null ? `≈ ${x.kcal} kcal` : "",
    tag ? "estimate" : "",
  ].filter(Boolean).join(" · ");
}

/** The line under an estimate's numbers (its heading says "Estimate: no watch data"): what it's from. */
export const estimateNote = (x: Estimate, what: "game" | "run") =>
  `From your last ${x.from === 1 ? what : `${x.from} ${what}s`}${x.same ? " like this one" : ""}, scaled to its length.`;
