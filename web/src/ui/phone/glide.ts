// Rows that glide to their new places when a list changes (FLIP): each row marked data-glide="key"
// is measured after every redraw; one that moved starts where it was and slides to where it is now.
// A row that left the list glides off towards the element marked data-glide-into (the collapsed
// Completed header) and fades there, drawn by a copy of it on a layer of its own. Only transforms and
// opacity are animated, on the compositor. A redraw for a row dropped by a drag is only measured.
import { type RefObject, useLayoutEffect, useRef } from "react";

const EASE = "cubic-bezier(0.2, 0, 0, 1)"; // Material's emphasised decelerate
const MOVE_MS = 340;

/**
 * Glides the marked rows inside [box] (which must be position: relative) to their new places after
 * each redraw. [layer] is an empty element inside it, never given children by React, for the rows
 * that leave. Only rows [goneInto] says went there glide off (a deleted row just goes).
 */
export function useGlide(box: RefObject<HTMLElement | null>, layer: RefObject<HTMLElement | null>, goneInto: (key: string) => boolean) {
  const last = useRef(new Map<string, { top: number; left: number; h: number; w: number; el: HTMLElement }>());
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const prev = last.current;
    const next = new Map<string, { top: number; left: number; h: number; w: number; el: HTMLElement }>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-glide]")) {
      next.set(el.dataset.glide!, { top: el.offsetTop, left: el.offsetLeft, h: el.offsetHeight, w: el.offsetWidth, el });
    }
    last.current = next;
    // A row drag (rowDrag.ts) has put the rows where they go itself ([data-reorder] on the box).
    if (!prev.size || root.dataset.reorder !== undefined || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [k, n] of next) {
      const p = prev.get(k);
      if (!p) continue;
      const dy = p.top - n.top;
      if (Math.abs(dy) < 0.5) continue;
      n.el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: MOVE_MS, easing: EASE });
    }
    const into = root.querySelector<HTMLElement>("[data-glide-into]");
    const host = layer.current;
    if (!host || !into) return;
    for (const [k, p] of prev) {
      if (next.has(k) || !goneInto(k)) continue;
      // Gone from the list: a copy of the row as it was glides into the header and fades.
      const ghost = p.el.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-glide");
      // A copy takes the attributes only: the tick is the box's live state.
      const boxes = p.el.querySelectorAll("input"), copies = ghost.querySelectorAll("input");
      boxes.forEach((b, i) => { if (copies[i]) copies[i].checked = b.checked; });
      Object.assign(ghost.style, { position: "absolute", top: `${p.top}px`, left: `${p.left}px`, width: `${p.w}px`, height: `${p.h}px`, margin: "0", pointerEvents: "none", zIndex: "1" });
      host.appendChild(ghost);
      const dy = into.offsetTop + into.offsetHeight / 2 - (p.top + p.h / 2);
      const a = ghost.animate([
        { transform: "none", opacity: 1 },
        { transform: `translateY(${dy}px) scale(0.94)`, opacity: 0 },
      ], { duration: MOVE_MS + 60, easing: EASE, fill: "forwards" });
      a.onfinish = a.oncancel = () => ghost.remove();
    }
  });
}
