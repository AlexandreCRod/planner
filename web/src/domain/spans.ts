// Items that run over several days, drawn on the calendar as one bar across them (the month's weeks,
// the all-day row over the hours): each gets a lane, the lowest one free all along its days, so bars
// never overlap and a long one stays straight. Pure, checked by test/spans.test.ts.

export interface Span { key: string; from: number; to: number }
/** A span's place in a row of days: its lane (0 at the top) and the first and last columns it covers. */
export interface Lane { key: string; lane: number; first: number; last: number }

/**
 * The lanes for the spans that touch the days [rowFrom]..[rowTo]: the earliest first (the longer of two
 * that start together first), each in the lowest lane free over its days in the row.
 */
export function spanLanes(spans: readonly Span[], rowFrom: number, rowTo: number): Lane[] {
  const list = spans
    .filter((s) => s.to >= rowFrom && s.from <= rowTo)
    .map((s) => ({ key: s.key, a: Math.max(s.from, rowFrom), b: Math.min(s.to, rowTo) }))
    .sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const ends: number[] = [];
  const out: Lane[] = [];
  for (const s of list) {
    let lane = ends.findIndex((e) => e < s.a);
    if (lane < 0) lane = ends.length;
    ends[lane] = s.b;
    out.push({ key: s.key, lane, first: s.a - rowFrom, last: s.b - rowFrom });
  }
  return out;
}

/** How many lanes the bars over column [col] take: the deepest one there, plus one (0 when none). */
export function lanesOver(lanes: readonly Lane[], col: number): number {
  let n = 0;
  for (const l of lanes) if (l.first <= col && col <= l.last) n = Math.max(n, l.lane + 1);
  return n;
}

/** How many bars cross column [col] within the first [cap] lanes (the ones drawn). */
export function barsShownOver(lanes: readonly Lane[], col: number, cap: number): number {
  return lanes.filter((l) => l.lane < cap && l.first <= col && col <= l.last).length;
}
