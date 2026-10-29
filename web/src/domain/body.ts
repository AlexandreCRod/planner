// Progress's Body tab (items 250 and 251): the body numbers besides weight and sleep, drawn from what the
// phone already stores from Health Connect (health.ts: healthDays) and from sleep.json (trends.ts: Night).
// - VO2 max and steps: healthDays only.
// - Blood oxygen overnight and breathing rate: healthDays, else sleep.json's night (avg_spo2, avg_respiration).
// - Body fat: a scale's weigh-ins in healthDays (the last of a day that has one).
// Also the short words the rows use: "today", "Wed", "27 Oct", and the weight row's "Last 82.4 kg · Wed".
// Pure: nothing is stored. Days are epoch-day numbers (domain/dates.ts).
import { dayShort, monthShort, weekday, ymd } from "./dates.ts";
import type { HealthDay } from "./health.ts";
import type { Night } from "./trends.ts";

/** The Body tab's own kinds (Weight, Sleep, resting HR and HRV come from trends.ts and sleep.ts). */
export type BodyKind = "vo2" | "steps" | "spo2" | "breath" | "fat";

/** One day's reading: [fromSleepJson] when it came from sleep.json rather than the watch. */
export interface BodyPoint { day: number; v: number; fromSleepJson?: boolean }

/**
 * A kind's readings, one per day, oldest first. [days] and [nights] are oldest first; a day Health Connect
 * has wins over sleep.json's.
 */
export function bodySeries(kind: BodyKind, days: readonly HealthDay[], nights: readonly Night[] = []): BodyPoint[] {
  const out = new Map<number, BodyPoint>();
  const json = kind === "spo2" ? (n: Night) => n.avgSpo2 : kind === "breath" ? (n: Night) => n.avgRespiration : null;
  if (json) for (const n of nights) { const v = json(n); if (v !== null && Number.isFinite(v)) out.set(n.day, { day: n.day, v, fromSleepJson: true }); }
  for (const d of days) {
    let v: number | null = null;
    if (kind === "vo2") v = d.vo2max;
    else if (kind === "steps") v = d.steps;
    else if (kind === "spo2") v = d.spo2;
    else if (kind === "breath") v = d.respiration;
    else { const w = (d.weighIns ?? []).filter((x) => x.fatPct !== null); v = w.length ? w[w.length - 1].fatPct : null; }
    if (v !== null && Number.isFinite(v)) out.set(d.day, { day: d.day, v });
  }
  return [...out.values()].sort((a, b) => a.day - b.day);
}

/** The average over the 7 days to [day] (it included) of the days that have a reading; null when none has. */
export function avg7Of(points: readonly BodyPoint[], day: number): number | null {
  let sum = 0, n = 0;
  for (const p of points) if (p.day > day - 7 && p.day <= day) { sum += p.v; n++; }
  return n ? sum / n : null;
}

/** The 7-day average line: a point per reading, its value the average of the 7 days to it. */
export function avg7LineOf(points: readonly BodyPoint[]): { day: number; v: number }[] {
  return points.map((p) => ({ day: p.day, v: avg7Of(points, p.day)! }));
}

/** When a reading was, short: "today", the weekday ("Wed") within the last 6 days, else "27 Oct" (with the year when not this one). */
export function shortWhen(day: number, today: number): string {
  if (day === today) return "today";
  if (day < today && day > today - 7) return dayShort(weekday(day));
  const a = ymd(day), b = ymd(today);
  return `${a.d} ${monthShort(a.m)}${a.y !== b.y ? ` ${a.y}` : ""}`;
}

/** The weight row's line (250): "Last 82.4 kg · Wed". */
export const lastWeighInLine = (kg: number, day: number, today: number) => `Last ${kg.toFixed(1)} kg · ${shortWhen(day, today)}`;

/** "8,412": steps with a thousands comma. */
export const fmtSteps = (v: number) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
