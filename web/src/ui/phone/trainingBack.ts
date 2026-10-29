// Back on the Training page (277): a session or a document open on it closes to the Training week, never to
// the tab or page it was opened from. Pure, so it's tested (test/trainingBack.test.ts).

/** A session, a document or another view open on the Training page: back closes it before leaving the page. */
export const trainingSub = (q: URLSearchParams) => q.has("s") || q.has("view");

/**
 * The Training week to put under a sub view opened from outside the page (Today's Training line opens a
 * session straight away; a link or a cold start may open one too): its route (keeping the plan and the day),
 * or null when the step back already leads to Training. [from] is the route shown before ("" at start).
 */
export function trainingBase(from: string, to: string, q: URLSearchParams): string | null {
  if (to !== "training" || !trainingSub(q) || from === "training") return null;
  const base = new URLSearchParams();
  for (const k of ["p", "d"]) { const v = q.get(k); if (v) base.set(k, v); }
  const s = base.toString();
  return `#/training${s ? `?${s}` : ""}`;
}
