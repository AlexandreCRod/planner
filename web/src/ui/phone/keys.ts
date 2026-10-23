// Mouse, trackpad and keyboard on the phone screens: the pure part (which key does what, when a key
// belongs to the text being typed, how a sideways trackpad swipe turns one page), kept apart for the
// tests. The listeners are in desk.ts.

/** What a key press asks for. */
export type DeskAction = "back" | "find" | "add" | "today" | "prev" | "next" | null;

export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean }

/** Something that takes typing: a text field, a text area, a select, or editable text (the note). */
export function typingTarget(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && !/^(button|checkbox|radio|color|file|submit|reset|image)$/i.test(el.type ?? "text");
}

/**
 * The action for a key: Esc goes back (whatever has the focus), Ctrl+F (Cmd+F) finds (also while
 * typing: in a note it's the note's own find bar), and while nothing is being typed N adds, T goes to
 * today and ← → turn the pager in view.
 */
export function deskAction(e: KeyLike, typing: boolean): DeskAction {
  if (e.isComposing) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Escape" && !mod && !e.altKey) return "back";
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") return "find";
  if (typing || mod || e.altKey) return null;
  if (e.key === "ArrowLeft" && !e.shiftKey) return "prev";
  if (e.key === "ArrowRight" && !e.shiftKey) return "next";
  if (e.shiftKey) return null;
  const k = e.key.toLowerCase();
  return k === "n" ? "add" : k === "t" ? "today" : null;
}

/** A sideways swipe must travel this far (px) to turn a page. */
export const WHEEL_STEP = 40;
/** Wheel events closer together than this (ms) are one gesture, its fling included. */
export const WHEEL_GAP = 220;

/**
 * Turns a stream of wheel events into pages: a sideways trackpad swipe (or Shift+wheel) turns one
 * page once it has travelled WHEEL_STEP px, and nothing more until the events stop (the swipe's own
 * fling dies out) for WHEEL_GAP ms. Mostly vertical events are scrolling, not ours.
 */
export class WheelPager {
  private acc = 0;
  private last = -Infinity;
  private spent = false;
  /** [dx], [dy] px at [t] ms: 1 for the next page, -1 for the previous, 0 for none. */
  feed(dx: number, dy: number, t: number): -1 | 0 | 1 {
    if (t - this.last > WHEEL_GAP) { this.acc = 0; this.spent = false; }
    this.last = t;
    if (this.spent || Math.abs(dx) <= Math.abs(dy)) return 0;
    this.acc += dx;
    if (Math.abs(this.acc) < WHEEL_STEP) return 0;
    this.spent = true;
    return this.acc > 0 ? 1 : -1;
  }
}

/** Ctrl+wheel zoom: the hour height after [deltaY] px of wheel (down zooms out), within the limits. */
export function wheelZoom(h: number, deltaY: number, minH: number, maxH: number): number {
  return Math.min(maxH, Math.max(minH, h * Math.exp(-deltaY * 0.0025)));
}
