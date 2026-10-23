// The text selection's toolbar (Cut / Copy / Paste) is Android's own, drawn by the WebView. Two things
// help it here:
// - Where it goes: the page tells the app where its selection is (device.ts selectionRect), so the
//   toolbar sits right above the selected text (android/.../device/PlannerWebView.kt), not off over
//   the top bar.
// - Cut and Paste are only offered for text the WebView sees as being edited: a selection made in a
//   note's text while it didn't have the focus gives the text the focus (the selection kept), so the
//   toolbar has Cut and Paste as in any text field.
import { setSelectionRect } from "./device.ts";

/** The box around a selection's lines, in CSS px from the page's top left; null when it has none. */
export function selectionBox(rects: { left: number; top: number; right: number; bottom: number; width: number; height: number }[]):
  { left: number; top: number; right: number; bottom: number } | null {
  const rs = rects.filter((r) => r.width > 0 || r.height > 0);
  if (!rs.length) return null;
  return {
    left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)),
    right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)),
  };
}

let started = false;
let sent = "";
export function startSelectionBar() {
  if (started) return;
  started = true;
  let raf = 0;
  const report = () => {
    raf = 0;
    const sel = document.getSelection();
    const range = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
    const box = range ? selectionBox([...range.getClientRects()]) : null;
    // CSS px → the WebView's own pixels (as seen through any zoom).
    const vv = window.visualViewport;
    const k = (window.devicePixelRatio || 1) * (vv?.scale ?? 1);
    const ox = vv?.offsetLeft ?? 0, oy = vv?.offsetTop ?? 0;
    const px = box && { left: Math.round((box.left - ox) * k), top: Math.round((box.top - oy) * k), right: Math.round((box.right - ox) * k), bottom: Math.round((box.bottom - oy) * k) };
    const key = px ? `${px.left},${px.top},${px.right},${px.bottom}` : "";
    if (key === sent) return;
    sent = key;
    setSelectionRect(px);
  };
  const later = () => { if (!raf) raf = requestAnimationFrame(report); };
  document.addEventListener("selectionchange", () => { focusSelectedText(); later(); }, { passive: true });
  document.addEventListener("scroll", () => { if (sent) later(); }, { capture: true, passive: true });
  window.visualViewport?.addEventListener("resize", () => { if (sent) later(); });
}

/** A selection inside editable text that hasn't got the focus: the text takes it, the selection kept. */
function focusSelectedText() {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const n = sel.anchorNode;
  const el = (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[contenteditable='true'], [contenteditable='']");
  if (!el || el === document.activeElement || el.contains(document.activeElement)) return;
  const range = sel.getRangeAt(0).cloneRange();
  const forward = sel.anchorNode === range.startContainer && sel.anchorOffset === range.startOffset;
  el.focus({ preventScroll: true });
  sel.removeAllRanges();
  if (forward) sel.addRange(range);
  else sel.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
}
