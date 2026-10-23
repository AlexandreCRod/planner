// The Notes page's grid, and dragging notes in it like Google Keep. The cards sit in two columns, each
// under the shorter one (domain/noteOrder.ts noteSlots), placed by transforms from measured heights, so
// a card never changes parent and moving them is all composited.
//
// A long press on a card lifts it (a slight scale and shadow; the press itself also starts selecting,
// whose pick-up is the one pulse). Moving the finger without lifting it then drags the card instead: it
// stays exactly under the finger, the other cards slide out of its way to their new places, the list
// scrolls near the top or bottom edge, and letting go settles it into its slot (one settle pulse).
// Pinned notes move among the pinned ones, the others among the others; the new order is saved by
// [onDrop] (pinOrder or listOrder, domain/noteOrder.ts). With a mouse there's no long press first: a
// card moved with the button down is dragged straight away.
import { useEffect, useLayoutEffect, useRef } from "react";
import { type Slot, inSlot, moveId, noteSlots } from "../../domain/noteOrder.ts";
import { feel } from "./haptics.ts";
import { GLIDE_SPRING, type Animation, animateSpring } from "./motion.ts";
import { TOUCH_SLOP, swallowClick } from "./press.ts";
import { edgeSpeed } from "./selectScroll.ts";

const LONG_PRESS = 450; // the same as starting a selection (Select.tsx)
const GAP = 8;
const LIFT = 1.04;
/** How far the finger must go before the order may flip straight back (cards of different heights). */
const BACK_SLOP = 24;
/** The settle spring runs on 0..1, so it needs its own (much finer) resting point. */
const SETTLE = { ...GLIDE_SPRING, restDelta: 0.002, restSpeed: 0.05 };

interface Drag {
  id: number; pointer: number; el: HTMLElement; x0: number; y0: number;
  held: boolean; dragging: boolean; wasSelected: boolean;
  /** The finger's place in the card when it was lifted (px from its unscaled top-left corner). */
  gx: number; gy: number;
  /** The finger now (client px), and the grid's place when lifted (the list only scrolls by us after). */
  fx: number; fy: number; gridLeft: number; gridTop: number; scroll0: number;
  order: number[]; start: number[];
  /** The order before the last move and where the finger was then: not flipped straight back to. */
  back: { order: string; x: number; y: number } | null;
  timer: number; scrollRaf: number;
  /** Removes the listeners this drag added. */
  stop: () => void;
}

