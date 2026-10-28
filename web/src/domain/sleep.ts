// Sleep, resting heart rate and HRV: one night per morning, merged from the two places they come from.
// - sleep.json (trends.ts, `Night`): Garmin's history, pushed by the plan session; it has the sleep score.
// - Health Connect (health.ts): healthNights (one per sleep session) and healthDays (resting HR and HRV
//   per day), read by the phone from the watch.
// On the same morning Health Connect wins; sleep.json fills what it lacks (score, and resting HR or HRV when
// Health Connect has none that day). A morning with two sleep sessions keeps the longest, and a nap (a
// session that starts after 10:00 on the day it ends) never counts as the night.
// Also the numbers drawn from them: the 7-day averages, the HRV normal range, and the quiet flags the
// Training page shows (under 6 h before a key run, resting HR up two mornings in a row). Nothing is stored.
// Days are epoch-day numbers (domain/dates.ts).
import type { HealthDay, HealthNight } from "./health.ts";
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
  score: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  /** Where the sleep came from (with no sleep that morning: where its other numbers came from). */
  source: SleepSource;
  restingHrSource: SleepSource | null;
  hrvSource: SleepSource | null;
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
    if (isNap(n)) continue;
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
      ? { bed: w.bed, wake: w.wake, totalMin: w.totalMin, awakeMin: w.awakeMin, deepMin: w.deepMin, lightMin: w.lightMin, remMin: w.remMin }
      : { bed: g?.bed ?? null, wake: g?.wake ?? null, totalMin: g?.totalMin ?? null, awakeMin: g?.awakeMin ?? null, deepMin: g?.deepMin ?? null, lightMin: g?.lightMin ?? null, remMin: g?.remMin ?? null };
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

/** The values of [field] on the mornings from [from] to [to] (both included). [nights] are oldest first. */
function valuesIn(nights: readonly SleepNight[], field: SleepField, from: number, to: number): number[] {
  const out: number[] = [];
  for (const n of nights) if (n.day >= from && n.day <= to && n[field] !== null) out.push(n[field]!);
  return out;
}
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The average of [field] over the 7 mornings to [day] (it included); null when none of them has one. */
export function avg7(nights: readonly SleepNight[], field: SleepField, day: number): number | null {
  const xs = valuesIn(nights, field, day - 6, day);
  return xs.length ? mean(xs) : null;
}

/** The 7-day averages of sleep, resting HR and HRV as of [day]. */
export function sleepAverages(nights: readonly SleepNight[], day: number): { sleepMin: number | null; restingHr: number | null; hrvMs: number | null } {
  return { sleepMin: avg7(nights, "totalMin", day), restingHr: avg7(nights, "restingHr", day), hrvMs: avg7(nights, "hrvMs", day) };
}

/** The 7-day average line: one point per morning that has [field], its value the average of the 7 mornings to it. */
export function avg7Line(nights: readonly SleepNight[], field: SleepField): { day: number; v: number }[] {
  return nights.filter((n) => n[field] !== null).map((n) => ({ day: n.day, v: avg7(nights, field, n.day)! }));
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
    if (n.day <= day && n.hrvMs !== null) xs.push(n.hrvMs);
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
