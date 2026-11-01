// Where the tab pages are. A settle is handed to the compositor as a list of places (the same spring the
// fingers get, motion.ts), so it plays without the page's script; everything else (a finger, a tap) is
// written straight to the styles, with no React render while the pages move.
import { PAGE_SPRING, springAt, springFrames } from "./motion.ts";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The pager's offset (down the side rail, [axis] Y, for its indicator). While it moves it's a 3D
 * translate (its own GPU layer, cheap to slide); at rest it's a plain 2D one, or none, so what's in it is
 * painted straight onto the screen at whole pixels. (A layer left in place gets resampled at
 * fractional offsets, which is what made text look soft.) Moving means the whole drag or settle, not
 * just a fractional offset: a fast slide reaching the first or last page mustn't drop the layer and
 * build it again mid-gesture, which repainted the pages with a flicker.
 */
const slide = (p: number, sign: number, moving: boolean, axis: "X" | "Y" = "X") => !moving
  ? (p ? `translate${axis}(${sign * p * 100}%)` : "none")
  : axis === "X" ? `translate3d(${sign * p * 100}%,0,0)` : `translate3d(0,${sign * p * 100}%,0)`;
/** The same in px, as a compositor animation needs: percentages depend on the box, which keeps it on the main thread. */
const slidePx = (x: number, axis: "X" | "Y") => (axis === "X" ? `translate3d(${x}px,0,0)` : `translate3d(0,${x}px,0)`);

/**
 * Runs [fn] once the next frame is out, so what a tap changes is on screen first. A page that isn't
 * drawing (the app in the background) gets no frames: the timer sees to it then.
 */
export function afterFrame(fn: () => void) {
  let ran = false;
  const once = () => { if (ran) return; ran = true; fn(); };
  requestAnimationFrame(() => setTimeout(once));
  setTimeout(once, 100);
}

/** The moment a settle reaches the next tab's mark: the first place past 0.6 of a page from [shown] on the way to [to]. */
export function shownChangesAt(xs: number[], w: number, shown: number, to: number, stepMs: number): number | null {
  if (to === shown) return null;
  const i = xs.findIndex((x) => Math.abs(x / w - shown) > 0.6 && Math.round(x / w) !== shown);
  return i < 0 ? null : i * stepMs;
}

interface Settling { anims: Animation[]; d0: number; vs: number; to: number; w: number; timer: ReturnType<typeof setTimeout> | undefined }

/**
 * Where the pages are (in pages, fractional while moving), written straight to the track and the bar's
 * pill: no React render while they move. A finger on the bar is followed through a short critically
 * damped chase (about 20 ms), so the bar's gear (pages move several times the finger's travel) doesn't
 * turn each touch sample into a visible step; letting go hands its speed to the settle.
 */