export function useNoteGrid(opts: {
  /** The grid holding the cards ([data-note] on each). */
  grid: () => HTMLElement | null; scroller: () => HTMLElement | null;
  /** Every shown note's id in the page's order (the order being dragged into, while dragging). */
  order: readonly number[];
  /** Which ones move together: pinned or not; null for a card that can't be dragged. */
  groupOf: (id: number) => string | null;
  /** Shows the notes in this order while dragging (null: their own). */
  setOrder: (ids: number[] | null) => void;
  onDrop: (ids: number[], moved: number) => void;
  isSelected: (id: number) => boolean; unselect: (id: number) => void;
}) {
  // The listeners outlive the render they were added in: they read the latest of everything.
  const o = useRef(opts);
  o.current = opts;
  const drag = useRef<Drag | null>(null);
  const slots = useRef(new Map<number, Slot>());
  /** Cards whose transform the drag owns (lifted, dragged, or settling into place). */
  const busy = useRef(new Set<number>());
  const settles = useRef(new Map<number, Animation>());

  const cards = () => new Map([...(o.current.grid()?.querySelectorAll<HTMLElement>(":scope > [data-note]") ?? [])].map((el) => [Number(el.dataset.note), el]));
  // A card at rest takes a flat translate (no layer of its own for every card); a lifted one a 3D one.
  const at = (s: Slot, k = 0) => (k ? `translate3d(${s.x}px,${s.y}px,0) scale(${1 + (LIFT - 1) * k})` : `translate(${s.x}px,${s.y}px)`);
  /** What was last written to each card at rest (the browser's own copy of it is reformatted). */
  const written = useRef(new WeakMap<HTMLElement, string>());

  /** Measures the cards and puts each in its slot (all reads first, then the writes). */
  const layout = () => {
    const g = o.current.grid();
    if (!g) return;
    const els = cards();
    const order = o.current.order.filter((id) => els.has(id));
    const width = g.clientWidth;
    const heights = order.map((id) => els.get(id)!.offsetHeight);
    const { slots: list, height } = noteSlots(heights, width, GAP);
    slots.current = new Map(order.map((id, i) => [id, list[i]]));
    const h = `${height}px`;
    if (g.style.height !== h) g.style.height = h;
    for (const [id, el] of els) {
      const s = slots.current.get(id);
      if (!s || busy.current.has(id)) continue;
      const t = at(s);
      if (written.current.get(el) !== t || !el.style.transform) { el.style.transform = t; written.current.set(el, t); }
    }
    place();
  };
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useLayoutEffect(() => { layout(); observe(); });

  // A card changing size (a font arriving, the page changing width) lays the grid out again.
  const ro = useRef<ResizeObserver | null>(null);
  const watched = useRef(new Set<Element>());
  const observe = () => {
    if (typeof ResizeObserver === "undefined") return;
    if (!ro.current) ro.current = new ResizeObserver(() => layoutRef.current());
    // The cards only: a new width resizes them too, and the grid's own height is ours to set.
    const now = new Set<Element>([...cards().values()]);
    for (const el of watched.current) if (!now.has(el)) ro.current.unobserve(el);
    for (const el of now) if (!watched.current.has(el)) ro.current.observe(el);
    watched.current = now;
  };
  useEffect(() => () => {
    ro.current?.disconnect();
    for (const a of settles.current.values()) a.stop();
    const d = drag.current;
    if (d) { clearTimeout(d.timer); cancelAnimationFrame(d.scrollRaf); d.stop(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** The finger in the grid's own coordinates. */
  const finger = (d: Drag) => {
    const sc = o.current.scroller();
    return { x: d.fx - d.gridLeft, y: d.fy - d.gridTop + ((sc?.scrollTop ?? 0) - d.scroll0) };
  };
  /** The dragged card under the finger, exactly where it was picked up from. */
  const place = () => {
    const d = drag.current;
    if (!d?.dragging) return;
    const f = finger(d);
    d.el.style.transform = `translate3d(${f.x - d.gx}px,${f.y - d.gy}px,0) scale(${LIFT})`;
  };

  /** Over another card of its group: the dragged one takes its place, and the others make room. */
  const reorder = () => {
    const d = drag.current;
    if (!d?.dragging) return;
    const f = finger(d), group = o.current.groupOf(d.id);
    let target = -1;
    d.order.forEach((id, i) => {
      if (target >= 0 || id === d.id || o.current.groupOf(id) !== group) return;
      const s = slots.current.get(id);
      if (s && inSlot(s, f.x, f.y)) target = i;
    });
    const from = d.order.indexOf(d.id);
    if (target < 0 || target === from) return;
    const next = moveId(d.order, from, target);
    if (d.back && d.back.order === next.join() && Math.hypot(f.x - d.back.x, f.y - d.back.y) < BACK_SLOP) return;
    d.back = { order: d.order.join(), x: f.x, y: f.y };
    d.order = next;
    o.current.setOrder(next);
  };

  const autoScroll = (t: number, last: number) => {
    const d = drag.current;
    const sc = o.current.scroller();
    if (!d?.dragging || !sc) return;
    const r = sc.getBoundingClientRect();
    const v = edgeSpeed(d.fy, r.top, r.bottom) * Math.min(3, Math.max(0.5, (t - last) / 16.7));
    if (v) {
      const s0 = sc.scrollTop;
      sc.scrollTop = s0 + v;
      if (sc.scrollTop !== s0) { place(); reorder(); }
    }
    d.scrollRaf = requestAnimationFrame((n) => autoScroll(n, t));
  };

  /** A card lifted but let go without moving (a long press to select) goes back down. */
  const putDown = (id: number, el: HTMLElement) => {
    el.dataset.down = "";
    const s = slots.current.get(id);
    if (s) el.style.transform = at(s);
    window.setTimeout(() => {
      if (drag.current?.held && drag.current.id === id) return; // lifted again meanwhile
      delete el.dataset.lift; delete el.dataset.down;
      el.style.transformOrigin = "";
      busy.current.delete(id);
      if (!drag.current?.dragging && !settles.current.size) delete o.current.grid()?.dataset.live;
      layoutRef.current();
    }, 170);
  };

  /** Glides a dropped card from under the finger into its slot (wherever that is by then). */
  const settle = (d: Drag) => {
    const { id, el } = d, f = finger(d);
    const from = { x: f.x - d.gx, y: f.y - d.gy };
    // Still lifted for dragging (no transition on its transform: the spring writes it); its shadow fades.
    el.dataset.down = "";
    settles.current.get(id)?.stop();
    settles.current.set(id, animateSpring(1, 0, 0, (k) => {
      const s = slots.current.get(id);
      if (!s) return;
      el.style.transform = `translate3d(${s.x + (from.x - s.x) * k}px,${s.y + (from.y - s.y) * k}px,0) scale(${1 + (LIFT - 1) * k})`;
    }, () => {
      settles.current.delete(id);
      busy.current.delete(id);
      delete el.dataset.lift; delete el.dataset.down;
      el.style.transformOrigin = "";
      if (!drag.current && !settles.current.size) delete o.current.grid()?.dataset.live;
      layoutRef.current();
    }, SETTLE));
  };

  const end = (drop: boolean) => {
    const d = drag.current;
    if (!d) return;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.scrollRaf);
    d.stop();
    drag.current = null;
    if (!d.held) return;
    if (!d.dragging) { putDown(d.id, d.el); return; }
    swallowClick(500);
    const changed = d.order.join() !== d.start.join();
    // The layout is already in the new order: settle into it, then save it (the page then keeps it).
    settle(d);
    feel("settle");
    if (drop && changed) o.current.onDrop(d.order, d.id);
    o.current.setOrder(null);
  };

  const noScroll = (e: TouchEvent) => { if (drag.current?.held && e.cancelable) e.preventDefault(); };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    d.fx = e.clientX; d.fy = e.clientY;
    const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > TOUCH_SLOP;
    if (!d.held) {
      if (!far) return;
      // A finger moving first is a scroll; a mouse has no scroll to tell apart, so a card moved with
      // the button down is lifted at once and dragged.
      if (e.pointerType !== "mouse") { end(false); return; }
      clearTimeout(d.timer);
      lift(d);
      if (!d.held) { end(false); return; }
    }
    if (!d.dragging) {
      if (!far) return;
      d.dragging = true;
      // The long press picked it for selecting; moving it means reordering instead.
      if (!d.wasSelected && o.current.isSelected(d.id)) o.current.unselect(d.id);
      d.el.dataset.lift = "drag";
      const g = o.current.grid();
      if (g) g.dataset.live = "";
      d.scrollRaf = requestAnimationFrame((n) => autoScroll(n, n));
    }
    place();
    reorder();
  };
  const onUp = (e: PointerEvent) => { if (drag.current && e.pointerId === drag.current.pointer) end(true); };
  function stopListening() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.removeEventListener("touchmove", noScroll);
  }

  /** The long press: the card lifts around the finger (the selection's own pulse goes with it). */
  const lift = (d: Drag) => {
    const g = o.current.grid(), s = slots.current.get(d.id);
    if (drag.current !== d || !g || !s) return;
    settles.current.get(d.id)?.stop();
    settles.current.delete(d.id);
    const r = g.getBoundingClientRect();
    d.gridLeft = r.left; d.gridTop = r.top; d.scroll0 = o.current.scroller()?.scrollTop ?? 0;
    d.gx = d.fx - r.left - s.x; d.gy = d.fy - r.top - s.y;
    d.held = true;
    busy.current.add(d.id);
    delete d.el.dataset.down;
    d.el.style.transformOrigin = `${d.gx}px ${d.gy}px`;
    d.el.dataset.lift = "up";
    written.current.delete(d.el); // the drag writes it from here on
    d.el.style.transform = at(s, 1);
  };

  /** Pointer-down on a card that can be dragged (alongside the selection's own handlers). */
  const down = (id: number, e: React.PointerEvent<HTMLElement>) => {
    if (drag.current || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (o.current.groupOf(id) === null) return;
    const order = o.current.order.filter((x) => slots.current.has(x));
    const d: Drag = {
      id, pointer: e.pointerId, el: e.currentTarget, x0: e.clientX, y0: e.clientY, held: false, dragging: false, wasSelected: o.current.isSelected(id),
      gx: 0, gy: 0, fx: e.clientX, fy: e.clientY, gridLeft: 0, gridTop: 0, scroll0: 0, order: [...order], start: [...order], back: null, timer: 0, scrollRaf: 0,
      stop: stopListening,
    };
    d.timer = window.setTimeout(() => lift(d), LONG_PRESS);
    drag.current = d;
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    document.addEventListener("touchmove", noScroll, { passive: false });
  };
  return { down };
}
