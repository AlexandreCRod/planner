// Dragging the rows of a list up and down into a new order (the to-dos, 241), the way the Notes grid
// (noteDrag.ts) and a note's checklist (ChecklistHandles.tsx) move theirs. Rows are the elements
// marked data-row="<id>" inside the list, in the list's order.
//
// A long press on a row lifts it (a pickup pulse, a shadow): a finger that moves first is a scroll or the
// row's swipe to the trash, never a drag. Once lifted, the row's swipe and any pager under it are let go
// (they're sent the pointer's cancel), scrolling stops, and the row stays under the finger while the
// others slide out of its way (a tick for each place passed); the list scrolls near its top or bottom
// edge. Letting go saves the order ([onDrop]) and the row settles from under the finger into its new
// place (one settle pulse). With a mouse there's no long press: a row moved up or down with the button
// down is dragged straight away (a sideways move is still the swipe).
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { moveId } from "../../domain/noteOrder.ts";
import { feel } from "./haptics.ts";
import { GLIDE_SPRING, type Animation, animateSpring } from "./motion.ts";
import { LONG_PRESS, TOUCH_SLOP, swallowClick } from "./press.ts";
import { suspendOverscroll } from "./overscroll.ts";
import { edgeSpeed } from "./selectScroll.ts";

/** The settle spring runs on 0..1, so it needs its own (much finer) resting point. */
const SETTLE = { ...GLIDE_SPRING, restDelta: 0.002, restSpeed: 0.05 };

interface Row { id: number; el: HTMLElement; top: number; h: number }
interface Drag {
  id: number; pointer: number; el: HTMLElement; mouse: boolean; x0: number; y0: number; fy: number;
  held: boolean; dragging: boolean;
  /** The rows when lifted (tops in the list's own px, scrolling left out), and the dragged one's index. */
  rows: Row[]; from: number; to: number; scroll0: number;
  timer: number; scrollRaf: number;
}

/** The nearest box above [el] that scrolls up and down. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if (o === "auto" || o === "scroll") return n;
  }
  return null;
}

/** Whether a row drag has a row lifted now (the row's own swipe and the pagers stay out of it). */
let lifted = false;
export const rowDragging = () => lifted;

