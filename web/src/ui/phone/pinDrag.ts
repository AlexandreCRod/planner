// Reordering pinned notes on the Notes page by dragging. A long press on a pinned card still starts
// selecting (as on every card); moving the finger without lifting it after that picks the card up
// instead: it follows the finger, the other pinned cards make room as it passes them (gliding to their
// new places), the page scrolls near the top or bottom edge, and letting go settles it into its place.
// The new order is saved as each pinned note's pinOrder (domain/noteOrder.ts).
import { useLayoutEffect, useRef } from "react";
import { moveId } from "../../domain/noteOrder.ts";
import { feel } from "./haptics.ts";
import { GLIDE_SPRING, animateSpring } from "./motion.ts";
import { TOUCH_SLOP, swallowClick } from "./press.ts";
import { edgeSpeed } from "./selectScroll.ts";

const LONG_PRESS = 450; // the same as starting a selection (Select.tsx)

interface Drag {
  id: number; pointer: number; el: HTMLElement; x0: number; y0: number; held: boolean; dragging: boolean; wasSelected: boolean;
  /** The finger's place in the card, and where the card's untransformed box is. */
  gx: number; gy: number; fx: number; fy: number; order: number[]; start: number[];
  timer: number; scrollRaf: number;
}

export function usePinDrag(opts: {
  /** The grid holding the cards ([data-note] on each). */
  grid: () => HTMLElement | null; scroller: () => HTMLElement | null;
  /** The pinned notes' ids, in their shown order. */
  pinned: readonly number[];
  /** Shows the pinned notes in this order while dragging (null: their own). */
  setOrder: (ids: number[] | null) => void;
  onDrop: (ids: number[]) => void;
  isSelected: (id: number) => boolean; unselect: (id: number) => void;
}) {
  // The listeners outlive the render they were added in: they read the latest of everything.
  const o = useRef(opts);
  o.current = opts;
  const { grid, scroller, pinned } = opts;
  const setOrder = (ids: number[] | null) => o.current.setOrder(ids);
  const isSelected = (id: number) => o.current.isSelected(id);
  const unselect = (id: number) => o.current.unselect(id);
  const onDrop = (ids: number[]) => o.current.onDrop(ids);
  const drag = useRef<Drag | null>(null);
  const before = useRef<Map<number, DOMRect> | null>(null);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  const cards = () => new Map([...(grid()?.querySelectorAll<HTMLElement>("[data-note]") ?? [])].map((el) => [Number(el.dataset.note), el]));
  /** Where a card is without its own transform. */
  const box = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform === "none" ? undefined : getComputedStyle(el).transform);
    return { left: r.left - m.m41, top: r.top - m.m42, width: r.width, height: r.height };
  };
  const place = () => {
    const d = drag.current;
    if (!d?.dragging) return;
    const b = box(d.el);
    d.el.style.transform = `translate3d(${d.fx - d.gx - b.left}px,${d.fy - d.gy - b.top}px,0) scale(1.04)`;
  };

  // After the order changes: the dragged card stays under the finger, the others glide from where they were.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (!was) return;
    const d = drag.current;
    for (const [id, el] of cards()) {
      if (d && id === d.id) continue;
      const from = was.get(id);
      if (!from) continue;
      const b = box(el);
      const dx = from.left - b.left, dy = from.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.style.transition = "none";
      el.style.transform = `translate3d(${dx}px,${dy}px,0)`;
      void el.offsetWidth;
      el.style.transition = "transform .22s cubic-bezier(.2, 0, 0, 1)";
      el.style.transform = "";
      el.addEventListener("transitionend", () => { el.style.transition = ""; }, { once: true });
    }
    place();
  });

  const reorderAt = (x: number, y: number) => {
    const d = drag.current;
    if (!d) return;
    const all = cards();
    let target = -1;
    d.order.forEach((id, i) => {
      if (id === d.id) return;
      const el = all.get(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) target = i;
    });
    const from = d.order.indexOf(d.id);
    if (target < 0 || target === from) return;
    before.current = new Map([...all].map(([id, el]) => [id, el.getBoundingClientRect()]));
    d.order = moveId(d.order, from, target);
    feel("tick");
    setOrder(d.order);
  };

  const end = (drop: boolean) => {
    const d = drag.current;
    if (!d) return;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.scrollRaf);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("touchmove", noScroll);
    drag.current = null;
    if (!d.dragging) return;
    swallowClick(500);
    const el = d.el;
    const m = new DOMMatrixReadOnly(el.style.transform ? getComputedStyle(el).transform : undefined);
    const sx = m.m41, sy = m.m42;
    const changed = d.order.join() !== d.start.join();
    if (drop && changed) onDrop(d.order);
    setOrder(null);
    feel("settle");
    // Glides from where the finger left it into its place.
    animateSpring(1, 0, 0, (k) => { el.style.transform = k > 0.002 ? `translate3d(${sx * k}px,${sy * k}px,0) scale(${1 + 0.04 * k})` : ""; },
      () => { el.style.transform = ""; el.classList.remove("p-dragging"); }, GLIDE_SPRING);
  };

  const autoScroll = (t: number, last: number) => {
    const d = drag.current;
    const sc = scroller();
    if (!d?.dragging || !sc) return;
    const r = sc.getBoundingClientRect();
    const v = edgeSpeed(d.fy, r.top, r.bottom) * Math.min(3, Math.max(0.5, (t - last) / 16.7));
    if (v) {
      const s0 = sc.scrollTop;
      sc.scrollTop = s0 + v;
      if (sc.scrollTop !== s0) { place(); reorderAt(d.fx, d.fy); }
    }
    d.scrollRaf = requestAnimationFrame((n) => autoScroll(n, t));
  };

  const noScroll = (e: TouchEvent) => { if (drag.current?.held && e.cancelable) e.preventDefault(); };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    d.fx = e.clientX; d.fy = e.clientY;
    const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > TOUCH_SLOP;
    if (!d.held) { if (far) end(false); return; } // a scroll
    if (!d.dragging) {
      if (!far) return;
      d.dragging = true;
      // The long press picked it for selecting; moving it means reordering instead.
      if (!d.wasSelected && isSelected(d.id)) unselect(d.id);
      const b = box(d.el);
      d.gx = d.x0 - b.left; d.gy = d.y0 - b.top;
      d.el.classList.add("p-dragging");
      feel("pickup");
      d.scrollRaf = requestAnimationFrame((n) => autoScroll(n, n));
    }
    place();
    reorderAt(e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent) => { if (drag.current && e.pointerId === drag.current.pointer) end(true); };
  const onCancel = (e: PointerEvent) => { if (drag.current && e.pointerId === drag.current.pointer) end(true); };

  /** Pointer-down on a pinned card (alongside the selection's own handlers). */
  const down = (id: number, e: React.PointerEvent<HTMLElement>) => {
    if (drag.current || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const d: Drag = {
      id, pointer: e.pointerId, el: e.currentTarget, x0: e.clientX, y0: e.clientY, held: false, dragging: false, wasSelected: isSelected(id),
      gx: 0, gy: 0, fx: e.clientX, fy: e.clientY, order: [...pinnedRef.current], start: [...pinnedRef.current], timer: 0, scrollRaf: 0,
    };
    d.timer = window.setTimeout(() => { if (drag.current === d) d.held = true; }, LONG_PRESS);
    drag.current = d;
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    document.addEventListener("touchmove", noScroll, { passive: false });
  };
  return { down };
}
