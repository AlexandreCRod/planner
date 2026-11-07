// Holding a note's checkbox line to drag it (331, the user's pick): on a touch screen a short hold (the one
// hold time, 400 ms) on the line itself lifts it, as its handle does at once. A tap still places the cursor,
// and a double or triple tap still selects a word or the line (they're quick, so never a hold); a finger
// that moves first is a scroll. A mouse keeps pressing and moving to select text, and drags by the handle.
import { LONG_PRESS, TOUCH_SLOP } from "./press.ts";

/** How long a finger rests on a checkbox line before the line lifts: the one hold time (342). */
export const LINE_HOLD = LONG_PRESS;

/**
 * Whether a press may become a hold on the line: a finger (not a mouse), on a checkbox line that shows, and not
 * on a web link in it: a hold on a link shows the link's card, one meaning only (review of 2.10.3, finding 3).
 */
export function holdsLine(p: { pointerType: string; primary: boolean; checkLine: boolean; folded: boolean; dragging: boolean; onLink?: boolean }): boolean {
  return p.pointerType !== "mouse" && p.primary && p.checkLine && !p.folded && !p.dragging && !p.onLink;
}

/** A finger still waiting for its hold: "off" once it has moved past the touch slop (a scroll), else "wait". */
export function lineHoldMove(x0: number, y0: number, x: number, y: number): "wait" | "off" {
  return Math.hypot(x - x0, y - y0) > TOUCH_SLOP ? "off" : "wait";
}

/**
 * Where lifted lines whose top is at [top] would land among the other lines, given where those rest with the
 * lifted ones taken out ([others], top to bottom): the number of them that stay above. A line is passed once
 * the lifted lines' top is over its middle, so lines that haven't moved stay where they were.
 */
export function slotFor(others: { top: number; h: number }[], top: number): number {
  let k = 0;
  while (k < others.length && others[k].top + others[k].h / 2 < top) k++;
  return k;
}
