// Back on the Training page (277): a session or a document open on it closes to Training, never to the tab or
// page it was opened from. Pure, so it's tested (test/trainingBack.test.ts).

/** A session, the week plan (or the week at a day), a document or another view open on the Training page: back closes it before leaving the page. */
export const trainingSub = (q: URLSearchParams) => q.has("s") || q.has("view") || q.has("d");

/**
 * What the Training tab keeps once the route went from Training ([q]) to the tab [to], when that left the week at
 * a day: the same without the day, so the tab is back on its overview. (Back from it to Today has nothing under
 * it: kept, the tab would reopen that week with Back going nowhere.) Null when there's nothing to change.
 */
export function afterDayWeek(from: string, q: URLSearchParams, to: string): URLSearchParams | null {
  if (from !== "training" || to === "training" || !q.has("d") || q.has("s") || q.has("view")) return null;
  const kept = new URLSearchParams(q);
  kept.delete("d");
  return kept;
}

/**
 * The Training page to put under a sub view opened from outside the page (Today's Training line opens a
 * session straight away; a link or a cold start may open one too): its route (keeping the plan and the day),
 * or null when the step back already leads to Training. The week at a day alone (Today's Training line, the
 * calendar) gets none: back returns to where it came from, unless it opened cold, with nothing to go back to.
 * [from] is the route shown before ("" at start).
 */
export function trainingBase(from: string, to: string, q: URLSearchParams): string | null {
  if (to !== "training" || !trainingSub(q) || from === "training") return null;
  const dayOnly = !q.has("s") && !q.has("view");
  if (dayOnly && from !== "") return null;
  const base = new URLSearchParams();
  for (const k of dayOnly ? ["p"] : ["p", "d"]) { const v = q.get(k); if (v) base.set(k, v); }
  const s = base.toString();
  return `#/training${s ? `?${s}` : ""}`;
}
