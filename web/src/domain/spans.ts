// Items that run over several days, drawn on the calendar as one bar across them (the month's weeks,
// the all-day row over the hours): each gets a lane, the lowest one free all along its days, so bars
// never overlap and a long one stays straight. Pure, checked by test/spans.test.ts.

/** [skip]: days inside it that were taken out (the bar breaks there into one bar per run of days). */
export interface Span { key: string; from: number; to: number; skip?: readonly number[] }
/** A span's place in a row of days: its lane (0 at the top) and the first and last columns it covers. */
export interface Lane { key: string; lane: number; first: number; last: number }

/** The runs of days a span covers: all of it, or the pieces left between days taken out of it. */
export function spanPieces(s: Span): { from: number; to: number }[] {
  const skip = new Set((s.skip ?? []).filter((d) => d >= s.from && d <= s.to));
  if (!skip.size) return [{ from: s.from, to: s.to }];
  const out: { from: number; to: number }[] = [];
  let a: number | null = null;
  for (let d = s.from; d <= s.to + 1; d++) {
    if (d <= s.to && !skip.has(d)) { if (a === null) a = d; }
    else if (a !== null) { out.push({ from: a, to: d - 1 }); a = null; }
  }
  return out;
}

/**
 * The lanes for the spans that touch the days [rowFrom]..[rowTo]: the earliest first (the longer of two
 * that start together first), each in the lowest lane free over its days in the row. With [page] (the
 * days a swipe turns, as the hours' row of three weeks), each page is laid out on its own: a span over
 * two weeks is a bar in each, with its own title and left edge, as the month's weeks are. A span with
 * days taken out is a bar for each run of days left. Pieces of one span share its key; [first] tells
 * them apart.
 */
export function spanLanes(spans: readonly Span[], rowFrom: number, rowTo: number, page?: number): Lane[] {
  if (page && page > 0 && rowTo - rowFrom + 1 > page) {
    const out: Lane[] = [];
    for (let p = rowFrom; p <= rowTo; p += page) {
      for (const l of spanLanes(spans, p, Math.min(rowTo, p + page - 1))) out.push({ ...l, first: l.first + p - rowFrom, last: l.last + p - rowFrom });
    }
    return out;
  }
  const list = spans
    .flatMap((s) => spanPieces(s).map((r) => ({ key: s.key, from: r.from, to: r.to })))
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
