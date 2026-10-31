// A drag held at the left or right edge of the calendar turns to the previous or next period (298): the
// pure part, shared by the time grid and Month, kept apart for the tests.

/** How close to the grid's edge (px, or anywhere past it) counts as being at the edge. */
export const EDGE_ZONE = 28;
/** The zone never gets narrower than this, so a finger can still reach it (px). */
export const EDGE_ZONE_MIN = 16;
/** Picked up inside the zone, a push this far on towards the edge (px) counts as going there. */
export const EDGE_TRAVEL = 24;
/** The short hold there before the period turns (ms). */
export const EDGE_HOLD = 500;
/** Staying there, the next period after this long (ms). */
export const EDGE_REPEAT = 800;

/** Which edge [x] is at, of a grid from [left] to [right]: -1 the left one, 1 the right one, 0 neither. */
export function edgeOf(x: number, left: number, right: number, zone = EDGE_ZONE): -1 | 0 | 1 {
  return x < left + zone ? -1 : x > right - zone ? 1 : 0;
}

/** The zone for columns [colW] px wide: a third of a narrow column, so the outer days can still be dragged in. */
export const edgeZone = (colW: number) => Math.min(EDGE_ZONE, Math.max(EDGE_ZONE_MIN, colW / 3));

/**
 * Counts how long a drag has stayed at one edge, and says when the period should turn. Nothing counts
 * until the drag has gone to the edge: a block picked up there is only being held, not sent anywhere.
 */
export class EdgeHold {
  private dir: -1 | 0 | 1 = 0;
  private due = 0;
  private armed = false;
  private x0: number | null = null;
  /** The drag is at edge [dir] and at [x] at [t] ms: that direction when it's time to turn, otherwise 0. */
  feed(dir: -1 | 0 | 1, t: number, x: number): -1 | 0 | 1 {
    this.x0 ??= x;
    if (!this.armed) {
      if (dir && (x - this.x0) * dir < EDGE_TRAVEL) return 0;
      this.armed = true;
    }
    if (dir !== this.dir) { this.dir = dir; this.due = t + EDGE_HOLD; return 0; }
    if (!dir || t < this.due) return 0;
    this.due = t + EDGE_REPEAT;
    return dir;
  }
}

/** The column in view a block lands in: taken from column [di], dragged [dx] px, columns [w] px wide. */
export function dropColumn(di: number, dx: number, w: number, columns: number): number {
  return Math.max(0, Math.min(columns - 1, di + Math.round(dx / w)));
}
