// The order of what's on a training day, as the user dragged it (324). The plan lists a day's sessions in its
// own order, then the games; a drag within the day (or onto a place in another day) stores that day's order
// as the user's own record, kind "trainingOrder": one per plan and day, written only by Planner (never the
// plan's files). It holds the entry ids in order ("<plan>:<session>", a game's "futsal:<event>:<day>").
// Backward compatible: a day with no record, or what isn't in its record (a session placed there later, a new
// game), keeps the plan's order, after what is listed. Ids no longer on the day are skipped.

export interface DayOrder {
  /** "<plan id>:<day>". */
  id: string;
  planId: string;
  day: number;
  /** Entry ids, first to last. */
  order: string[];
  updatedAt: number;
}

export const dayOrderId = (planId: string, day: number) => `${planId}:${day}`;

/** Every day's order by [dayOrderId]; records that don't read right are left out (that day keeps the plan's order). */
export type DayOrders = ReadonlyMap<string, readonly string[]>;
export function dayOrders(records: Iterable<Partial<DayOrder>>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of records) {
    if (typeof r.id !== "string" || !Array.isArray(r.order)) continue;
    out.set(r.id, r.order.filter((x): x is string => typeof x === "string"));
  }
  return out;
}

/**
 * [items] (in the plan's order) in the user's [order]: the listed ones first, as listed, then the rest as they
 * came. Without an order they're unchanged.
 */
export function inDayOrder<T>(items: readonly T[], idOf: (x: T) => string, order: readonly string[] | undefined): T[] {
  if (!order?.length) return [...items];
  const rank = new Map<string, number>();
  order.forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });
  return items
    .map((x, i) => ({ x, i, r: rank.get(idOf(x)) }))
    .sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || a.i - b.i)
    .map((y) => y.x);
}

/**
 * The day's order after [moved] is dropped at place [to] among [ids] (what's on the day as shown, [moved]
 * itself left out if it was there): the place is kept within the list.
 */
export function droppedOrder(ids: readonly string[], moved: string, to: number): string[] {
  const out = ids.filter((id) => id !== moved);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, moved);
  return out;
}
