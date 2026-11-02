// Sleep, resting heart rate and HRV: one night per morning, merged from the two places they come from.
// - sleep.json (trends.ts, `Night`): Garmin's history, pushed by the plan session; it has the sleep score.
// - Health Connect (health.ts): healthNights (one per sleep session) and healthDays (resting HR and HRV
//   per day), read by the phone from the watch.
// On the same morning Health Connect wins; sleep.json fills what it lacks (score, and resting HR or HRV when
// Health Connect has none that day). A morning with two sleep sessions keeps the longest, and a nap (a
// session that starts after 10:00 on the day it ends) never counts as the night.
// Also the numbers drawn from them: the 7-day averages, the HRV normal range, and the quiet flags the
// Training page shows (under 6 h before a key run, resting HR up two mornings in a row). Nothing is stored.
// Every average counts only what was recorded (321): a morning with no number, or a 0 (a session that was
// all awake), is left out, never counted as nothing, and a morning with only a resting HR is no sleep record.
// A night's stages (308): the watch's stretches, cleaned for the chart; a night may have only totals (the Garmin
// export always does; Health Connect may too), and then its timeline is empty.
// Days are epoch-day numbers (domain/dates.ts).
import type { HealthDay, HealthNight, StageSpan } from "./health.ts";
import { csv, isoOf } from "./training.ts";
import type { Night } from "./trends.ts";

/** Where a number came from: sleep.json ("garmin", shown "from Garmin") or the watch ("health_connect"). */
export type SleepSource = "garmin" | "health_connect";

/** One morning: the night that ended on it, and that morning's resting HR and HRV. Any number may be null. */
export interface SleepNight {
  day: number;
  /** Local "YYYY-MM-DDTHH:MM". */
  bed: string | null;
  wake: string | null;
  /** Asleep (deep + light + REM). */
  totalMin: number | null;
  awakeMin: number | null;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  /** The night's stretches in order (minutes from bed); none when only its totals are known. */
  spans: NightSpan[];
  score: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  /** Where the sleep came from (with no sleep that morning: where its other numbers came from). */
  source: SleepSource;
  restingHrSource: SleepSource | null;
  hrvSource: SleepSource | null;
}

/** The four rows of a night's chart, top to bottom: the higher, the lighter the sleep. */
export type NightStage = "awake" | "rem" | "light" | "deep";
export const NIGHT_STAGES: readonly NightStage[] = ["awake", "rem", "light", "deep"];
/** One stretch in one stage, in minutes from bed. */
export interface NightSpan { stage: NightStage; from: number; to: number }

const ROW: Partial<Record<StageSpan[0], NightStage>> = { awake: "awake", awake_in_bed: "awake", out_of_bed: "awake", rem: "rem", light: "light", deep: "deep" };

/**
 * The stretches to draw: in order, the awake kinds as one, side by side stretches in one stage joined, empty
 * ones gone. A watch's plain "sleeping" says nothing about stages, so it isn't drawn; with no real stage at all
 * there's no timeline (the night has totals only).
 */
export function nightSpans(stages: readonly StageSpan[]): NightSpan[] {
  const out: NightSpan[] = [];
  for (const [kind, from, to] of [...stages].sort((a, b) => a[1] - b[1])) {
    const stage = ROW[kind];
    if (!stage || to <= from) continue;
    const last = out[out.length - 1];
    if (last && last.stage === stage && from <= last.to) last.to = Math.max(last.to, to);
    else out.push({ stage, from, to });
  }
  return out.some((x) => x.stage !== "awake") ? out : [];
}

/** The stretch at minute [m] of the night, else the nearest; null with none. */
export function spanAt(spans: readonly NightSpan[], m: number): number | null {
  let best: number | null = null, gap = Infinity;
  spans.forEach((x, i) => {
    const d = m < x.from ? x.from - m : m > x.to ? m - x.to : 0;
    if (d < gap) { gap = d; best = i; }
  });
  return best;
}

/** The minutes in each stage, as far as known; null with no stage totals at all. Awake unknown counts as none. */
export function nightTotals(n: Pick<SleepNight, "awakeMin" | "deepMin" | "lightMin" | "remMin">): Record<NightStage, number> | null {
  if (n.deepMin === null && n.lightMin === null && n.remMin === null) return null;
  return { awake: n.awakeMin ?? 0, rem: n.remMin ?? 0, light: n.lightMin ?? 0, deep: n.deepMin ?? 0 };
}

/** How many nights "usual" is taken over. */
export const USUAL_NIGHTS = 30;

