// Gentle scrolling while text is being selected. Dragging a selection (a long-press drag or a handle)
// towards the top or bottom of a note or field makes the WebView scroll the selection's end into
// view; each scroll slides more text under the finger, the selection grows, and it scrolls again, so
// the page could race away. Here, while a selection is changing, the scroller holding it may move only
// so fast: slowly while the selection's end is well inside it, a little faster as it nears the edge,
// like dragging a selection in an ordinary Android text field. The page gets no touch events during
// such a drag (the browser takes the finger), so the selection's end stands in for the finger.
// Scrolling a page that merely has a selection in it is untouched: the selection isn't changing.

/** px/ms a selection drag may scroll, with its end [depth] into the edge zone (0 outside, 1 at the edge). */
export function selectScrollSpeed(depth: number): number {
  const d = Math.max(0, Math.min(1.25, depth));
  return 0.06 + 0.42 * d * d;
}

/** Where a scroller that went from [last] to [next] in [dt] ms may be, at [speed] px/ms at most. */
export function limitScroll(last: number, next: number, dt: number, speed: number): number {
  const most = speed * Math.max(4, Math.min(50, dt));
  return Math.max(last - most, Math.min(last + most, next));
}

/** px per frame to scroll while a finger dragging at [y] is near the [top] or [bottom] edge (negative: up). */
export function edgeSpeed(y: number, top: number, bottom: number, zone = 72, most = 16): number {
  const d = y < top + zone ? -(top + zone - y) / zone : y > bottom - zone ? (y - (bottom - zone)) / zone : 0;
  const m = Math.min(1, Math.abs(d));
  return Math.sign(d) * most * m * m;
}

/** The edge zone's height, px. */
const ZONE = 56;
/** How long after the selection last changed a drag counts as still going, ms. */
const ACTIVE_MS = 250;

let lastChange = -1e9;
const seen = new WeakMap<Element, { top: number; left: number; t: number }>();

function selectionEnd(): { node: Node; rect: DOMRect | null; field: HTMLInputElement | HTMLTextAreaElement | null } | null {
  const a = document.activeElement;
  if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) {
    try {
      if (a.selectionStart !== null && a.selectionStart !== a.selectionEnd) return { node: a, rect: null, field: a };
    } catch { /* inputs without a selection */ }
  }
  const s = document.getSelection();
  if (!s || s.isCollapsed || !s.focusNode) return null;
  let rect: DOMRect | null = null;
  try {
    const r = document.createRange();
    r.setStart(s.focusNode, s.focusOffset);
    r.collapse(true);
    const rs = r.getClientRects();
    rect = rs.length ? rs[rs.length - 1] : r.getBoundingClientRect();
    if (rect && rect.width === 0 && rect.height === 0 && rect.top === 0) rect = null;
  } catch { rect = null; }
  return { node: s.focusNode, rect, field: null };
}

/** How far the selection's end is into [el]'s edge zone, the way [dir] scrolls (1: down, −1: up). */
function depthIn(el: Element, rect: DOMRect | null, dir: number): number {
  if (!rect) return 1; // unknown (a field's own text): allow the edge speed
  const box = el.getBoundingClientRect();
  const vv = window.visualViewport;
  const bottom = Math.min(box.bottom, vv ? vv.offsetTop + vv.height : innerHeight);
  const top = Math.max(box.top, vv ? vv.offsetTop : 0);
  return dir > 0 ? (rect.bottom - (bottom - ZONE)) / ZONE : ((top + ZONE) - rect.top) / ZONE;
}

/** A scroller still gliding to where the browser wanted it, at the allowed speed. */
interface Glide { top: number; left: number; speed: number; raf: number; t: number }
const glides = new WeakMap<Element, Glide>();

function stopGlide(el: Element) {
  const g = glides.get(el);
  if (g) { cancelAnimationFrame(g.raf); glides.delete(el); }
}

function glide(el: Element, top: number, left: number, speed: number, now: number) {
  let g = glides.get(el);
  if (g) { g.top = top; g.left = left; g.speed = speed; return; }
  g = { top, left, speed, raf: 0, t: now };
  glides.set(el, g);
  const frame = (t: number) => {
    const cur = glides.get(el);
    if (cur !== g) return;
    const dt = t - g.t;
    g.t = t;
    const at = seen.get(el) ?? { top: el.scrollTop, left: el.scrollLeft };
    // Moved by something else meanwhile: a finger scrolling once the selection is done wins.
    if ((el.scrollTop !== at.top || el.scrollLeft !== at.left) && performance.now() - lastChange > ACTIVE_MS) { glides.delete(el); return; }
    // Faster as the selection's end nears the edge it's heading for.
    const end = selectionEnd();
    if (end && g.top !== at.top) g.speed = selectScrollSpeed(depthIn(el, end.rect, Math.sign(g.top - at.top)));
    const y = limitScroll(at.top, g.top, dt, g.speed);
    const x = limitScroll(at.left, g.left, dt, g.speed);
    el.scrollTop = y;
    el.scrollLeft = x;
    seen.set(el, { top: el.scrollTop, left: el.scrollLeft, t: performance.now() });
    if (Math.abs(y - g.top) < 0.5 && Math.abs(x - g.left) < 0.5) { glides.delete(el); return; }
    g.raf = requestAnimationFrame(frame);
  };
  g.raf = requestAnimationFrame(frame);
}

function onScroll(e: Event) {
  const el = e.target === document ? document.scrollingElement : e.target;
  if (!(el instanceof Element)) return;
  const now = performance.now();
  const prev = seen.get(el);
  const top = el.scrollTop, left = el.scrollLeft;
  if (prev && top === prev.top && left === prev.left) return; // our own glide
  seen.set(el, { top, left, t: now });
  const end = prev && now - lastChange <= ACTIVE_MS ? selectionEnd() : null;
  if (!prev || !end || !(end.field === el || el.contains(end.node))) { stopGlide(el); return; }
  // The browser moved it to reveal the selection's end: it gets there, but at a gentle pace.
  const dt = now - prev.t;
  const speed = selectScrollSpeed(top !== prev.top ? depthIn(el, end.rect, Math.sign(top - prev.top)) : 1);
  const nTop = limitScroll(prev.top, top, dt, speed);
  const nLeft = limitScroll(prev.left, left, dt, speed);
  if (nTop === top && nLeft === left) return;
  el.scrollTop = nTop;
  el.scrollLeft = nLeft;
  seen.set(el, { top: el.scrollTop, left: el.scrollLeft, t: now });
  glide(el, top, left, speed, now);
}

let started = false;
/** Turns the gentle selection scrolling on (phone layout, once). */
export function startSelectScroll() {
  if (started) return;
  started = true;
  document.addEventListener("selectionchange", () => {
    lastChange = performance.now();
    // Know where the scrollers holding the selection are, so even their first move is held in.
    const end = selectionEnd();
    let n: Node | null = end?.node ?? null;
    for (; n; n = n.parentNode) {
      if (n instanceof Element && !seen.has(n) && (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth)) {
        seen.set(n, { top: n.scrollTop, left: n.scrollLeft, t: lastChange });
      }
    }
  }, { passive: true });
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
}
