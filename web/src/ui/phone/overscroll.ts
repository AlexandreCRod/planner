// Rubber-band edges for the phone's scrolling pages (lists, Today, the calendar's hours...). Scrolling
// itself stays the browser's own (native momentum, compositor-driven); only what happens past an end
// is drawn here:
// - a finger pulling past the top or bottom moves the page by a rubber band (motion.ts) and, let go,
//   it springs back carrying the finger's speed;
// - a fling that runs into an end carries on a little past it and springs back.
// The page moves with a transform, clipped to its own box (clip-path), so nothing around it shifts.
// Text selection, fields and the note editor are left alone, and so is anything with two fingers.
import { EDGE_SPRING, VelocityTracker, animateSpring, frameWriter, rubberBand, rubberBandInverse, type Animation } from "./motion.ts";
import { TOUCH_SLOP } from "./press.ts";

/** The pages that get rubber-band edges. */
const SCROLLERS = ".p-content:not(.flush), .p-list, .pg-scroll, .p-dayagenda, .p-agenda, .pa-scroll, .p-yearview";
/** Where a touch never starts a pull: fields, the note editor's text, and anything with its own drag. */
const SKIP = "input, textarea, select, [contenteditable]:not([contenteditable=false]), .pg-block.lifted, .p-graph, .pn-handle, .tw-drum";
/** A fling's bounce: its speed into the end is scaled by this, up to MAX_FLING px/ms. */
const FLING_SCALE = 0.45;
const MAX_FLING = 3;

/**
 * How an edge gives: [dim] the most it can show (as a share of the page's height), [c] how much of the
 * finger's pull shows at first, [fling] how much of a fling's speed carries past the end. The calendar's
 * edges give about half as much as a list's (its grid is a fixed thing), and settle a little quicker.
 */
interface Edge { dim: number; c: number; fling: number; spring: typeof EDGE_SPRING }
const SOFT: Edge = { dim: 1, c: 0.55, fling: FLING_SCALE, spring: EDGE_SPRING };
const CALENDAR: Edge = { dim: 0.5, c: 0.4, fling: 0.25, spring: { stiffness: 600, damping: 1 } };

interface Band { el: HTMLElement; shown: number; anim: Animation | null; write: ReturnType<typeof frameWriter<number>>; edge: Edge }
const bands = new WeakMap<HTMLElement, Band>();

function bandOf(el: HTMLElement): Band {
  let b = bands.get(el);
  if (!b) {
    const band: Band = { el, shown: 0, anim: null, write: frameWriter<number>((v) => draw(band, v)), edge: el.closest(".p-cal") ? CALENDAR : SOFT };
    bands.set(el, band);
    b = band;
  }
  return b;
}

/** Shows the page [v] px past its end (positive: pulled down at the top). */
function draw(b: Band, v: number) {
  b.shown = v;
  const s = b.el.style;
  if (Math.abs(v) < 0.05) {
    b.shown = 0;
    s.transform = ""; s.clipPath = ""; s.willChange = "";
    return;
  }
  s.willChange = "transform";
  s.transform = `translate3d(0,${v}px,0)`;
  s.clipPath = v > 0 ? `inset(0 0 ${v}px 0)` : `inset(${-v}px 0 0 0)`;
}

/** Springs the page back from where it is, starting at [v] px/ms. */
function release(b: Band, v: number) {
  b.write.cancel();
  b.anim?.stop();
  b.anim = animateSpring(b.shown, 0, v, (x) => draw(b, x), () => { b.anim = null; draw(b, 0); }, b.edge.spring);
}
const band = (b: Band, over: number) => rubberBand(over, b.el.clientHeight * b.edge.dim, b.edge.c);
const bandInverse = (b: Band, shown: number) => rubberBandInverse(shown, b.el.clientHeight * b.edge.dim, b.edge.c);

const maxTop = (el: HTMLElement) => Math.max(0, el.scrollHeight - el.clientHeight);
const atTop = (el: HTMLElement) => el.scrollTop <= 0.5;
const atBottom = (el: HTMLElement) => el.scrollTop >= maxTop(el) - 1;

/** Text is being selected (a selection handle drag must scroll natively and gently). */
function selecting(): boolean {
  const sel = document.getSelection();
  return !!sel && !sel.isCollapsed && sel.rangeCount > 0;
}

interface Touch { el: HTMLElement; id: number; x0: number; y0: number; decided: boolean; pull: boolean; base: number; from: number; vt: VelocityTracker; sign: 1 | -1 }
let touch: Touch | null = null;
let fingers = 0;
/** A held number turning a time wheel (TimeWheel.tsx) has the finger: no pull meanwhile. */
let suspended = false;
export function suspendOverscroll(on: boolean) {
  suspended = on;
  const t = touch;
  if (on && t) { touch = null; if (t.pull) release(bandOf(t.el), 0); }
}
let lastTouchEnd = 0;

