// Live sideways pagers (Today's days, the calendar's months and years, the Tasks, Alarms and Progress tabs): the
// content follows the finger, 1.2 times its travel, with the neighbouring page sliding in beside it,
// then settles like Compose's HorizontalPager: past 400 dp/s it goes the way it was flung, otherwise to
// the nearest page, on a snappy critically damped spring (motion.ts) that starts at the finger's speed.
// Nothing moves until the finger has gone past the 8 dp touch slop sideways, so taps still win, and a
// mostly-vertical move is left to the browser's scrolling (touch-action: pan-y). Moves are written once
// per frame, at sub-pixel offsets, through the layers' style (no React render during the drag).
import { useEffect, useRef, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { type SwipeHandlers, claimSwipe, swallowNextClick, swipeClaimed } from "./gesture.ts";
import { TOUCH_SLOP, selectingText, textTouch } from "./press.ts";
import { FLICK, PAGE_SPRING, VelocityTracker, animateSpring, frameWriter, rubberBand } from "./motion.ts";
import { deskPager } from "./desk.ts";

/** A flick turns the page whatever the distance (motion.ts FLICK; Compose's own is 400 dp/s). */
export const SNAP_VELOCITY = FLICK;
/** Inner pagers move this much further than the finger, so a short swipe turns a page. */
export const SWIPE_GAIN = 1.2;

/**
 * Settings > "Swipe pages to change tab" (300), on by default: a sideways swipe on a page changes tab, and
 * days and weeks change on the top bar. Off, the pages change the day or week, as before.
 */
export const SWIPE_TABS_KEY = "swipeTabs";
export const swipeTabs = () => { try { return localStorage.getItem(SWIPE_TABS_KEY) !== "false"; } catch { return true; } };
/** Settings > "Bottom bar changes days and weeks" (300), off by default; only while the pages change tabs. */
export const BAR_DAYS_KEY = "barDays";
export const barDays = () => { try { return swipeTabs() && localStorage.getItem(BAR_DAYS_KEY) === "true"; } catch { return false; } };

/** Places that keep a sideways drag to themselves: the tab pager and the pagers on the way never start there. */
export const NO_SWIPE = "input, textarea, [contenteditable], .p-switch, .pa-noswipe, .pg-chart, .p-slide, .tw-col, .pg-resize, .p-menu, .p-menu-scrim, .p-sheet-root";

/** A pager moved from outside (the top bar, the bottom bar's option, the ‹ › buttons), with its own slide. */
export interface PageTurner {
  /** A drag begins. */
  start(): void;
  /** The finger is [dx] px from where the drag began. */
  move(dx: number): void;
  /** Let go at [vx] px/ms. */
  end(vx: number): void;
  /** One page that way, as if flicked. */
  turn(dir: 1 | -1): void;
}
/** The day pager of Today and whichever view the Calendar shows. */
export const turners: Record<string, { current: PageTurner | null }> = { today: { current: null }, calendar: { current: null } };

/**
 * The top bar's swipe: what useHorizontalSwipe needs to drive a page's turner. With no turner there (the
 * Agenda has no pager) a swipe past the middle or a flick calls [step] when the finger lifts.
 */
export function turnerSwipe(key: string, step: (dir: 1 | -1) => void, width: () => number): SwipeHandlers {
  const t = turners[key];
  let from = 0;
  return {
    accept: () => swipeTabs(),
    onStart: () => { t.current?.start(); from = 0; },
    onMove: (dx) => {
      if (!from) from = Math.sign(dx) * TOUCH_SLOP; // from where the slop ran out, as a pager's drag
      t.current?.move(dx - from);
    },
    onEnd: (dx, vx) => {
      if (t.current) { t.current.end(vx); return; }
      const dir = pageTarget(dx, vx, width());
      if (dir) step(dir);
    },
  };
}

/**
 * Which page to settle on after a drag of [dx] px at [vx] px/ms on pages [w] px wide: 1 for the next
 * page (finger went left), -1 for the previous one, 0 to stay.
 */
export function pageTarget(dx: number, vx: number, w: number): -1 | 0 | 1 {
  const f = Math.max(-1, Math.min(1, -dx / w)); // how far towards the next page, in pages
  let t: number;
  if (vx < -SNAP_VELOCITY) t = Math.ceil(f);
  else if (vx > SNAP_VELOCITY) t = Math.floor(f);
  else t = Math.round(f);
  return (t > 0 ? 1 : t < 0 ? -1 : 0);
}

/**
 * A spring from [from] to [to] starting at [v0] px/ms (the pagers' snappy settle), calling [frame]
 * every animation frame and [done] once it rests. Returns a function that stops it where it is.
 */
export function spring(from: number, to: number, v0: number, frame: (x: number) => void, done: () => void): () => void {
  const a = animateSpring(from, to, v0, frame, done, PAGE_SPRING);
  return () => a.stop();
}

export interface PagerOptions {
  /** The layers that slide together (each lays the previous, current and next page side by side). */
  layers: () => (HTMLElement | null)[];
  /** One page's width in px (the pager element's width when left out). */
  width?: () => number;
  /** Turn one page: called inside flushSync, so the new pages are drawn before the slide is undone. */
  onStep: (dir: 1 | -1) => void;
  /** Whether the drag may start here (e.g. not on something that has its own gesture). */
  allow?: (target: Element) => boolean;
  /** Whether there is a page that way (at the first or last page the drag only gives a little, and springs back). */
  canStep?: (dir: 1 | -1) => boolean;
  /** Told where the pages are as they move (px, negative towards the next page), e.g. to move a tab indicator. */
  onMove?: (x: number, w: number) => void;
  /** At the first or last page, a drag towards no page is left alone (for a row's own swipe, or the tab pager) instead of giving a little. */
  yieldAtEdge?: boolean | (() => boolean);
  /** Whether the pager's own area takes swipes now; when not, it's only moved through [turner]. Left out: always. */
  pages?: () => boolean;
  /** Filled with the way to move this pager from outside while it's mounted. */
  turner?: { current: PageTurner | null };
  /** Told when a settle has finished (after onStep, if it turned), e.g. to put a tab indicator back. */
  onSettled?: () => void;
}

/** Live pager on the element the returned ref goes on. */
export function useSwipePager<T extends HTMLElement>(opts: PagerOptions) {
  const ref = useRef<T>(null);
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let g: { id: number; x0: number; y0: number; dragging: boolean; done: boolean; vt: VelocityTracker; lastX: number; dx: number } | null = null;
    let stopAnim: (() => void) | null = null;
    // Once the pages are moving the browser mustn't take the finger for a scroll. Only listened to
    // during a drag, so plain scrolling never waits on the page's script.
    const onTouchMove = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
    let finishAnim: (() => void) | null = null;
    // The page width, measured once per gesture: reading it after each transform write would make the
    // browser recalculate styles in the middle of every frame.
    let cw = 0;
    const width = () => cw || (cw = o.current.width?.() ?? el.clientWidth);

    /** Where the pages go for a finger [dx] px from the start: past the first or last page, only a little. */
    const dragged = (dx: number) => {
      const w = width();
      let x = SWIPE_GAIN * dx;
      if (x && o.current.canStep && !o.current.canStep(x < 0 ? 1 : -1)) x = rubberBand(x, w);
      return Math.max(-w, Math.min(w, x));
    };
    const place = (x: number) => {
      const t = x ? `translate3d(${x}px,0,0)` : "";
      for (const l of o.current.layers()) if (l) l.style.transform = t;
      o.current.onMove?.(x, width());
    };
    const write = frameWriter(place);
    /** Lets the pages go from [dx] at [vx]; [to] turns a page whatever the drag (a key or a trackpad swipe). */
    const settle = (dx: number, vx: number, to?: 1 | -1) => {
      write.cancel();
      const w = width();
      let dir = to ?? pageTarget(dx, vx, w);
      if (dir && o.current.canStep && !o.current.canStep(dir)) dir = 0;
      const end = () => {
        stopAnim = null; finishAnim = null;
        if (dir) flushSync(() => o.current.onStep(dir));
        place(0);
        cw = 0;
        o.current.onSettled?.();
      };
      finishAnim = end;
      stopAnim = spring(dx, -dir * w, vx, place, end);
    };
    const stop = () => {
      el.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id || g.done) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      g.vt.addEvent(e, "x");
      g.lastX = e.clientX;
      if (!g.dragging) {
        if (selectingText() || swipeClaimed(e.pointerId)) { g.done = true; return; } // or a drag already has this finger
        if (Math.abs(dy) > TOUCH_SLOP && Math.abs(dy) >= Math.abs(dx)) { g.done = true; return; } // a scroll
        if (Math.abs(dx) <= TOUCH_SLOP) return;
        const yields = typeof o.current.yieldAtEdge === "function" ? o.current.yieldAtEdge() : o.current.yieldAtEdge;
        if (yields && o.current.canStep && !o.current.canStep(dx < 0 ? 1 : -1)) { g.done = true; return; }
        g.dragging = true;
        claimSwipe(e.pointerId);
        el.addEventListener("touchmove", onTouchMove, { passive: false });
        g.x0 += Math.sign(dx) * TOUCH_SLOP; // like Compose, the drag starts from where the slop ran out
      }
      g.dx = dragged(e.clientX - g.x0);
      write(g.dx);
    };
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const cur = g;
      g = null;
      stop();
      if (cur.dragging) { swallowNextClick(); settle(cur.dx, SWIPE_GAIN * cur.vt.velocity(e.timeStamp)); }
    };
    const onCancel = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const cur = g;
      g = null;
      stop();
      if (cur.dragging) settle(cur.dx, 0);
    };
    const onDown = (e: PointerEvent) => {
      if (g || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (o.current.pages && !o.current.pages()) return;
      if (o.current.allow && !o.current.allow(e.target as Element)) return;
      if (textTouch(e.target)) return; // selecting or editing text: the browser's
      // A finger landing while a page is still settling finishes that at once.
      if (stopAnim) { stopAnim(); finishAnim?.(); }
      cw = 0;
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dragging: false, done: false, vt: new VelocityTracker(), lastX: e.clientX, dx: 0 };
      g.vt.add(e.timeStamp, e.clientX);
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      window.addEventListener("pointercancel", onCancel, { passive: true });
    };
    el.addEventListener("pointerdown", onDown, { passive: true });
    // The mouse and keyboard: ← → (while this is the pager in view) and a sideways trackpad swipe turn
    // one page, on the same spring, as if flicked.
    const turn = (dir: 1 | -1) => {
      if (g?.dragging) return false;
      if (stopAnim) { stopAnim(); finishAnim?.(); }
      if (o.current.canStep && !o.current.canStep(dir)) return false;
      cw = 0;
      settle(0, 0, dir);
      return true;
    };
    const undoDesk = deskPager(el, turn, (t) => !o.current.allow || o.current.allow(t), () => !o.current.pages || o.current.pages());
    let tx = 0;
    const turner: PageTurner = {
      start: () => { if (stopAnim) { stopAnim(); finishAnim?.(); } cw = 0; tx = 0; },
      move: (dx) => { tx = dragged(dx); write(tx); },
      end: (vx) => { settle(tx, SWIPE_GAIN * vx); },
      turn,
    };
    const slot = o.current.turner;
    if (slot) slot.current = turner;
    return () => {
      if (slot?.current === turner) slot.current = null;
      stop(); stopAnim?.(); write.cancel(); undoDesk();
      el.removeEventListener("pointerdown", onDown);
    };
  }, []);
  return ref;
}

