// Reordering a note's checklist like Google Keep: each checklist line gets a drag handle in the margin
// beside it (outside the text, so typing and selecting text are untouched). Drag a handle: the line
// (with the lines indented under it) lifts and follows the finger, the others in its list slide out of
// the way, and on release it settles into its new place. The note's text itself is what changes (its
// paragraphs move), so it's saved and synced like any edit. Which moves are allowed comes from
// domain/checklist.ts (tested in test/checklist.test.ts).
import { useEffect, useRef, useState } from "react";
import { checklistBlock, checklistDepth, checklistRun, checklistSlots } from "../../domain/checklist.ts";
import { MIcon } from "./chrome.tsx";
import { GLIDE_SPRING, animateSpring } from "./motion.ts";
import { hapticLift, hapticTick } from "./native.ts";

interface Handle { i: number; top: number; h: number }

const linesOf = (root: HTMLElement) => [...root.children] as HTMLElement[];

export function ChecklistHandles({ editor, host, onChange, onHas }: {
  /** The editable element; [host] is the box the handles are placed in (positioned). */
  editor: () => HTMLElement | null; host: () => HTMLElement | null; onChange: () => void; onHas: (has: boolean) => void;
}) {
  const [handles, setHandles] = useState<Handle[]>([]);
  const key = useRef("");
  const dragging = useRef(false);
  const remeasure = useRef<() => void>(() => {});
  const cb = useRef({ onChange, onHas });
  cb.current = { onChange, onHas };

  // Where the checklist lines are: measured (once a frame at most) after any change to the text or its size.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const root = editor(), box = host();
      if (!root || !box || dragging.current) return;
      const base = box.getBoundingClientRect().top;
      const out: Handle[] = [];
      linesOf(root).forEach((el, i) => {
        if (el.tagName !== "P" || checklistDepth(el.textContent ?? "") < 0) return;
        const r = el.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
        out.push({ i, top: r.top - base, h: Math.min(r.height, lh) });
      });
      const k = out.map((x) => `${x.i}:${Math.round(x.top)}:${Math.round(x.h)}`).join(",");
      if (k !== key.current) { key.current = k; setHandles(out); cb.current.onHas(out.length > 0); }
    };
    const later = () => { if (!raf) raf = requestAnimationFrame(measure); };
    remeasure.current = later;
    const mo = new MutationObserver(later);
    const ro = new ResizeObserver(later);
    let attached = false;
    const attach = () => {
      const root = editor(), box = host();
      if (!root || !box) return false;
      mo.observe(root, { childList: true, subtree: true, characterData: true });
      ro.observe(root);
      ro.observe(box);
      attached = true;
      later();
      return true;
    };
    const t = attach() ? 0 : window.setInterval(() => { if (attach()) clearInterval(t); }, 100);
    return () => { mo.disconnect(); ro.disconnect(); clearInterval(t); cancelAnimationFrame(raf); void attached; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (e: React.PointerEvent<HTMLButtonElement>, from: number) => {
    const root = editor();
    if (!root || e.button !== 0 || dragging.current) return;
    const lines = linesOf(root);
    const texts = lines.map((l) => l.textContent ?? "");
    const run = checklistRun(texts, from);
    if (!run) return;
    e.preventDefault();
    const handleEl = e.currentTarget;
    handleEl.setPointerCapture(e.pointerId);
    const [s, last] = checklistBlock(texts, from);
    const dragged = lines.slice(s, last + 1);
    const d = checklistDepth(texts[from]);
    const top0 = dragged[0].getBoundingClientRect().top;
    const h = dragged[dragged.length - 1].getBoundingClientRect().bottom - top0;
    // The run's other lines, in units that move together: a line and the deeper lines under it.
    const units: { els: HTMLElement[]; first: number; top: number; h: number; above: boolean }[] = [];
    for (let i = run[0]; i <= run[1]; i++) {
      if (i >= s && i <= last) continue;
      const el = lines[i];
      const r = el.getBoundingClientRect();
      const prev = units[units.length - 1];
      if (!prev || checklistDepth(texts[i]) <= d || prev.above !== i < s) units.push({ els: [el], first: i, top: r.top, h: r.height, above: i < s });
      else { prev.els.push(el); prev.h = r.bottom - prev.top; }
    }
    const n = dragged.length;
    // Each unit's place once the dragged lines are lifted out (those below move up by h).
    const restTop = units.map((u) => (u.above ? u.top : u.top - h));
    const allowed = new Set(checklistSlots(texts, from));
    // A drop before unit k means landing before this line of the text without the dragged lines.
    const slotOf = (k: number) => (k < units.length ? (units[k].above ? units[k].first : units[k].first - n) : run[1] + 1 - n);
    const k0 = units.filter((u) => u.above).length;
    const minDy = (units.length ? Math.min(top0, ...restTop) : top0) - top0 - 6;
    const maxDy = (units.length ? Math.max(top0 + h, ...units.map((u, i) => restTop[i] + u.h + h)) : top0 + h) - top0 - h + 6;
    const y0 = e.clientY;
    let k = k0, raf = 0, dy = 0;
    dragging.current = true;
    hapticLift();
    for (const el of dragged) el.classList.add("pn-lifted");
    for (const u of units) for (const el of u.els) el.classList.add("pn-sliding");
    const draw = () => {
      raf = 0;
      for (const el of dragged) el.style.transform = `translate3d(0,${dy}px,0)`;
      const c = top0 + dy + h / 2;
      let nk = 0;
      while (nk < units.length && restTop[nk] + units[nk].h / 2 < c) nk++;
      // Only where the line may go (never between another line and its sub-items).
      while (nk > 0 && !allowed.has(slotOf(nk))) nk--;
      if (nk !== k) { k = nk; hapticTick(); }
      units.forEach((u, ui) => {
        const shift = u.above ? (ui >= k ? h : 0) : (ui < k ? -h : 0);
        for (const el of u.els) el.style.transform = shift ? `translate3d(0,${shift}px,0)` : "";
      });
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      dy = Math.max(minDy, Math.min(maxDy, ev.clientY - y0));
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      handleEl.removeEventListener("pointermove", move);
      handleEl.removeEventListener("pointerup", up);
      handleEl.removeEventListener("pointercancel", up);
      cancelAnimationFrame(raf);
      draw();
      const shownTop = dragged[0].getBoundingClientRect().top;
      const moved = k !== k0;
      // The paragraphs move in the text; the others are then exactly where they were drawn.
      for (const u of units) for (const el of u.els) { el.classList.remove("pn-sliding"); el.style.transform = ""; }
      for (const el of dragged) el.style.transform = "";
      if (moved) {
        if (k < units.length) units[k].els[0].before(...dragged);
        else { const lu = units[units.length - 1]; lu.els[lu.els.length - 1].after(...dragged); }
      }
      // The lifted line glides the rest of the way into its place.
      const off = shownTop - dragged[0].getBoundingClientRect().top;
      const settle = (x: number) => { for (const el of dragged) el.style.transform = Math.abs(x) > 0.05 ? `translate3d(0,${x}px,0)` : ""; };
      settle(off);
      animateSpring(off, 0, 0, settle, () => {
        for (const el of dragged) el.classList.remove("pn-lifted");
        dragging.current = false;
        key.current = "";
        remeasure.current();
        if (moved) cb.current.onChange();
      }, GLIDE_SPRING);
    };
    handleEl.addEventListener("pointermove", move);
    handleEl.addEventListener("pointerup", up);
    handleEl.addEventListener("pointercancel", up);
  };

  if (!handles.length) return null;
  return (
    <div className="pn-handles">
      {handles.map((x) => (
        <button key={x.i} className="pn-handle" style={{ top: x.top + x.h / 2 - 16 }} aria-label="Drag to reorder" tabIndex={-1}
          onPointerDown={(e) => start(e, x.i)} onContextMenu={(e) => e.preventDefault()}>
          <MIcon name="fDragIndicator" size={18} />
        </button>
      ))}
    </div>
  );
}