function onStart(e: TouchEvent) {
  fingers = e.touches.length;
  if (touch && e.touches.length > 1) { endTouch(0); return; }
  if (e.touches.length !== 1) return;
  const t = e.target as Element | null;
  if (!t || !document.documentElement.classList.contains("phone") || t.closest(SKIP) || selecting()) return;
  const el = t.closest<HTMLElement>(SCROLLERS);
  if (!el) return;
  const p = e.touches[0];
  const b = bands.get(el);
  // A finger landing on a page still springing back catches it where it is.
  if (b?.anim) { b.anim.stop(); b.anim = null; }
  touch = { el, id: p.identifier, x0: p.clientX, y0: p.clientY, decided: false, pull: false, base: 0, from: b?.shown ?? 0, vt: new VelocityTracker(), sign: 1 };
  touch.vt.add(e.timeStamp, p.clientY);
}

function onMove(e: TouchEvent) {
  const t = touch;
  if (!t) return;
  if (suspended) { touch = null; if (t.pull) release(bandOf(t.el), 0); return; }
  if (e.touches.length > 1) { endTouch(0); return; }
  const p = [...e.touches].find((x) => x.identifier === t.id);
  if (!p) return;
  t.vt.add(e.timeStamp, p.clientY);
  const dy = p.clientY - t.y0, dx = p.clientX - t.x0;
  if (!t.decided) {
    if (Math.abs(dx) <= TOUCH_SLOP && Math.abs(dy) <= TOUCH_SLOP && !t.from) {
      // Within the slop, a move towards an end the page is already at is held back from the browser,
      // which would otherwise start its own (empty) scroll and stop letting these be cancelled.
      if (e.cancelable && dy && Math.abs(dy) >= Math.abs(dx) && (dy > 0 ? atTop(t.el) : atBottom(t.el)) && !selecting()) e.preventDefault();
      return;
    }
    t.decided = true;
    if (selecting() || (Math.abs(dx) > Math.abs(dy) && !t.from)) { touch = null; return; }
    const el = t.el;
    const down = t.from ? t.from > 0 : dy > 0;
    // Only a pull past an end is ours; anything else scrolls as ever.
    if (!(down ? atTop(el) : atBottom(el)) || !e.cancelable) {
      if (t.from) release(bandOf(el), 0);
      touch = null;
      return;
    }
    t.pull = true;
    t.sign = down ? 1 : -1;
    t.base = p.clientY - bandInverse(bandOf(el), t.from);
  }
  if (!t.pull) return;
  const over = p.clientY - t.base;
  const b = bandOf(t.el);
  if (over * t.sign >= 0) {
    if (e.cancelable) e.preventDefault();
    b.write(band(b, over));
  } else {
    // Back past where the pull began: the page is the browser's to scroll again.
    b.write.cancel();
    draw(b, 0);
    touch = null;
  }
}

function endTouch(v: number) {
  const t = touch;
  touch = null;
  if (!t || !t.pull) return;
  const b = bandOf(t.el);
  b.write.flush();
  if (b.shown) {
    // The band's own speed: the finger's, geared down by how stretched it is.
    const dim = t.el.clientHeight * b.edge.dim, c = b.edge.c;
    const over = bandInverse(b, b.shown);
    const gear = c / Math.pow((Math.abs(over) * c) / dim + 1, 2);
    release(b, v * gear);
  }
}

function onEnd(e: TouchEvent) {
  fingers = e.touches.length;
  lastTouchEnd = performance.now();
  const t = touch;
  if (!t) return;
  if ([...e.touches].some((x) => x.identifier === t.id)) return;
  endTouch(e.type === "touchcancel" ? 0 : t.vt.velocity(e.timeStamp));
}

// ----- Flings into an end -----
const last = new WeakMap<HTMLElement, { top: number; t: number; v: number }>();
function onScroll(e: Event) {
  const el = e.target;
  if (!(el instanceof HTMLElement) || !el.matches(SCROLLERS)) return;
  const now = performance.now(), top = el.scrollTop;
  const prev = last.get(el);
  let v = 0;
  if (prev && now > prev.t) v = prev.v * 0.3 + 0.7 * ((top - prev.top) / (now - prev.t));
  last.set(el, { top, t: now, v });
  // Only a fling (no finger down, let go a moment ago) bounces, not a programmatic scroll.
  if (fingers || now - lastTouchEnd > 2500 || !prev || now - prev.t > 100) return;
  const hit = (v < -0.2 && atTop(el)) || (v > 0.2 && atBottom(el));
  if (!hit) return;
  const b = bandOf(el);
  if (b.anim || b.shown) return;
  // Scrolling up into the top moves the content down, so the band goes positive.
  const speed = Math.max(-MAX_FLING, Math.min(MAX_FLING, -v)) * b.edge.fling;
  last.delete(el);
  b.anim = animateSpring(0, 0, speed, (x) => draw(b, x), () => { b.anim = null; draw(b, 0); }, b.edge.spring);
}

let started = false;
/** Turns the rubber-band edges on for the phone layout (once). */
export function startOverscroll() {
  if (started) return;
  started = true;
  document.addEventListener("touchstart", onStart, { capture: true, passive: true });
  // Not passive: a pull past an end must keep the browser from starting its own scroll. The work
  // done here before deciding is a few comparisons, so a scroll's start never waits on much.
  document.addEventListener("touchmove", onMove, { capture: true, passive: false });
  document.addEventListener("touchend", onEnd, { capture: true, passive: true });
  document.addEventListener("touchcancel", onEnd, { capture: true, passive: true });
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
}
