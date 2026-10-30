// Selecting a note's text with the mouse (258), as text editors do. The page around the note can't be
// selected (user-select: none), so the browser's own selection stops following the mouse once it
// leaves the note's box; here, while the button is down, the selection follows the mouse anywhere on
// the page (held to the nearest point of the note's visible text). Past the top or bottom edge the note
// scrolls by itself, faster the further out the mouse is; a wheel scroll while selecting moves the
// selection's end at once to where the mouse now is; and pressing inside a selection to extend it
// never turns into dragging the selected text away.
import { useEffect } from "react";

/** px per frame to scroll a selection with the mouse at [y], the visible text between [top] and [bottom] (negative: up). */
export function mouseEdgeSpeed(y: number, top: number, bottom: number, zone = 20, most = 48): number {
  // Within [zone] of an edge: a slow creep; past it, faster the further out, up to [most].
  const over = y < top + zone ? y - (top + zone) : y > bottom - zone ? y - (bottom - zone) : 0;
  if (!over) return 0;
  const a = Math.abs(over);
  const v = a <= zone ? 1 + (a / zone) * 3 : 4 + (a - zone) * 0.35;
  return Math.sign(over) * Math.min(most, v);
}

/** [x, y] held inside [box] (1 px in from its edges), where the text under it can be found. */
export function clampToBox(x: number, y: number, box: { left: number; top: number; right: number; bottom: number }): [number, number] {
  const cx = Math.max(box.left + 1, Math.min(box.right - 1, x));
  const cy = Math.max(box.top + 1, Math.min(box.bottom - 1, y));
  return [cx, cy];
}

/** The caret position (node, offset) at a point on the page, or null. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  if (typeof d.caretRangeFromPoint === "function") {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  const p = d.caretPositionFromPoint?.(x, y);
  return p ? { node: p.offsetNode, offset: p.offset } : null;
}

/** Turns mouse selecting on for the editor [editor] that scrolls in [scroller]. */
export function useMouseSelect(editor: () => HTMLElement | null, scroller: () => HTMLElement | null) {
  useEffect(() => {
    let active = false, started = false;
    let anchor: { node: Node; offset: number } | null = null;
    let x0 = 0, y0 = 0, x = 0, y = 0, raf = 0;
    let host: HTMLElement | null = null;

    /** The part of the editor showing in the scroller. */
    const visible = () => {
      const ed = editor(), sc = scroller();
      if (!ed) return null;
      const e = ed.getBoundingClientRect();
      const s = sc ? sc.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      return { left: e.left, right: e.right, top: Math.max(e.top, s.top), bottom: Math.min(e.bottom, s.bottom), scrollTop: s.top, scrollBottom: s.bottom };
    };
    const follow = () => {
      const ed = editor(), v = visible();
      if (!ed || !v || !anchor || v.bottom <= v.top) return;
      const [cx, cy] = clampToBox(x, y, v);
      const c = caretAt(cx, cy);
      if (!c || !ed.contains(c.node)) return;
      const sel = getSelection();
      if (!sel) return;
      if (sel.anchorNode === anchor.node && sel.anchorOffset === anchor.offset && sel.focusNode === c.node && sel.focusOffset === c.offset) return;
      try { sel.setBaseAndExtent(anchor.node, anchor.offset, c.node, c.offset); } catch { /* a node gone meanwhile */ }
    };
    const tick = () => {
      raf = 0;
      if (!active || !started) return;
      const sc = scroller(), v = visible();
      if (sc && v) {
        const speed = mouseEdgeSpeed(y, v.scrollTop, v.scrollBottom);
        if (speed) {
          const before = sc.scrollTop;
          sc.scrollTop += speed;
          if (sc.scrollTop !== before) follow();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || e.detail > 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const ed = editor();
      if (!ed || !(e.target instanceof Node) || !ed.contains(e.target)) return;
      const sel = getSelection();
      // Shift-click extends the selection there is; a plain press starts one where it lands.
      anchor = e.shiftKey && sel?.anchorNode && ed.contains(sel.anchorNode) ? { node: sel.anchorNode, offset: sel.anchorOffset } : caretAt(e.clientX, e.clientY);
      if (!anchor || !ed.contains(anchor.node)) { anchor = null; return; }
      active = true;
      started = false;
      x0 = x = e.clientX;
      y0 = y = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!active || e.pointerType !== "mouse") return;
      if (!(e.buttons & 1)) { stop(); return; }
      x = e.clientX;
      y = e.clientY;
      if (!started && Math.hypot(x - x0, y - y0) < 3) return;
      started = true;
      follow();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const stop = () => { active = false; started = false; anchor = null; if (raf) cancelAnimationFrame(raf); raf = 0; };
    // A wheel scroll while selecting: the selection's end goes to the text now under the mouse.
    const onScroll = () => { if (active && started) follow(); };
    // Never a drag of the selected text: the press is selecting.
    const onDragStart = (e: DragEvent) => {
      const ed = editor();
      if (ed && e.target instanceof Node && ed.contains(e.target) && !(e.target instanceof HTMLImageElement)) e.preventDefault();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    window.addEventListener("blur", stop);
    document.addEventListener("dragstart", onDragStart, true);
    host = scroller();
    host?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      stop();
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
      window.removeEventListener("blur", stop);
      document.removeEventListener("dragstart", onDragStart, true);
      host?.removeEventListener("scroll", onScroll);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
