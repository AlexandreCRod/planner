// Which web link is under a point (or the caret) in the note editor and in a description box. A
// contenteditable's links are found by the text node under the point; a textarea has no text nodes,
// so its text is laid out again in a hidden copy and the links' boxes are measured there.
import { type WebLink, findLinks } from "../../domain/links.ts";

const inRects = (range: Range, x: number, y: number) =>
  [...range.getClientRects()].some((r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1);

type CaretDoc = Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };

/** The link under the point (x, y) in a contenteditable [root], if any. */
export function linkInEditable(root: HTMLElement, x: number, y: number): WebLink | null {
  const doc = document as CaretDoc;
  const pos = doc.caretPositionFromPoint?.(x, y);
  const range = pos ? null : document.caretRangeFromPoint?.(x, y);
  const node = pos?.offsetNode ?? range?.startContainer;
  const offset = pos?.offset ?? range?.startOffset ?? 0;
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;
  const t = node as Text;
  const hit = findLinks(t.data).find((l) => offset >= l.start && offset <= l.end);
  if (!hit) return null;
  const r = document.createRange();
  r.setStart(t, hit.start);
  r.setEnd(t, hit.end);
  return inRects(r, x, y) ? hit : null;
}

/** The link at the caret of a contenteditable [root] (for the keyboard), if any. */
export function linkAtCaretIn(root: HTMLElement): WebLink | null {
  const sel = getSelection();
  const n = sel?.anchorNode;
  if (!sel || !n || n.nodeType !== Node.TEXT_NODE || !root.contains(n)) return null;
  return findLinks((n as Text).data).find((l) => sel.anchorOffset >= l.start && sel.anchorOffset <= l.end) ?? null;
}

/** The link under the point (x, y) in a textarea, if any. */
export function linkInTextarea(ta: HTMLTextAreaElement, x: number, y: number): WebLink | null {
  const links = findLinks(ta.value);
  if (!links.length) return null;
  const box = ta.getBoundingClientRect();
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  for (const k of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "borderStyle", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "textIndent", "tabSize", "wordSpacing"] as const) {
    mirror.style[k] = cs[k];
  }
  Object.assign(mirror.style, { position: "fixed", left: `${box.left}px`, top: `${box.top - ta.scrollTop}px`, visibility: "hidden", pointerEvents: "none", whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
  const text = document.createTextNode(ta.value);
  mirror.appendChild(text);
  document.body.appendChild(mirror);
  try {
    for (const l of links) {
      const r = document.createRange();
      r.setStart(text, l.start);
      r.setEnd(text, l.end);
      if (inRects(r, x, y)) return l;
    }
  } finally {
    mirror.remove();
  }
  return null;
}

/** The link at the caret of a textarea (for the keyboard), if any. */
export function linkAtCaretOf(ta: HTMLTextAreaElement): WebLink | null {
  const p = ta.selectionStart ?? 0;
  return findLinks(ta.value).find((l) => p >= l.start && p <= l.end) ?? null;
}
