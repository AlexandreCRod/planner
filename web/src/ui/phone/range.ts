// The range date picker's rules (pickers.tsx RangeDatePickerDialog): tap the start day, then the end
// day; or press a day and slide across others, the range following the finger. Pure, checked by
// test/range.test.ts.

/** A range being picked: its days, and which end the next tap sets. */
export interface RangePick { start: number; end: number; next: "start" | "end" }

/**
 * A tap on [day]: the first tap starts a new range there (one day long, the end to be tapped next); the
 * second sets its end, or, on a day before the start, starts it again from there.
 */
export function tapRange(r: RangePick, day: number): RangePick {
  if (r.next === "start" || day < r.start) return { start: day, end: day, next: "end" };
  return { start: r.start, end: day, next: "start" };
}

/** A slide from [anchor] (where the finger landed) to [day]: the days between, either way round. */
export function slideRange(anchor: number, day: number): RangePick {
  return { start: Math.min(anchor, day), end: Math.max(anchor, day), next: "start" };
}

/** How a day of the month reads in the range: an end (start, end, or both for one day), inside it, or not. */
export function rangeRole(r: Pick<RangePick, "start" | "end">, day: number): "single" | "start" | "end" | "inside" | null {
  if (day === r.start && day === r.end) return "single";
  if (day === r.start) return "start";
  if (day === r.end) return "end";
  return day > r.start && day < r.end ? "inside" : null;
}