export class ShellPos {
  p: number;
  /** Where the last settle or jump is taking the pages. */
  target: number;
  /** The side rail of a wide window: its indicator moves down the rail. */
  rail = false;
  /** The last page's index (the tabs can change with Settings). */
  last = 0;
  private moving = false;
  private run: Settling | null = null;
  private chase: { target: number; v: number; raf: number; last: number } | null = null;
  track: HTMLElement | null = null;
  pill: HTMLElement | null = null;
  private shown: number;
  private hinted: number | null = null;
  private width: () => number;
  private onShown: (i: number) => void;
  constructor(p: number, width: () => number, onShown: (i: number) => void) { this.p = p; this.shown = p; this.target = p; this.width = width; this.onShown = onShown; }
  draw(p: number) {
    this.p = p;
    this.paint();
    this.show(p);
  }
  private show(p: number) {
    const r = clamp(Math.round(p), 0, this.last);
    // While moving, the chosen tab changes only once the pages are well past halfway, so a finger
    // wavering about the middle of a fast slide doesn't flick the tabs back and forth.
    if (r !== this.shown && (!this.moving || Math.abs(p - this.shown) > 0.6)) { this.shown = r; this.onShown(r); }
  }
  /** Writes the track's and the indicator's offsets for where the pages are. */
  paint() {
    this.hinted = null;
    if (this.track) this.track.style.transform = slide(this.p, -1, this.moving);
    if (this.pill) this.pill.style.transform = slide(this.p, 1, this.moving, this.rail ? "Y" : "X");
  }
  get resting() { return !this.moving; }
  /** The tab the bar shows as chosen. */
  get shownTab() { return this.shown; }
  /** A finger is down on tab [i]: the indicator is there at once, ahead of the pages, which turn as it lifts. */
  hint(i: number) {
    this.hinted = i;
    if (this.pill) this.pill.style.transform = slide(i, 1, false, this.rail ? "Y" : "X");
  }
  /** It wasn't a tap after all: the indicator goes back to the pages. Returns whether there was a hint. */
  unhint() {
    if (this.hinted === null) return false;
    this.hinted = null;
    this.paint();
    return true;
  }
  /** Where a settle has got to, in pages. */
  private place(r: Settling) {
    const t = Number(r.anims[0]?.currentTime ?? 0) / 1000;
    return (r.to + springAt(t, r.d0, r.vs, PAGE_SPRING.stiffness!, PAGE_SPRING.damping!).x) / r.w;
  }
  /** Ends a settle where it is: the styles take over from the animations in the same frame. */
  private drop() {
    const r = this.run;
    if (!r) return;
    this.run = null;
    clearTimeout(r.timer);
    this.p = this.place(r);
    this.paint();
    r.anims.forEach((a) => a.cancel());
  }
  stop() {
    this.drop();
    if (this.chase) { cancelAnimationFrame(this.chase.raf); this.chase = null; }
  }
  /**
   * A finger landing on the bar while the pages still move: they stop where they are, under it, so a
   * slide starting now carries on from there instead of jumping back to where the last one began.
   */
  grab() { if (this.run || this.chase) this.stop(); }
  /** At once (a tap on a tab). */
  jump(i: number) { this.stop(); this.moving = false; this.target = i; this.draw(i); }
  /** Directly under a finger on the pages, already once per frame: [p] in pages. */
  drag(p: number) {
    this.stop();
    this.moving = true;
    this.draw(p);
  }
  /** Follows a finger: [target] in pages. */
  follow(target: number) {
    this.drop();
    this.moving = true;
    if (this.chase) { this.chase.target = target; return; }
    const c = this.chase = { target, v: 0, raf: 0, last: performance.now() };
    const W = 65; // ω of the chase: lags about 2/ω (30 ms) behind a steady finger, catches up within ~60 ms
    const step = (now: number) => {
      if (this.chase !== c) return;
      const dt = Math.min(0.1, Math.max(0.001, (now - c.last) / 1000));
      c.last = now;
      // Exact over the frame (closed form), so a long frame can't make it overshoot or blow up.
      const st = springAt(dt, this.p - c.target, c.v, W * W, 1);
      c.v = st.v;
      let p = c.target + st.x;
      if (Math.abs(c.target - p) < 0.0005 && Math.abs(c.v) < 0.01) { p = c.target; c.v = 0; }
      this.draw(p);
      c.raf = requestAnimationFrame(step);
    };
    c.raf = requestAnimationFrame(step);
  }
  /** Settles on page [i], starting at [v] pages per ms. */
  settle(i: number, v: number) {
    this.stop();
    this.moving = true;
    this.target = i;
    this.paint(); // the moving form, for the animations to start from
    const w = Math.max(1, this.width());
    const from = this.p * w, to = i * w, vx = v * w;
    const rest = () => { this.moving = false; this.draw(i); };
    if (!this.track || (from === to && !vx)) { rest(); return; }
    const STEP = 8;
    const { xs, ms } = springFrames(from, to, vx, PAGE_SPRING, STEP);
    const opts: KeyframeAnimationOptions = { duration: ms, easing: "linear", fill: "both" };
    const anims = [this.track.animate(xs.map((x) => ({ transform: slidePx(-x, "X") })), opts)];
    const axis = this.rail ? "Y" : "X";
    // One tab wide (or tall), so its own size is one page.
    const size = this.pill ? (this.rail ? this.pill.offsetHeight : this.pill.offsetWidth) : 0;
    if (this.pill && size) anims.push(this.pill.animate(xs.map((x) => ({ transform: slidePx((x / w) * size, axis) })), opts));
    const at = shownChangesAt(xs, w, this.shown, clamp(i, 0, this.last), STEP);
    const run: Settling = { anims, d0: from - to, vs: vx * 1000, to, w, timer: undefined };
    if (at !== null) run.timer = setTimeout(() => { if (this.run === run) this.show(this.place(run)); }, at);
    this.run = run;
    anims[0].onfinish = () => {
      if (this.run !== run) return;
      this.run = null;
      clearTimeout(run.timer);
      rest();
      anims.forEach((a) => a.cancel());
    };
  }
}
