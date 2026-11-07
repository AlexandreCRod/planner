// A switch or a checkbox flips only on a real tap (378). The Android back gesture from the screen's edge flipped
// "Show on calendar" while a routine was being set up: the swipe started on the switch's row, and the row took it
// as a tap. Now a touch flips a switch (or a checkbox, or a row that holds one) only when the finger came down and
// lifted without moving past the touch slop, wasn't taken by the system (cancelled), and no back press came in
// while it was down. Mouse clicks and keys are left alone.
//
// On the emulator the system cancels the touch it takes for the back gesture (pointercancel), but phones differ:
// one may hand the page a plain finger-up where the swipe began, which reads as a tap. So a toggle touched within
// the back gesture's edge strip waits a moment before it flips, and doesn't if a back press comes meanwhile.
import { TOUCH_SLOP } from "./press.ts";

/** What counts as a toggle: a switch, a checkbox, a radio or segment, a chip or day that stays pressed, or a row that holds exactly one of them. */
export const TOGGLE = "[role=switch], [role=radio], [aria-pressed], input[type=checkbox], input[type=radio]";
/** A row taller than this isn't a toggle's row (it's a card or a list around several). */
const ROW_MAX = 120;
/** How long after the finger lifts its click may still come (Chrome fires it right after; this is generous). */
const CLICK_WINDOW = 700;

/** The strip at the left and right edges where the system's back gesture starts (CSS px; Android's is about 24 dp). */
export const EDGE_STRIP = 24;
/**
 * The phone's own back-gesture zones, when Android tells the app (review of 2.10.4, finding 9: HyperOS or the
 * gesture-sensitivity setting can make them wider). Never narrower than EDGE_STRIP: with buttons instead of
 * gestures Android says 0, and the short wait at the edge costs little.
 */
const edges = { left: EDGE_STRIP, right: EDGE_STRIP };
export function setGestureEdges(left: number, right: number) {
  edges.left = Number.isFinite(left) ? Math.max(EDGE_STRIP, left) : EDGE_STRIP;
  edges.right = Number.isFinite(right) ? Math.max(EDGE_STRIP, right) : EDGE_STRIP;
}
/** How long a toggle touched in the edge strip waits for a back press before it flips (ms). */
export const EDGE_WAIT = 260;

/** One touch's story, from finger down to its click: whether it may flip a switch. */
export class TapGuard {
  private x0 = 0; private y0 = 0;
  private moved = false; private cancelled = false; private touching = false;
  private downAt = -Infinity; private endAt = -Infinity; private backAt = -Infinity;
  down(x: number, y: number, t: number) { this.x0 = x; this.y0 = y; this.moved = this.cancelled = false; this.touching = true; this.downAt = t; this.endAt = -Infinity; }
  move(x: number, y: number) { if (this.touching && Math.hypot(x - this.x0, y - this.y0) > TOUCH_SLOP) this.moved = true; }
  up(x: number, y: number, t: number) { if (!this.touching) return; this.move(x, y); this.touching = false; this.endAt = t; }
  cancel(t: number) { if (!this.touching) return; this.cancelled = true; this.touching = false; this.endAt = t; }
  back(t: number) { this.backAt = t; }
  /** Did the touch start in the back gesture's strip, on a screen [width] wide? */
  fromEdge(width: number): boolean { return this.x0 < edges.left || this.x0 > width - edges.right; }
  /** Was there a back press after this touch began? */
  backSince(): boolean { return this.backAt >= this.downAt; }
  lastEnd(): number { return this.endAt; }
  /** May a click at [t] flip a toggle? A click long after the last touch (a mouse, a key) always may. */
  allows(t: number): boolean {
    if (this.touching || t - this.endAt > CLICK_WINDOW) return true; // not a touch's click
    if (this.moved || this.cancelled) return false;
    return !(this.backAt >= this.downAt && this.backAt <= t); // the back gesture came during this touch
  }
}

/** The toggle a click at [target] would flip: the switch itself, or the one inside the small row it's on. */
export function toggleOf(target: Element | null): Element | null {
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (el.matches(TOGGLE)) return el;
    if (el.getBoundingClientRect().height > ROW_MAX) return null;
    const inner = el.querySelectorAll(TOGGLE);
    if (inner.length === 1) return inner[0];
    if (inner.length > 1) return null;
  }
  return null;
}

/**
 * Sends the held-back click again, to what the finger was on. That may be an icon's <svg> or <path> inside the
 * toggle, which has no click() of its own (review of 2.10.4, finding 1: the toggle never flipped), so it's a
 * click event that bubbles up to the toggle and its row, as the real one would have.
 */
export function replayClick(target: EventTarget) {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}

const guard = new TapGuard();
/** The back press (the Android button or edge gesture) reaches the page here. */
export const noteBack = () => guard.back(performance.now());

let started = false;
export function startTapGuard() {
  if (started) return;
  started = true;
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch" && e.isPrimary) guard.down(e.clientX, e.clientY, e.timeStamp); }, opts);
  window.addEventListener("pointermove", (e) => { if (e.pointerType === "touch" && e.isPrimary) guard.move(e.clientX, e.clientY); }, opts);
  window.addEventListener("pointerup", (e) => { if (e.pointerType === "touch" && e.isPrimary) guard.up(e.clientX, e.clientY, e.timeStamp); }, opts);
  window.addEventListener("pointercancel", (e) => { if (e.pointerType === "touch") guard.cancel(e.timeStamp); }, opts);
  // The browser may take a touch for scrolling (pointercancel) or the system for its gesture (touchcancel).
  window.addEventListener("touchcancel", (e) => guard.cancel(e.timeStamp), opts);
  let replaying = false;
  window.addEventListener("click", (e) => {
    if (replaying) return;
    const touched = !guard.allows(e.timeStamp) ? "no" : e.timeStamp - guard.lastEnd() <= CLICK_WINDOW && guard.fromEdge(innerWidth) ? "wait" : "yes";
    if (touched === "yes") return;
    const toggle = toggleOf(e.target as Element | null);
    if (!toggle) return;
    e.preventDefault();
    e.stopPropagation();
    if (touched === "no") return;
    // Touched at the edge: flip it a moment later, unless the system turned the touch into a back press.
    const target = e.target as Element;
    window.setTimeout(() => {
      if (guard.backSince() || !target.isConnected) return;
      replaying = true;
      try { replayClick(target); } finally { replaying = false; }
    }, EDGE_WAIT);
  }, { capture: true });
}