export function useRowDrag(opts: {
  /** The list holding the rows. */
  list: () => HTMLElement | null;
  /** Called with every row's id in the new order and the one moved, when it was dropped somewhere new. */
  onDrop: (ids: number[], moved: number) => void;
}) {
  const o = useRef(opts);
  o.current = opts;
  const drag = useRef<Drag | null>(null);
  const settles = useRef(new Map<HTMLElement, Animation>());
  /** Set while this hook sends the pointer's cancel to the other gestures (not ours to end on). */
  const cancelling = useRef(false);

  const scroller = (d: Drag) => scrollParent(d.el);
  const scrolled = (d: Drag) => (scroller(d)?.scrollTop ?? 0) - d.scroll0;
  /** How far the row has gone from its place: the finger's move plus the list's scroll since, kept within the list's rows. */
  const offset = (d: Drag) => {
    const me = d.rows[d.from], first = d.rows[0], last = d.rows[d.rows.length - 1];
    return Math.max(first.top - me.top, Math.min(last.top + last.h - me.h - me.top, d.fy - d.y0 + scrolled(d)));
  };

  const place = () => {
    const d = drag.current;
    if (!d?.dragging) return;
    d.el.style.transform = `translate3d(0,${offset(d)}px,0)`;
  };

  /** The place under the row's middle: the others between there and its own slide over by its height. */
  const reorder = () => {
    const d = drag.current;
    if (!d?.dragging) return;
    const me = d.rows[d.from];
    const mid = me.top + offset(d) + me.h / 2;
    let to = d.from;
    while (to > 0 && mid <= d.rows[to - 1].top + d.rows[to - 1].h / 2) to--;
    while (to < d.rows.length - 1 && mid >= d.rows[to + 1].top + d.rows[to + 1].h / 2) to++;
    if (to === d.to) return;
    d.to = to;
    feel("tick");
    d.rows.forEach((r, i) => {
      if (i === d.from) return;
      const dy = i >= to && i < d.from ? me.h : i <= to && i > d.from ? -me.h : 0;
      r.el.style.transform = dy ? `translate3d(0,${dy}px,0)` : "";
    });
  };

  const autoScroll = (t: number, last: number) => {
    const d = drag.current;
    if (!d?.dragging) return;
    const sc = scroller(d);
    if (sc) {
      const r = sc.getBoundingClientRect();
      const v = edgeSpeed(d.fy, r.top, r.bottom) * Math.min(3, Math.max(0.5, (t - last) / 16.7));
      if (v) {
        const s0 = sc.scrollTop;
        sc.scrollTop = s0 + v;
        if (sc.scrollTop !== s0) { place(); reorder(); }
      }
    }
    d.scrollRaf = requestAnimationFrame((n) => autoScroll(n, t));
  };

  /** Glides [el] from [dy] px off its place into it, the lift's shadow fading as it goes. */
  const settle = (el: HTMLElement, dy: number) => {
    settles.current.get(el)?.stop();
    el.dataset.lift = "down";
    const a = animateSpring(1, 0, 0, (k) => { el.style.transform = k ? `translate3d(0,${dy * k}px,0)` : ""; }, () => {
      settles.current.delete(el);
      el.style.transform = "";
      delete el.dataset.lift;
      const list = o.current.list();
      if (list && !settles.current.size && !drag.current) { delete list.dataset.rowdrag; delete list.dataset.reorder; }
    }, SETTLE);
    settles.current.set(el, a);
  };

  const end = (drop: boolean) => {
    const d = drag.current;
    if (!d) return;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.scrollRaf);
    stopListening();
    drag.current = null;
    if (lifted) { lifted = false; suspendOverscroll(false); }
    if (!d.held) return;
    swallowClick(500); // a long press or a drag doesn't open the row too
    const list = o.current.list();
    const others = d.rows.filter((r) => r.el !== d.el);
    if (!d.dragging) { settle(d.el, 0); return; }
    feel("settle");
    const ids = d.rows.map((r) => r.id);
    if (drop && d.to !== d.from) {
      // Saved and drawn in the new order at once; then nothing is shifted any more, and the dropped row
      // starts from under the finger and glides into its new place (glide.ts leaves this redraw alone).
      const was = d.el.getBoundingClientRect().top;
      if (list) list.dataset.reorder = "";
      flushSync(() => o.current.onDrop(moveId(ids, d.from, d.to), d.id));
      if (list) list.dataset.rowdrag = ""; // no sliding back: they are where they were shown
      for (const r of others) r.el.style.transform = "";
      d.el.style.transform = "";
      const now = d.el.getBoundingClientRect().top;
      settle(d.el, was - now);
    } else {
      // Back where it was: the others slide back too.
      for (const r of others) r.el.style.transform = "";
      settle(d.el, offset(d));
    }
  };

  const noScroll = (e: TouchEvent) => { if (drag.current?.held && e.cancelable) e.preventDefault(); };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    d.fy = e.clientY;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    const far = Math.hypot(dx, dy) > TOUCH_SLOP;
    if (!d.held) {
      if (!far) return;
      // A finger moving first is a scroll or a swipe; a mouse moved up or down is a drag, sideways a swipe.
      if (!d.mouse || Math.abs(dx) > Math.abs(dy)) { end(false); return; }
      clearTimeout(d.timer);
      lift(d);
      if (!d.held) { end(false); return; }
    }
    if (!d.dragging) {
      if (!far) return;
      d.dragging = true;
      d.el.dataset.lift = "drag";
      d.scrollRaf = requestAnimationFrame((n) => autoScroll(n, n));
    }
    place();
    reorder();
  };
  const onUp = (e: PointerEvent) => {
    if (cancelling.current || !drag.current || e.pointerId !== drag.current.pointer) return;
    end(e.type === "pointerup");
  };
  function stopListening() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.removeEventListener("touchmove", noScroll);
  }

  /** The long press (or a mouse's first move): the row lifts where it is, and is this gesture's alone. */
  const lift = (d: Drag) => {
    const list = o.current.list();
    if (drag.current !== d || !list || !d.el.isConnected) return;
    const els = [...list.querySelectorAll<HTMLElement>("[data-row]")];
    const from = els.indexOf(d.el);
    if (from < 0 || els.length < 2) return;
    const sc = scroller(d);
    d.scroll0 = sc?.scrollTop ?? 0;
    d.rows = els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: Number(el.dataset.row), el, top: r.top, h: r.height };
    });
    d.from = d.to = from;
    d.held = true;
    lifted = true;
    suspendOverscroll(true); // the page's rubber-band edge stays still under a lifted row
    for (const [el, a] of settles.current) { a.stop(); el.style.transform = ""; delete el.dataset.lift; }
    settles.current.clear();
    list.dataset.rowdrag = "live";
    d.el.dataset.lift = "up";
    feel("pickup");
    // The row's swipe and the pager under it let this pointer go.
    cancelling.current = true;
    try { window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: d.pointer, isPrimary: true, pointerType: d.mouse ? "mouse" : "touch" })); } finally { cancelling.current = false; }
  };

  useEffect(() => () => {
    const d = drag.current;
    if (d) { clearTimeout(d.timer); cancelAnimationFrame(d.scrollRaf); stopListening(); drag.current = null; if (lifted) { lifted = false; suspendOverscroll(false); } }
    for (const a of settles.current.values()) a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pointer-down on a row (its element carries data-row). */
  const down = (e: React.PointerEvent<HTMLElement>) => {
    if (drag.current || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const mouse = e.pointerType === "mouse";
    // A mouse on the tick box ticks it; a finger may hold it to lift the row too.
    if (mouse && (e.target as Element).closest("input, button, a")) return;
    const d: Drag = {
      id: Number(e.currentTarget.dataset.row), pointer: e.pointerId, el: e.currentTarget, mouse, x0: e.clientX, y0: e.clientY, fy: e.clientY,
      held: false, dragging: false, rows: [], from: 0, to: 0, scroll0: 0, timer: 0, scrollRaf: 0,
    };
    if (!mouse) d.timer = window.setTimeout(() => lift(d), LONG_PRESS);
    drag.current = d;
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    document.addEventListener("touchmove", noScroll, { passive: false });
  };
  return { down };
}
