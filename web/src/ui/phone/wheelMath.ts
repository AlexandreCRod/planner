// The time wheel's values: which rows each wheel has and how a time splits into them and back. Pure,
// so the snapping and the 12/24-hour rules are tested (test/wheel.test.ts).

/** The minutes a wheel offers: every [step] (5 by default), plus [keep] when it falls between them. */
export function wheelMinutes(step = 5, keep?: number): number[] {
  const out: number[] = [];
  for (let m = 0; m < 60; m += step) out.push(m);
  if (keep !== undefined && keep >= 0 && keep < 60 && !out.includes(keep)) { out.push(keep); out.sort((a, b) => a - b); }
  return out;
}

/** The hours a wheel offers: 0–23, or 12, 1–11 for a 12-hour clock (with an AM/PM wheel beside it). */
export const wheelHours = (h24: boolean): number[] => (h24 ? Array.from({ length: 24 }, (_, i) => i) : [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

/** Rows for minute-of-day [min]: the hour row, the minute row (in [minutes]) and, on 12 hours, PM. */
export function splitTime(min: number, h24: boolean, minutes: number[]): { hour: number; minute: number; pm: boolean } {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  let minute = minutes.indexOf(m);
  if (minute < 0) {
    // Not offered: the nearest row.
    let best = 0;
    for (let i = 1; i < minutes.length; i++) if (Math.abs(minutes[i] - m) < Math.abs(minutes[best] - m)) best = i;
    minute = best;
  }
  return { hour: h24 ? h : h % 12, minute, pm: h >= 12 };
}

/**
 * On a 12-hour clock, whether the hour wheel turning from row [from] to row [to] (rows 12, 1 ... 11) passes
 * 11 ↔ 12, so AM/PM flips with it, as Android's own time picker does: 11 AM → 12 PM, 12 PM → 11 AM.
 */
export const passesNoon = (from: number, to: number): boolean => (from === 11 && to === 0) || (from === 0 && to === 11);

/** The minute of the day the rows show. */
export function joinTime(hour: number, minute: number, pm: boolean, h24: boolean, minutes: number[]): number {
  const h = h24 ? hour : (hour % 12) + (pm ? 12 : 0);
  return h * 60 + minutes[Math.max(0, Math.min(minutes.length - 1, minute))];
}

/** An item moved to start at [start] keeping its length, never past the end of the day. */
export function moveKeepingLength(start: number, oldStart: number, oldEnd: number | null): { startMin: number; endMin: number | null } {
  if (oldEnd === null) return { startMin: start, endMin: null };
  const len = Math.max(0, oldEnd - oldStart);
  return { startMin: start, endMin: Math.min(24 * 60 - 1, start + len) };
}

/** [i] wrapped into 0..n−1 (a drum's rows go round). */
export const wrapIndex = (i: number, n: number): number => ((i % n) + n) % n;

/** The slot nearest [cur] (rows counted without wrapping) that shows row [index] of an [n]-row drum. */
export function nearestSlot(cur: number, index: number, n: number): number {
  const base = cur - wrapIndex(cur, n) + index;
  return [base - n, base, base + n].reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
}

/**
 * A new event's box with one edge dragged [dMin] minutes (AddPanel.tsx): the start ("top") or the end
 * ("bottom") lands on the nearest [step] minutes of the clock, and the box never gets shorter than one
 * step or goes past either end of the day.
 */
export function dragEdgeTimes(edge: "top" | "bottom", start: number, end: number, dMin: number, step = 15): { start: number; end: number } {
  const snap = (m: number) => Math.round(m / step) * step;
  if (edge === "top") return { start: Math.max(0, Math.min(end - step, snap(start + dMin))), end };
  return { start, end: Math.max(start + step, Math.min(24 * 60 - 1, snap(end + dMin))) };
}

/** How a picker wheel's row [d] rows from the band looks (220): its scale (30 px digits, 22, then 20) and opacity. */
export function wheelRowLook(d: number): { scale: number; opacity: number } {
  const a = Math.abs(d);
  if (a <= 1) return { scale: 1 - a * (8 / 30), opacity: 1 - a * 0.45 };
  if (a <= 2) return { scale: 22 / 30 - (a - 1) * (2 / 30), opacity: 0.55 - (a - 1) * 0.27 };
  return { scale: 20 / 30, opacity: Math.max(0, 0.28 - (a - 2) * 0.28) };
}

/** A timer's length [ms] as its wheels' rows: hours (at most 23), minutes and seconds. */
export function splitDuration(ms: number): { h: number; m: number; s: number } {
  const t = Math.max(0, Math.round(ms / 1000));
  return { h: Math.min(23, Math.floor(t / 3600)), m: Math.floor(t / 60) % 60, s: t % 60 };
}

/** The length (ms) the duration wheels show. */
export const joinDuration = ({ h, m, s }: { h: number; m: number; s: number }): number => (h * 3600 + m * 60 + s) * 1000;

/** A duration wheel's rows: 0..n−1, two digits for minutes and seconds. */
export const durationRows = (n: number, pad: boolean): string[] => Array.from({ length: n }, (_, i) => (pad ? String(i).padStart(2, "0") : String(i)));
