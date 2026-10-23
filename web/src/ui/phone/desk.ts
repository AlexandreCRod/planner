// The phone screens with a mouse, a trackpad and a keyboard (the PC, or any browser window). Each
// gesture's equivalent sits beside the gesture itself; what's shared is here: the keys (keys.ts says
// which does what), the pagers that ← → and a sideways trackpad swipe turn, and telling a mouse's
// right-click (which stands in for a long press) from a touch's long press.
// (Nothing here imports the platform or Capacitor: the pagers bring it into the tests.)
import { WheelPager, deskAction, typingTarget } from "./keys.ts";

// ---------- Pagers ----------

interface Pager { el: HTMLElement; step: (dir: 1 | -1) => void }
const pagers = new Set<Pager>();

/** Whether a box between [t] and [root] scrolls sideways itself (a chip row): its wheel is its own. */
function scrollsSideways(t: Element, root: Element): boolean {
  for (let n: Element | null = t; n && n !== root; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const o = getComputedStyle(n).overflowX;
      if (o === "auto" || o === "scroll") return true;
    }
  }
  return false;
}

/**
 * The pager the arrow keys turn: the biggest one on screen that nothing covers at its middle (so a
 * dialog's own pager, while one is open, and never a page slid out of sight).
 */
function pagerInView(): Pager | null {
  let best: Pager | null = null, area = 0;
  for (const p of pagers) {
    if (!p.el.isConnected) continue;
    const r = p.el.getBoundingClientRect();
    const a = r.width * r.height;
    if (a <= area || r.width < 40 || r.height < 40) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && p.el.contains(hit)) { best = p; area = a; }
  }
  return best;
}

/**
 * Makes [el] a pager for the mouse and keyboard: ← and → turn it while it's the one in view, and a
 * sideways trackpad swipe (or Shift+wheel) over it turns one page; a row inside that scrolls sideways
 * keeps its own, as does anything [allow] turns down. [step] turns one page with the pager's own slide.
 * Returns the undo.
 */
export function deskPager(el: HTMLElement, step: (dir: 1 | -1) => void, allow?: (t: Element) => boolean): () => void {
  const p: Pager = { el, step };
  pagers.add(p);
  const wheel = new WheelPager();
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return; // a zoom
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (Math.abs(dx) > Math.abs(dy)) {
      const t = e.target instanceof Element ? e.target : null;
      if (t && (scrollsSideways(t, el) || (allow && !allow(t)))) return;
      // Not the browser's: it would go back a page in its history.
      if (e.cancelable) e.preventDefault();
    }
    const dir = wheel.feed(dx, dy, e.timeStamp);
    if (dir) step(dir);
  };
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => { pagers.delete(p); el.removeEventListener("wheel", onWheel); };
}

// ---------- Right-click ----------

let lastPointer = "";

/**
 * A right-click with a mouse or pen, which opens what a long press opens. (A long press on a touch
 * screen sends the same contextmenu event, but the long press itself has already acted.)
 */
export const mouseMenu = (e: { button: number }) => e.button === 2 && lastPointer !== "touch";

/** The pointer last pressed was a mouse: drags start as soon as it moves, with no long press first. */
export const isMouse = (e: { pointerType: string }) => e.pointerType === "mouse";

// ---------- Keys ----------

export interface DeskHandlers {
  /** Esc with nothing open over the page: a full-screen page closes. True when something did. */
  back: () => boolean;
  /** N: what the + button adds on the page in view. */
  add: () => void;
  /** T: the page's "today". */
  today: () => void;
  /** Ctrl+F outside a note: the app's search. */
  find: () => void;
}
let handlers: DeskHandlers | null = null;
export function setDeskHandlers(h: DeskHandlers | null) { handlers = h; }

let noteFind: (() => void) | null = null;
/** Ctrl+F while a note is open: its own find bar. Returns the undo. */
export function setNoteFind(fn: () => void): () => void {
  noteFind = fn;
  return () => { if (noteFind === fn) noteFind = null; };
}

/** The back stack (native.ts): whether something open takes the next back, and closing the newest. */
let back = { pending: () => false, closeTop: () => false };

function onKey(e: KeyboardEvent) {
  const a = deskAction(e, typingTarget(e.target instanceof HTMLElement ? e.target : null));
  if (!a) return;
  if (a === "back") {
    if (back.closeTop() || handlers?.back()) e.preventDefault();
    return;
  }
  if (a === "find") {
    e.preventDefault(); // not the browser's own find
    if (noteFind) noteFind(); else handlers?.find();
    return;
  }
  if (a === "prev" || a === "next") {
    const p = pagerInView();
    if (p) { e.preventDefault(); p.step(a === "next" ? 1 : -1); }
    return;
  }
  // N and T wait while a sheet, dialog, menu or selection is open.
  if (back.pending() || e.repeat) return;
  e.preventDefault();
  if (a === "add") handlers?.add();
  else handlers?.today();
}

let started = false;
/**
 * Listens for the keys (in a browser; the phone build has no keyboard to speak of) and the pointer
 * kind. [backStack]: the back button's stack, which Esc closes the newest of.
 */
export function startDesk(backStack: typeof back, native: boolean) {
  if (started) return;
  started = true;
  back = backStack;
  document.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType; }, { capture: true, passive: true });
  // Before the page's own handlers: a dialog keeps its keys from the page under it, but not Esc from us.
  if (!native) window.addEventListener("keydown", onKey, { capture: true });
}
