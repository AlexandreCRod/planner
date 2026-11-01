// The to-dos sheet closes to open a to-do (271); back from that page it's there again, where it was (319).

const TABS = new Set(["calendar", "training", "tasks", "notes", "alarms"]);

/** How far the sheet's rows were scrolled when it was left for a to-do; null when it wasn't. */
let left: number | null = null;

/** The sheet is closing to open a to-do. */
export function leaveSheet(top: number) { left = top; }

/**
 * Called on each route change while Today is mounted: how far to scroll the sheet being brought back, or
 * null. [real]: the browser went there (back), rather than the app replacing the route (a tab tapped on the
 * wide rail). Pages further on keep the wait; another tab ends it.
 */
export function sheetBack(hash: string, real: boolean): number | null {
  if (left === null) return null;
  const route = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  if (route === "" || route === "today") {
    const top = left;
    left = null;
    return real ? top : null;
  }
  if (TABS.has(route)) left = null;
  return null;
}
