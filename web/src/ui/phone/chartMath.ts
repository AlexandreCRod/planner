// The Progress charts' arithmetic (ProgressChart.tsx), kept apart so it can be tested: the date ranges
// the range switch offers, the value scale and its round ticks, and which reading a finger is nearest.
// Days are epoch-day numbers (domain/dates.ts).
import { addMonths, dayShort, epochOf, formatDate, monthShort, startOfWeek, weekday, ymd } from "../../domain/dates.ts";
import { FLICK } from "./motion.ts";

export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "All";
/** The range switch on every chart card, as the user set it (2.8); 3M unless changed. */
export const RANGES: [RangeKey, string][] = [["1M", "1M"], ["3M", "3M"], ["6M", "6M"], ["1Y", "1Y"], ["All", "All"]];
export const DEFAULT_RANGE: RangeKey = "3M";
const MONTHS: Record<Exclude<RangeKey, "All">, number> = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 };

/** Cardio's ranges (294): the chart ranges and a week. */
export type WindowKey = "1W" | RangeKey;
export const WINDOWS: [WindowKey, string][] = [["1W", "1W"], ...RANGES];
/** The names in the compact range menu. */
export const WINDOW_NAMES: Record<WindowKey, string> = { "1W": "1 week", "1M": "1 month", "3M": "3 months", "6M": "6 months", "1Y": "1 year", All: "All" };

/** One bar of a window: its days [from, to), its axis label and its full name. */
export interface WindowBar {
  from: number; to: number; label: string; title: string;
  /** It hasn't started: no bar is drawn. */
  future: boolean;
  /** Today is in it: it's still filling. */
  now: boolean;
}
/** A stretch of time at a range: its days [from, to), the bars the range picks, and its name. */
export interface TimeWindow { key: WindowKey; from: number; to: number; unit: "day" | "week" | "month"; bars: WindowBar[]; label: string }

const monthStart = (day: number) => { const { y, m } = ymd(day); return epochOf(y, m, 1); };

/**
 * The window a range shows, [back] windows before the current one (0: now; panning through time goes through
 * these): 1W the Monday-first week, by days; 1M the calendar month, by days; 3M the 13 weeks to this week, by
 * weeks; 6M and 1Y that many calendar months to this one, by months; All by months from [first], the first
 * day with data.
 */
export function rangeWindow(key: WindowKey, today: number, first: number = today, back = 0): TimeWindow {
  const bars: WindowBar[] = [];
  const push = (from: number, to: number, label: string, title: string) =>
    bars.push({ from, to, label, title, future: from > today, now: today >= from && today < to });
  let from: number, to: number, unit: TimeWindow["unit"] = "day";
  if (key === "1W") {
    from = startOfWeek(today, true) - 7 * back; to = from + 7;
    for (let x = from; x < to; x++) push(x, x + 1, dayShort(weekday(x)), formatDate(x));
  } else if (key === "1M") {
    from = addMonths(monthStart(today), -back); to = addMonths(from, 1);
    for (let x = from; x < to; x++) push(x, x + 1, String(ymd(x).d), formatDate(x));
  } else if (key === "3M") {
    unit = "week";
    to = startOfWeek(today, true) + 7 - 91 * back; from = to - 91;
    for (let x = from; x < to; x += 7) push(x, x + 7, dayMonth(x, today), `Week of ${dayMonth(x, today)}`);
  } else {
    unit = "month";
    const thisMonth = monthStart(today), a = ymd(monthStart(Math.min(first, today))), b = ymd(thisMonth);
    const n = key === "6M" ? 6 : key === "1Y" ? 12 : (b.y - a.y) * 12 + b.m - a.m + 1;
    to = addMonths(thisMonth, 1 - n * back); from = addMonths(to, -n);
    for (let x = from; x < to; x = addMonths(x, 1)) { const { y, m } = ymd(x); push(x, addMonths(x, 1), monthShort(m), `${monthShort(m)} ${y}`); }
  }
  return { key, from, to, unit, bars, label: windowLabel(key, from, to, today, back) };
}

function windowLabel(key: WindowKey, from: number, to: number, today: number, back: number): string {
  if (key === "1W" && back === 0) return "This week";
  if (key === "1M") { const { y, m } = ymd(from); return `${monthShort(m)} ${y}`; }
  return `${dayMonth(from, today)} – ${dayMonth(Math.min(to - 1, today), today)}`;
}

