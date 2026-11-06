// A finger sliding through an open menu (361; menuSlide.ts does the page side).
import { TOUCH_SLOP } from "./press.ts";

/** How long (ms) a finger rests on an option before a lift picks it, when it came there fast (review C3). */
export const SLIDE_DWELL = 120;
/** Slower than this (px/ms) at the lift, the finger was placed deliberately: the option is picked at once. */
export const SLIDE_SLOW = 0.3;

/**
 * One finger sliding through an open menu: [T] is whatever an option is (an element in the page). Pure, so
 * the rules can be tested:
 * - an option is only picked by a finger that moved after the menu opened (a menu opening right under a
 *   resting finger must not pick what it lands on);
 * - only the option under it as it lifts;
 * - and only a deliberate lift (review C3): the finger rested on the option for SLIDE_DWELL, or came onto it
 *   slowly. A finger flicking across the options (a scroll that got caught) picks nothing.
 * Times are in ms, from the pointer events.
 */
export class SlideSession<T> {
  private moved = false;
  private x0: number;
  private y0: number;
  /** Since when the lit option has been under the finger. */
  private overSince = 0;
  /** The last place the finger was seen, and its speed getting there. */
  private last: { x: number; y: number; t: number };
  private speed = 0;
  over: T | null = null;
  constructor(x0: number, y0: number, t0 = 0) {
    this.x0 = x0; this.y0 = y0;
    this.last = { x: x0, y: y0, t: t0 };
  }
  /** The finger at [x, y] over [item] (null: no option there) at time [t]. True when the lit option changed. */
  move(x: number, y: number, item: T | null, t = this.last.t): boolean {
    const dt = t - this.last.t;
    if (dt > 0) this.speed = Math.hypot(x - this.last.x, y - this.last.y) / dt;
    this.last = { x, y, t };
    if (!this.moved && Math.hypot(x - this.x0, y - this.y0) > TOUCH_SLOP) this.moved = true;
    const next = this.moved ? item : null;
    if (next === this.over) return false;
    this.over = next;
    this.overSince = t;
    return true;
  }
  /** The finger lifts at time [t]: the option to pick, if any. */
  up(t = this.last.t): T | null {
    if (!this.moved || this.over === null) return null;
    // The speed of its last move: a finger that came fast and stopped still needs the dwell.
    return t - this.overSince >= SLIDE_DWELL || this.speed < SLIDE_SLOW ? this.over : null;
  }
}

/** How long (ms) after a hold opened a menu, or after its finger lifted, the browser's own click is dropped. */
export const CLICK_DROP_MS = 600;
/**
 * Whether a real click at [now] is the leftover of a hold that opened a menu (set at [swallowAt], 0: none), to be
 * dropped. Only for a moment (review C6): a click that never came mustn't eat a later one, such as a key's.
 */
export function dropsClick(swallowAt: number, now: number): boolean {
  return swallowAt > 0 && now - swallowAt <= CLICK_DROP_MS;
}

/** How near (px) a long menu's top or bottom edge a sliding finger makes it scroll, and its top speed (px a frame). */
export const MENU_EDGE = 40;
const MENU_SPEED = 10;

/**
 * A menu too long for the screen scrolls itself while a finger slides through it (2.10.2's leftover): px to
 * scroll this frame (negative: up) for a finger at [x, y], once the finger has been on its options ([entered];
 * a menu opening beside the finger mustn't run off on its own). Near the top or bottom edge, or past it while
 * still over the menu's width; faster the further in; nothing where it can't scroll further that way.
 */
export function menuEdgeSpeed(x: number, y: number, box: { left: number; right: number; top: number; bottom: number },
  scrollTop: number, maxScroll: number, entered: boolean): number {
  if (!entered || maxScroll <= 0 || x < box.left - 24 || x > box.right + 24) return 0;
  const d = y < box.top + MENU_EDGE ? -(box.top + MENU_EDGE - y) / MENU_EDGE : y > box.bottom - MENU_EDGE ? (y - (box.bottom - MENU_EDGE)) / MENU_EDGE : 0;
  if ((d < 0 && scrollTop <= 0) || (d > 0 && scrollTop >= maxScroll)) return 0;
  const m = Math.min(1, Math.abs(d));
  return Math.sign(d) * Math.max(1, MENU_SPEED * m * m);
}
