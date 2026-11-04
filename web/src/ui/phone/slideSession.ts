// A finger sliding through an open menu (361; menuSlide.ts does the page side).
import { TOUCH_SLOP } from "./press.ts";

/**
 * One finger sliding through an open menu: [T] is whatever an option is (an element in the page). Pure, so
 * the rules can be tested: an option is only picked by a finger that moved after the menu opened (a menu
 * opening right under a resting finger must not pick what it lands on), and only the option under it as it lifts.
 */
export class SlideSession<T> {
  private moved = false;
  private x0: number;
  private y0: number;
  over: T | null = null;
  constructor(x0: number, y0: number) { this.x0 = x0; this.y0 = y0; }
  /** The finger at [x, y] over [item] (null: no option there). True when the lit option changed. */
  move(x: number, y: number, item: T | null): boolean {
    if (!this.moved && Math.hypot(x - this.x0, y - this.y0) > TOUCH_SLOP) this.moved = true;
    const next = this.moved ? item : null;
    if (next === this.over) return false;
    this.over = next;
    return true;
  }
  /** The finger lifts: the option to pick, if any. */
  up(): T | null { return this.moved ? this.over : null; }
}