/** The bottom bar's drag: the pages move this many tabs per tab width the finger slides along the bar. */
export const BAR_GAIN = 1.3;
/** A flick along the bar faster than this (px per ms) turns a page whatever the distance. */
export const BAR_FLING = FLICK;
/** Settings > "Reverse bottom bar swipe": a slide along the bar turns the pages the other way. */
export const BAR_REVERSED_KEY = "barSwipeReversed";
export const barSwipeReversed = () => { try { return localStorage.getItem(BAR_REVERSED_KEY) === "true"; } catch { return false; } };

/**
 * Settings > "Keep Tasks in the bottom bar" (241): off, Training has Tasks' place and the Tasks page opens
 * from the to-dos sheet on Today; on, the bar has both (Tasks after Training), so a swipe still reaches it.
 */
export const KEEP_TASKS_KEY = "keepTasksTab";
export const keepTasksTab = () => { try { return localStorage.getItem(KEEP_TASKS_KEY) === "true"; } catch { return false; } };
const keepTasksListeners = new Set<() => void>();
export function setKeepTasksTab(v: boolean) {
  try { localStorage.setItem(KEEP_TASKS_KEY, String(v)); } catch { /* private mode */ }
  keepTasksListeners.forEach((l) => l());
}
const onKeepTasks = (l: () => void) => { keepTasksListeners.add(l); return () => { keepTasksListeners.delete(l); }; };
/** The setting, kept current (the side rail beside Settings changes at once). */
export const useKeepTasksTab = (): boolean => useSyncExternalStore(onKeepTasks, keepTasksTab);

/**
 * Where the pager settles after a slide along the bottom bar: from page [from], the pages now at [pos]
 * (fractional), the finger leaving at [vx] px/ms. A flick goes on to the next whole page its way
 * (even after a short travel); otherwise the nearest page. Clamped to 0..[last].
 */
export function barTarget(from: number, pos: number, vx: number, last: number): number {
  let i: number;
  if (Math.abs(vx) > BAR_FLING && Math.sign(vx) === Math.sign(pos - from || vx)) {
    i = vx > 0 ? Math.ceil(pos) : Math.floor(pos);
    // Already sitting on a whole page beyond the start: that's where the flick ends.
    if (i === from) i += Math.sign(vx);
  } else i = Math.round(pos);
  return Math.min(last, Math.max(0, i));
}