/** What's usual for the night on [day]: the averages over the 30 nights before it that have them; null where none do. */
export function usualNight(nights: readonly SleepNight[], day: number): { asleep: number | null; stages: Record<NightStage, number> | null } {
  const before = withRecord(nights, "totalMin").filter((n) => n.day < day).slice(-USUAL_NIGHTS);
  const totals = before.flatMap((n) => { const x = nightTotals(n); return x ? [x] : []; });
  const avg = (k: NightStage) => mean(totals.map((x) => x[k]));
  return {
    asleep: before.length ? mean(before.map((n) => n.totalMin!)) : null,
    stages: totals.length ? { awake: avg("awake"), rem: avg("rem"), light: avg("light"), deep: avg("deep") } : null,
  };
}

const momentMin = (t: string) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16)) / 60_000;
/** The minutes between two local moments. */
export const inBedMin = (bed: string, wake: string) => Math.max(0, momentMin(wake) - momentMin(bed));
/** The clock [min] minutes after a local moment: "03:48". */
export function clockAfter(t: string, min: number): string {
  const m = (((Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)) + Math.round(min)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A nap: a session that starts after 10:00 on the day it ends. It's kept in Health Connect but never the night. */
export function isNap(n: { bed: string; wake: string }): boolean {
  return n.bed.slice(0, 10) === n.wake.slice(0, 10) && Number(n.bed.slice(11, 13)) >= 10;
}

/**
 * Every morning that has a night, a resting HR or an HRV, oldest first. Per morning: the longest Health
 * Connect session that isn't a nap, else sleep.json's night; the score from sleep.json; resting HR and HRV
 * from healthDays when there, else from sleep.json.
 */
export function mergedNights(sleepJson: readonly Night[], hc: readonly HealthNight[], days: readonly HealthDay[]): SleepNight[] {
  const garmin = new Map(sleepJson.map((n) => [n.day, n]));
  const watch = new Map<number, HealthNight>();
  for (const n of hc) {
    if (isNap(n) || n.totalMin <= 0) continue; // all awake: no sleep record, so it can't hide sleep.json's night
    const had = watch.get(n.day);
    if (!had || n.totalMin > had.totalMin) watch.set(n.day, n);
  }
  const daily = new Map(days.map((d) => [d.day, d]));
  const all = new Set([...garmin.keys(), ...watch.keys(), ...[...daily.values()].filter((d) => d.restingHr !== null || d.hrvMs !== null).map((d) => d.day)]);
  const out: SleepNight[] = [];
  for (const day of [...all].sort((a, b) => a - b)) {
    const g = garmin.get(day), w = watch.get(day), d = daily.get(day);
    const rhr = d?.restingHr ?? null, hrv = d?.hrvMs ?? null;
    const restingHr = rhr ?? g?.restingHr ?? null, hrvMs = hrv ?? g?.hrvMs ?? null;
    const sleep = w
      ? { bed: w.bed, wake: w.wake, totalMin: w.totalMin, awakeMin: w.awakeMin, deepMin: w.deepMin, lightMin: w.lightMin, remMin: w.remMin, spans: nightSpans(w.stages ?? []) }
      : { bed: g?.bed ?? null, wake: g?.wake ?? null, totalMin: g?.totalMin ?? null, awakeMin: g?.awakeMin ?? null, deepMin: g?.deepMin ?? null, lightMin: g?.lightMin ?? null, remMin: g?.remMin ?? null, spans: [] };
    out.push({
      day, ...sleep, score: g?.score ?? null, restingHr, hrvMs,
      source: w || (!g?.totalMin && d) ? "health_connect" : "garmin",
      restingHrSource: restingHr === null ? null : rhr !== null ? "health_connect" : "garmin",
      hrvSource: hrvMs === null ? null : hrv !== null ? "health_connect" : "garmin",
    });
  }
  return out;
}

export type SleepField = "totalMin" | "restingHr" | "hrvMs";

/** Whether a morning has a record of [field]: a real number, not none and not 0. */
export const hasRecord = (n: SleepNight, field: SleepField) => (n[field] ?? 0) > 0;
/** The mornings that have a record of [field], in the order given. */
export const withRecord = (nights: readonly SleepNight[], field: SleepField) => nights.filter((n) => hasRecord(n, field));

/** The recorded values of [field] on the mornings from [from] to [to] (both included). [nights] are oldest first. */
function valuesIn(nights: readonly SleepNight[], field: SleepField, from: number, to: number): number[] {
  const out: number[] = [];
  for (const n of nights) if (n.day >= from && n.day <= to && hasRecord(n, field)) out.push(n[field]!);
  return out;
}
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The average of [field] over those of the 7 mornings to [day] (it included) that have a record; null when none has. */
export function avg7(nights: readonly SleepNight[], field: SleepField, day: number): number | null {
  const xs = valuesIn(nights, field, day - 6, day);
  return xs.length ? mean(xs) : null;
}

/** The 7-day averages of sleep, resting HR and HRV as of [day], and how many [nights] the sleep one is over. */
export function sleepAverages(nights: readonly SleepNight[], day: number): { sleepMin: number | null; nights: number; restingHr: number | null; hrvMs: number | null } {
  return {
    sleepMin: avg7(nights, "totalMin", day), nights: valuesIn(nights, "totalMin", day - 6, day).length,
    restingHr: avg7(nights, "restingHr", day), hrvMs: avg7(nights, "hrvMs", day),
  };
}

/** What a sleep average is based on: "5 of 7 nights", so one from few nights shows. */
export const nightsOf7 = (count: number) => `${count} of 7 nights`;

/** The 7-day average line: one point per morning that has [field], its value the average of the 7 mornings to it. */
export function avg7Line(nights: readonly SleepNight[], field: SleepField): { day: number; v: number }[] {
  return withRecord(nights, field).map((n) => ({ day: n.day, v: avg7(nights, field, n.day)! }));
}

/** How many nights the HRV normal range is taken over, and the fewest it needs. */
export const HRV_NIGHTS = 60, HRV_MIN_NIGHTS = 14;

/**
 * The user's normal HRV as of [day]: the mean of the last 60 nights with an HRV (to [day], it included)
 * ± 1 standard deviation. Null with fewer than 14 such nights.
 */
export function hrvRange(nights: readonly SleepNight[], day: number): { lo: number; hi: number; mean: number } | null {
  const xs: number[] = [];
  for (let i = nights.length - 1; i >= 0 && xs.length < HRV_NIGHTS; i--) {
    const n = nights[i];
    if (n.day <= day && hasRecord(n, "hrvMs")) xs.push(n.hrvMs!);
  }
  if (xs.length < HRV_MIN_NIGHTS) return null;
  const m = mean(xs), sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
  return { lo: m - sd, hi: m + sd, mean: m };
}

/** Under this much sleep before a key run puts a moon on it. */
export const SHORT_SLEEP_MIN = 360;

/** The minutes slept the night before [day] (the night ending that morning) when under 6 h; else null. */
export function shortSleepBefore(nights: readonly SleepNight[], day: number): number | null {
  const n = nights.find((x) => x.day === day);
  return n && n.totalMin !== null && n.totalMin > 0 && n.totalMin < SHORT_SLEEP_MIN ? n.totalMin : null;
}

/** How far above its own 7-day average resting HR has to be, and on how many mornings running. */
export const RESTING_HR_UP = 7;

/**
 * Whether resting HR is up: 7 or more bpm above its own average (the 7 mornings before, at least 3 of them
 * with one) on the morning of [day] and the one before.
 */
export function restingHrFlag(nights: readonly SleepNight[], day: number): boolean {
  const up = (d: number) => {
    const n = nights.find((x) => x.day === d);
    if (!n || n.restingHr === null) return false;
    const before = valuesIn(nights, "restingHr", d - 7, d - 1);
    return before.length >= 3 && n.restingHr - mean(before) >= RESTING_HR_UP;
  };
  return up(day) && up(day - 1);
}

/** "7 h 12", "6 h 05", "45 min". */
export function fmtSleep(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** "23:10" from a local "YYYY-MM-DDTHH:MM"; null passes through. */
export const clockOfMoment = (t: string | null) => (t ? t.slice(11, 16) : null);

/**
 * sleep.csv for the plan session: sleep.json's columns plus source, one row per merged morning. SpO2 and
 * respiration come from the watch's day when it has them, else from sleep.json.
 */
export function sleepCsv(sleepJson: readonly Night[], hc: readonly HealthNight[], days: readonly HealthDay[]): string {
  const garmin = new Map(sleepJson.map((n) => [n.day, n]));
  const daily = new Map(days.map((d) => [d.day, d]));
  const rows: (string | number | null)[][] = [[
    "date", "bed", "wake", "total_min", "awake_min", "deep_min", "light_min", "rem_min", "score", "resting_hr", "hrv_ms",
    "avg_spo2", "avg_respiration", "source",
  ]];
  for (const n of mergedNights(sleepJson, hc, days)) {
    const g = garmin.get(n.day), d = daily.get(n.day);
    rows.push([
      isoOf(n.day), n.bed, n.wake, n.totalMin, n.awakeMin, n.deepMin, n.lightMin, n.remMin, n.score, n.restingHr, n.hrvMs,
      d?.spo2 ?? g?.avgSpo2 ?? null, d?.respiration ?? g?.avgRespiration ?? null, n.source,
    ]);
  }
  return csv(rows);
}
