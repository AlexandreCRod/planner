// Tasks: a left swipe changes the list, and a left swipe on a row deletes it, so a second swipe in a row
// could delete by mistake (275). While the list is sliding and for a moment after, the rows there ignore
// swipes, and there a fling alone never deletes: the row has to be dragged past the mark.

/** How long the rows stay quiet after the list has settled. */
export const ROW_QUIET_MS = 800;
/** How far (of the row's width) a row is dragged for letting go to remove it. */
export const REMOVE_AT = 0.4;
/** A fling this fast (px/ms) and at least this far (px) removes a row with no guard. */
const FLING_SPEED = 0.8, FLING_MIN = 48;

let until = 0;
/** The list is moving: call it on every step of the slide, so the wait counts from the last one. */
export const quietRows = (now = performance.now()) => { until = now + ROW_QUIET_MS; };
/** The list went back to where it was: nothing changed, so nothing to guard. */
export const calmRows = () => { until = 0; };
/** Whether rows that are guarded ignore swipes now. */
export const rowsQuiet = (now = performance.now()) => now < until;

/** Whether a row let go at [dx] px and [vx] px/ms, on a row [w] px wide, is removed. [guarded]: on Tasks. */
export function swipeRemoves(dx: number, vx: number, w: number, guarded: boolean): boolean {
  if (Math.abs(dx) > w * REMOVE_AT) return true;
  return !guarded && Math.abs(vx) > FLING_SPEED && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) > FLING_MIN;
}
