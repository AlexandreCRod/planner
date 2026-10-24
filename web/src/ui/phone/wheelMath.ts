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
