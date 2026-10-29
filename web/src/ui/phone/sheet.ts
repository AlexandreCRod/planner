// Where a dragged sheet (the add panel, a bottom sheet) settles when let go. It opens or closes after a
// short pull (56 dp, or a fifth of the way), and a flick decides whatever the distance: up opens it
// fully, down closes it (the full editor let go partway down settles back to its small size).

import { FLICK } from "./motion.ts";

/** How far a pull must go to count (px), and how fast a flick is (px per ms). */
export const SHEET_DISTANCE = 56;
export const SHEET_FLING = FLICK;

/**
 * The add panel after a drag that started [from] its small or full size, now at [p] (0 small, 1 full,
 * over [range] px), pulled [down] px below its small place, the finger leaving at [v] px/ms (down positive).
 */
export function panelTarget(from: "compact" | "full", p: number, down: number, range: number, v: number): "full" | "compact" | "close" {
  const far = (px: number) => px > Math.min(SHEET_DISTANCE, range * 0.2);
  if (down > 0) return v > SHEET_FLING || (v > -SHEET_FLING && down > Math.min(SHEET_DISTANCE, 48)) ? "close" : "compact";
  if (from === "compact") {
    if (v < -SHEET_FLING) return "full";
    if (v > SHEET_FLING) return "compact";
    return far(p * range) ? "full" : "compact";
  }
  // From the full editor: a flick down closes it, a flick up keeps it; let go partway, it settles small.
  if (v > SHEET_FLING) return "close";
  if (v < -SHEET_FLING) return "full";
  return far((1 - p) * range) ? "compact" : "full";
}

/** A bottom sheet pulled [dy] px down (its height [h]) and let go at [v] px/ms: whether it closes. */
export function sheetCloses(dy: number, h: number, v: number): boolean {
  if (v > SHEET_FLING) return true;
  if (v < -SHEET_FLING) return false;
  return dy > Math.min(SHEET_DISTANCE, h * 0.2);
}

/**
 * A finger put down on a sheet's content (not its handle), now moved [dx], [dy] px after [held] ms
 * (274): "wait" until it's past the slop; "take" a pull downwards, so the sheet follows it; "leave" a
 * sideways move (a swipe row, a chip row, a stepper), an upward one (the content scrolls) and a long
 * press (a row being picked up) to whatever else handles them.
 */
export function bodyDragStart(dx: number, dy: number, held: number, slop: number, longPress: number): "wait" | "take" | "leave" {
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= slop) return "wait";
  if (held >= longPress) return "leave";
  return dy > 0 && dy >= Math.abs(dx) * 1.2 ? "take" : "leave";
}
