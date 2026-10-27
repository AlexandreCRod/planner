// The Progress charts' arithmetic (ProgressChart.tsx), kept apart so it can be tested: the date ranges
// the range switch offers, the value scale and its round ticks, and which reading a finger is nearest.
// Days are epoch-day numbers (domain/dates.ts).
import { addMonths, monthShort, ymd } from "../../domain/dates.ts";

export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "All";
/** The range switch on every chart card, as the user set it (2.8); 3M unless changed. */
export const RANGES: [RangeKey, string][] = [["1M", "1M"], ["3M", "3M"], ["6M", "6M"], ["1Y", "1Y"], ["All", "All"]];
export const DEFAULT_RANGE: RangeKey = "3M";
const MONTHS: Record<Exclude<RangeKey, "All">, number> = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 };

/** The first day [key] shows, counting back from [today] by calendar months; null for All (from the first reading). */
export function rangeStart(key: RangeKey, today: number): number | null {
  return key === "All" ? null : addMonths(today, -MONTHS[key]);
}

/** The readings on or after [from] (all of them when null), in their order. */
export const inRange = <T extends { day: number }>(xs: readonly T[], from: number | null): T[] =>
  from === null ? [...xs] : xs.filter((p) => p.day >= from);

/**
 * The days a time axis spans: from the range's start (All: the first of [days], which are oldest first) to
 * [today], or to the last reading if that's later. Never a single day, so a scale always has a width.
 */
export function xDomain(key: RangeKey, today: number, days: readonly number[]): [number, number] {
  const to = Math.max(today, days.length ? days[days.length - 1] : today);
  const from = Math.min(rangeStart(key, today) ?? (days.length ? days[0] : to), to);
  return from < to ? [from, to] : [to - 1, to];
}

/** Maps [d0, d1] onto [r0, r1] in a straight line; an empty domain maps everything to the middle. */
export function scale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  if (d1 === d0) return () => (r0 + r1) / 2;
  const k = (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** The smallest round step (1, 2, 2.5 or 5 times a power of ten) at least [raw]. */
function roundStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw - 1e-9) return m * p;
  return 10 * p;
}

/**
 * Round ticks for values from [min] to [max]: about [count] gaps of a round step, the ends rounded out to a
 * step so every value sits inside. [lo] and [hi] are the axis's ends (the first and last tick). A flat
 * series (min = max) gets a little room each side.
 */
export function niceTicks(min: number, max: number, count = 3): { lo: number; hi: number; ticks: number[] } {
  if (max < min) [min, max] = [max, min];
  if (max === min) { const pad = Math.abs(min) * 0.05 || 1; min -= pad; max += pad; }
  let step = roundStep((max - min) / count);
  let lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
  // Rounding out can leave too many gaps for a small chart: take the next round step up.
  while ((hi - lo) / step > count + 1) {
    step = roundStep(step * 1.01);
    lo = Math.floor(min / step + 1e-9) * step; hi = Math.ceil(max / step - 1e-9) * step;
  }
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo: ticks[0], hi: ticks[ticks.length - 1], ticks };
}

/** The index of the value in [xs] (ascending) nearest to [x] (the earlier on a tie); -1 when there's none. */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (!xs.length) return -1;
  let a = 0, b = xs.length - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (xs[m] <= x) a = m; else b = m;
  }
  return Math.abs(xs[b] - x) < Math.abs(xs[a] - x) ? b : a;
}

/** "27 Oct" for the axis and the "since" chip; with the year when it isn't [today]'s year ("27 Oct 2025"). */
export function dayMonth(day: number, today: number): string {
  const { y, m, d } = ymd(day);
  return `${d} ${monthShort(m)}${y !== ymd(today).y ? ` ${y}` : ""}`;
}

/** "+12", "−3.5", "0": a change with its sign, to 0.5 (kg). */
export function signed(v: number): string {
  const r = Math.round(v * 2) / 2;
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : "0";
}
