// Where writing stopped: once the keyboard is put away, the note's text keeps the focus, and this steady
// mark sits where the cursor is (the cursor itself blinks, and is easy to lose), until the text loses
// the focus (a tap outside it, or leaving the note). A tap on the text brings the keyboard back there.
import { useEffect, useState } from "react";

export function CaretMarker({ editor, host, show }: { editor: () => HTMLElement | null; host: () => HTMLElement | null; show: boolean }) {
  const [at, setAt] = useState<{ x: number; y: number; h: number } | null>(null);
  useEffect(() => {
    if (!show) { setAt(null); return; }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const root = editor(), box = host(), sel = getSelection();
      if (!root || !box || !sel || !sel.focusNode || !root.contains(sel.focusNode)) { setAt(null); return; }
      const r = document.createRange();
      r.setStart(sel.focusNode, sel.focusOffset);
      r.collapse(true);
      const rects = r.getClientRects();
      let rect: DOMRect | null = rects.length ? rects[rects.length - 1] : null;
      // An empty line has no box of its own: its element's then.
      if (!rect || (!rect.height && !rect.top)) {
        const el = sel.focusNode instanceof Element ? sel.focusNode : sel.focusNode.parentElement;
        rect = el?.getBoundingClientRect() ?? null;
        if (rect) rect = new DOMRect(rect.left, rect.top, 0, Math.min(rect.height, 24));
      }
      if (!rect) { setAt(null); return; }
      const b = box.getBoundingClientRect();
      setAt({ x: Math.round(rect.left - b.left), y: Math.round(rect.top - b.top), h: Math.round(rect.height || 24) });
    };
    const later = () => { if (!raf) raf = requestAnimationFrame(measure); };
    later();
    document.addEventListener("selectionchange", later);
    window.addEventListener("resize", later);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("selectionchange", later); window.removeEventListener("resize", later); };
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!show || !at) return null;
  return <span className="pn-caretmark" aria-hidden="true" style={{ transform: `translate(${at.x - 1}px, ${at.y}px)`, height: at.h }} />;
}