/** Whether there's a window before [back] with any days from [first] on: "All" shows everything, so never. */
export function hasEarlier(key: WindowKey, today: number, first: number, back: number): boolean {
  return key !== "All" && rangeWindow(key, today, first, back + 1).to > first;
}

/** Every window of a range from now back to [first], newest first: a scale that stays put is taken over them all. */
export function allWindows(key: WindowKey, today: number, first: number): TimeWindow[] {
  const out = [rangeWindow(key, today, first)];
  while (hasEarlier(key, today, first, out.length - 1)) out.push(rangeWindow(key, today, first, out.length));
  return out;
}

/** What a chart of bars labels: every bar up to 7, else the first, the middle and the last. */
export function barLabels(bars: readonly WindowBar[]): { day: number; text: string; anchor: "start" | "middle" | "end" }[] {
  const at = (b: WindowBar, anchor: "start" | "middle" | "end") => ({ day: (b.from + b.to) / 2, text: b.label, anchor });
  if (bars.length <= 7) return bars.map((b) => at(b, "middle"));
  const n = bars.length;
  return [at(bars[0], "start"), at(bars[Math.floor(n / 2)], "middle"), at(bars[n - 1], "end")];
}

/** The first day [key] shows, counting back from [today] by calendar months; null for All (from the first reading). */
export function rangeStart(key: RangeKey, today: number): number | null {
  return key === "All" ? null : addMonths(today, -MONTHS[key]);
}

/** The readings on or after [from] (all of them when null) and up to [to], in their order. */
export const inRange = <T extends { day: number }>(xs: readonly T[], from: number | null, to: number | null = null): T[] =>
  from === null && to === null ? [...xs] : xs.filter((p) => p.day >= (from ?? -Infinity) && p.day <= (to ?? Infinity));

/**
 * The days a time axis spans: from the range's start (All: the first of [days], which are oldest first) to
 * [today], or to the last reading if that's later. Never a single day, so a scale always has a width.
 */
export function xDomain(key: RangeKey, today: number, days: readonly number[]): [number, number] {
  const to = Math.max(today, days.length ? days[days.length - 1] : today);
  const from = Math.min(rangeStart(key, today) ?? (days.length ? days[0] : to), to);
  return from < to ? [from, to] : [to - 1, to];
}

/** A stretch of a card's range: its days [from, to] (null: no limit that way), the axis, its name, and if there's more before it. */
export interface SpanWindow { from: number | null; to: number | null; domain: [number, number]; label: string; earlier: boolean }

/**
 * The window a chart card shows, [back] whole windows before the current one. Now, it ends today, as
 * rangeStart and xDomain say; each earlier one ends the day before the next begins, so no reading is in two.
 * [days]: the readings' days, oldest first. "All" has nowhere to go.
 */
export function spanWindow(key: RangeKey, today: number, days: readonly number[], back = 0): SpanWindow {
  const first = days.length ? days[0] : null;
  if (key === "All" || back <= 0) {
    const from = rangeStart(key, today), domain = xDomain(key, today, days);
    const label = `${dayMonth(from ?? domain[0], today)} – ${dayMonth(today, today)}`;
    return { from, to: null, domain, label, earlier: from !== null && first !== null && first < from };
  }
  const from = addMonths(today, -MONTHS[key] * (back + 1)), to = addMonths(today, -MONTHS[key] * back) - 1;
  return { from, to, domain: [from, to], label: `${dayMonth(from, today)} – ${dayMonth(to, today)}`, earlier: first !== null && first < from };
}

/** A swipe this far (px), or a flick, moves a chart a whole window. */
export const PAN_DISTANCE = 40;

/**
 * Where a chart goes when a swipe of [dx] px (rightwards positive) at [vx] px/ms ends: 1 a window older (the
 * finger went right), -1 a window newer, 0 stays, as it does with nothing that way.
 */
export function panTarget(dx: number, vx: number, canBack: boolean, canFwd: boolean): -1 | 0 | 1 {
  const far = Math.abs(dx) > PAN_DISTANCE || (Math.abs(vx) > FLICK && Math.sign(vx) === Math.sign(dx));
  if (!far || dx === 0) return 0;
  return dx > 0 ? (canBack ? 1 : 0) : canFwd ? -1 : 0;
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

/** The reading at [x] when each stands [half] of its day on from it (a bar, by its middle): any spot on a bar is that bar. */
export const nearestBar = (xs: readonly number[], half: (x: number) => number, x: number) => nearestIndex(xs.map((d) => d + half(d)), x);

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
