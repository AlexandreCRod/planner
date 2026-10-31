// Sideways drags that never get in the way of taps, the way Compose's detectHorizontalDragGestures
// behaves: nothing happens until the finger has moved past the touch slop (8 dp) sideways, so a tap
// that wobbles a little is still a tap; once a drag has started, the click it would end in is dropped.
// No pointer capture and no preventDefault: the browser keeps vertical scrolling (touch-action: pan-y).
import { useEffect, useRef } from "react";
import { TOUCH_SLOP, swallowClick, textTouch } from "./press.ts";
import { VelocityTracker } from "./motion.ts";

// One owner per finger: whatever takes a drag says so here, and the tab pager (PhoneApp), which is last in
// line, leaves that finger alone. Inner gestures see the finger first (their listeners are added first).
let claimed: number | null = null;
/** This finger's drag is taken (an inner pager, a row's swipe, a block being moved). */
export const claimSwipe = (id: number) => { claimed = id; };
export const swipeClaimed = (id: number) => claimed === id;
/** A new finger: nothing is taken yet. (A mouse keeps the same id all the time.) */
export const clearSwipeClaim = () => { claimed = null; };

export interface SwipeHandlers {
  /** The drag has started (past the slop). */
  onStart?: () => void;
  /** Finger moved: [dx] since touch-down, in px. */
  onMove: (dx: number) => void;
  /** Lifted (or the browser took the touch): [dx] since touch-down and the speed in px/ms. */
  onEnd: (dx: number, vx: number) => void;
  /** Whether a drag that has just passed the slop this way ([dx] < 0: leftwards) is this one's to take. */
  accept?: (dx: number) => boolean;
}

/** Drops the next click if it comes within a moment (the one a drag ends in, with a mouse). */
function swallowNextClick() {
  swallowClick(400);
}

export function useHorizontalSwipe<T extends HTMLElement>(handlers: SwipeHandlers) {
  const ref = useRef<T>(null);
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let g: { id: number; x0: number; y0: number; dragging: boolean; done: boolean; vt: VelocityTracker; lastX: number } | null = null;

    const finish = (cancelled: boolean, t = 0) => {
      if (!g) return;
      const cur = g;
      g = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (cur.dragging) {
        if (!cancelled) swallowNextClick();
        h.current.onEnd(cur.lastX - cur.x0, cancelled ? 0 : cur.vt.velocity(t));
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id || g.done) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      g.vt.addEvent(e, "x");
      g.lastX = e.clientX;
      if (!g.dragging) {
        if (Math.abs(dy) > TOUCH_SLOP && Math.abs(dy) >= Math.abs(dx)) { g.done = true; return; } // a scroll
        if (Math.abs(dx) <= TOUCH_SLOP) return;
        if (h.current.accept && !h.current.accept(dx)) { g.done = true; return; }
        g.dragging = true;
        claimSwipe(e.pointerId);
        h.current.onStart?.();
      }
      h.current.onMove(dx);
    };
    const onUp = (e: PointerEvent) => { if (g && e.pointerId === g.id) finish(false, e.timeStamp); };
    const onCancel = (e: PointerEvent) => { if (g && e.pointerId === g.id) finish(true); };
    const onDown = (e: PointerEvent) => {
      if (g || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (textTouch(e.target)) return; // selecting or editing text: the browser's
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dragging: false, done: false, vt: new VelocityTracker(), lastX: e.clientX };
      g.vt.add(e.timeStamp, e.clientX);
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp, { passive: true });
      window.addEventListener("pointercancel", onCancel, { passive: true });
    };
    el.addEventListener("pointerdown", onDown, { passive: true });
    return () => { finish(true); el.removeEventListener("pointerdown", onDown); };
  }, []);
  return ref;
}

export { swallowNextClick };
