// The time drum: hold the hours or the minutes of a time and a small 3D drum blooms out of the digits,
// right where they are. The same finger then turns it: the numbers above and below curve away round the
// drum, fading as they go, the one in the middle crisp in a soft band; let go, it coasts with the
// finger's speed and settles onto a number with a soft spring, ticking lightly for each number passed.
// Once it rests, the value is picked and the drum folds back into the digits.
//
// Used for every time the phone shows that can change: alarms (list and editor), task and event times
// on Today and the item editor's times. Nothing re-renders while it turns: the drum writes its own
// transforms and opacities once per frame. Row maths: wheelMath.ts (test/wheel.test.ts); motion:
// motion.ts (test/motion.test.ts).
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";
import { use24h } from "../../domain/dates.ts";
import { type Animation, type SpringConfig, VelocityTracker, animateCoast, animateSpring, bandClamp, snapIndex } from "./motion.ts";
import { pushBack } from "./native.ts";
import { feel } from "./haptics.ts";
import { suspendOverscroll } from "./overscroll.ts";
import { TOUCH_SLOP } from "./press.ts";
import { joinTime, nearestSlot, splitTime, wheelHours, wheelMinutes, wrapIndex } from "./wheelMath.ts";

export interface WheelOptions {
  count: number;
  rowH: number;
  index: number;
  /** The rows go round (hours, minutes); otherwise the ends give like a rubber band (AM/PM). */
  wrap: boolean;
  /** Shows the wheel turned [offset] px (slot s is centred at s·rowH). */
  write: (offset: number) => void;
  /** A new row reached the middle (while turning). */
  onRow?: (i: number) => void;
  /** The wheel came to rest on row i. */
  onSettle?: (i: number) => void;
}

/** One wheel's motion, apart from React: grab, move and release it with a finger's positions. */
export class WheelDrive {
  offset: number;
  private slot: number;
  private anim: Animation | null = null;
  private vt = new VelocityTracker();
  private y0 = 0;
  private o0 = 0;
  private held = false;
  private moved = false;
  constructor(private o: WheelOptions) {
    this.offset = o.index * o.rowH;
    this.slot = o.index;
  }
  /** The row in the middle now. */
  get index() { return this.o.wrap ? wrapIndex(this.slot, this.o.count) : this.slot; }
  get busy() { return this.held || this.anim !== null; }
  private clampSlot(s: number) { return this.o.wrap ? s : Math.max(0, Math.min(this.o.count - 1, s)); }
  private draw(off: number) {
    this.offset = off;
    this.o.write(off);
    const s = this.clampSlot(Math.round(off / this.o.rowH));
    if (s !== this.slot) { this.slot = s; this.o.onRow?.(this.index); }
  }
  grab(y: number, t: number) {
    this.anim?.stop();
    this.anim = null;
    this.held = true;
    this.moved = false;
    this.y0 = y;
    this.o0 = this.offset;
    this.vt.reset();
    this.vt.add(t, y);
  }
  move(y: number, t: number) {
    if (!this.held) return;
    this.vt.add(t, y);
    if (Math.abs(y - this.y0) > TOUCH_SLOP / 2) this.moved = true;
    const off = this.o0 - (y - this.y0);
    this.draw(this.o.wrap ? off : bandClamp(off, 0, (this.o.count - 1) * this.o.rowH, this.o.rowH * 3));
  }
  /** Lets go: the wheel coasts onto a row. Returns whether the finger turned it (not a tap). */
  release(t: number): boolean {
    if (!this.held) return false;
    this.held = false;
    const v = -this.vt.velocity(t);
    const lo = this.o.wrap ? -1e9 : 0, hi = this.o.wrap ? 1e9 : this.o.count - 1;
    this.toSlot(snapIndex(this.offset, v, this.o.rowH, lo, hi), v);
    return this.moved;
  }
  private toSlot(s: number, v = 0) {
    this.anim?.stop();
    const to = this.clampSlot(s) * this.o.rowH;
    // A short coast (about half a second at most), so a fling lands crisply rather than drifting.
    this.anim = animateCoast(this.offset, to, v, (x) => this.draw(x), () => { this.anim = null; this.o.onSettle?.(this.index); }, this.o.rowH * 0.3, 420);
  }
  /** Turns to row [i] (the shortest way round on a drum). */
  glide(i: number) { this.toSlot(this.o.wrap ? nearestSlot(this.slot, i, this.o.count) : i); }
  /** Turns by [n] rows. */
  step(n: number) { this.toSlot(this.slot + n); }
  stop() { this.anim?.stop(); this.anim = null; this.held = false; }
}

/**
 * Hands the finger still down from a hold ([pointerId]) to the wheel in [drive]: its moves turn it, and
 * [onRelease] hears whether it turned when it lets go. Returns a ref that's true while it's handed on.
 */
function useHandoff(pointerId: number | undefined, drive: React.MutableRefObject<WheelDrive | null>, onRelease: (turned: boolean) => void) {
  const handing = useRef(pointerId !== undefined);
  const cb = useRef(onRelease);
  cb.current = onRelease;
  useEffect(() => {
    if (pointerId === undefined) return;
    let grabbed = false;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || !handing.current || !drive.current) return;
      const d = drive.current;
      if (!grabbed) { grabbed = true; d.grab(e.clientY, e.timeStamp); }
      const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const c of list.length ? list : [e]) d.move(c.clientY, c.timeStamp);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || !handing.current) return;
      handing.current = false;
      const turned = grabbed && !!drive.current?.release(e.timeStamp);
      done();
      cb.current(turned);
    };
    // While the finger turns the drum, the page under it mustn't scroll or stretch.
    const noScroll = (e: TouchEvent) => { if (handing.current && e.cancelable) e.preventDefault(); };
    const done = () => {
      suspendOverscroll(false);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      document.removeEventListener("touchmove", noScroll, true);
    };
    suspendOverscroll(true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    document.addEventListener("touchmove", noScroll, { capture: true, passive: false });
    return done;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return handing;
}

// ---------- The drum ----------

/** Rows drawn each side of the middle. */
const SIDE = 3;
/** The drum's radius, in rows: smaller curves the numbers away faster. */
const RADIUS = 1.3;
const BLOOM: SpringConfig = { stiffness: 520, damping: 0.8 };
const FOLD: SpringConfig = { stiffness: 700, damping: 1 };
/** Digits smaller than this (px) grow to it while the drum is out. */
const MIN_FONT = 24;

export interface DrumRequest {
  /** The digits it blooms from (their font and colour are copied; they're hidden while it's out). */
  anchor: HTMLElement;
  values: string[];
  index: number;
  wrap: boolean;
  label: string;
  /** The finger still down from the hold: it turns the drum, and once it rests the value is picked. */
  pointerId?: number;
  onPick: (i: number) => void;
}

let drumReq: DrumRequest | null = null;
const drumListeners = new Set<() => void>();
/** Blooms a drum out of [anchor]. */
export function openDrum(r: DrumRequest) { drumReq = r; drumListeners.forEach((l) => l()); }

/** Where drums open: once, in the phone shell (portalled to the body, so over sheets too). */
export function DrumHost() {
  const [r, setR] = useState<DrumRequest | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = () => { setR(drumReq); setN((x) => x + 1); };
    drumListeners.add(on);
    return () => { drumListeners.delete(on); };
  }, []);
  if (!r) return null;
  return createPortal(<Drum key={n} {...r} onClose={() => { if (drumReq === r) drumReq = null; setR((cur) => (cur === r ? null : cur)); }} />, document.body);
}

/**
 * The drum over the held digits. Opened by a hold whose finger goes on to turn it, it picks where it
 * rests and folds away; opened by a hold that just lets go, it stays for swipes and taps (each rest
 * picks) until a tap on its middle or outside.
 */
function Drum({ anchor, values, index, wrap, label, pointerId, onPick, onClose }: DrumRequest & { onClose: () => void }) {
  const n = values.length;
  const [g] = useState(() => {
    const r = anchor.getBoundingClientRect(), cs = getComputedStyle(anchor);
    const fs0 = parseFloat(cs.fontSize) || 16;
    // Small digits (a row's time) grow a little into a drum big enough to read and turn; folded, it's
    // exactly their size again.
    const z = Math.max(1, MIN_FONT / fs0), fs = fs0 * z;
    const rowH = Math.max(r.height * z, fs * 1.15);
    const R = rowH * RADIUS;
    const H = Math.ceil(2 * R + rowH * 0.2);
    const padX = Math.max(8, fs * 0.28);
    const W = r.width * z + 2 * padX;
    return {
      r, z, rowH, R, H, W, left: r.left + r.width / 2 - W / 2, top: r.top + r.height / 2 - H / 2,
      font: `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`, color: cs.color, spacing: cs.letterSpacing,
    };
  });
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const bandBg = useRef<HTMLDivElement>(null);
  const rows3d = useRef<HTMLDivElement[]>([]);
  const flat = useRef<HTMLDivElement[]>([]);
  const st = useRef({ offset: index * g.rowH, b: 0, texts: new Map<HTMLElement, string>() });
  const drive = useRef<WheelDrive | null>(null);
  const bloom = useRef<Animation | null>(null);
  const closing = useRef(false);
  const last = useRef(index);
  const foldOnRest = useRef(false);

  const text = (el: HTMLElement, t: string) => { if (st.current.texts.get(el) !== t) { st.current.texts.set(el, t); el.textContent = t; } };
  const valueAt = (slot: number) => (wrap ? values[wrapIndex(slot, n)] : slot >= 0 && slot < n ? values[slot] : null);

  /** Writes every row for the drum turned to the current offset and bloomed by b (0 folded, 1 out). */
  const draw = () => {
    const { offset, b } = st.current;
    const { rowH, R } = g;
    const c = Math.round(offset / rowH);
    const k = Math.max(0, b);
    for (let i = -SIDE; i <= SIDE; i++) {
      const el = rows3d.current[i + SIDE];
      if (!el) continue;
      const slot = c + i;
      const th = (slot * rowH - offset) / R;
      const v = valueAt(slot);
      if (v === null || Math.abs(th) > 1.45) { el.style.opacity = "0"; continue; }
      text(el, v);
      const cos = Math.cos(th);
      el.style.transform = `translate3d(0,${(R * Math.sin(th)).toFixed(2)}px,${(R * (cos - 1)).toFixed(2)}px) rotateX(${(-th).toFixed(4)}rad)`;
      el.style.opacity = (Math.min(1, k) * cos * cos * 0.8).toFixed(3);
    }
    for (let i = -1; i <= 1; i++) {
      const el = flat.current[i + 1];
      if (!el) continue;
      const slot = c + i;
      text(el, valueAt(slot) ?? "");
      el.style.transform = `translate3d(0,${(slot * rowH - offset).toFixed(2)}px,0)`;
    }
    const s = g.rowH / g.H + (1 - g.rowH / g.H) * k;
    if (panel.current) {
      panel.current.style.transform = `scale(${(0.92 + 0.08 * Math.min(1, k)).toFixed(4)},${s.toFixed(4)})`;
      panel.current.style.opacity = Math.min(1, k * 1.6).toFixed(3);
    }
    if (bandBg.current) bandBg.current.style.opacity = Math.min(1, k).toFixed(3);
    if (g.z > 1 && root.current) root.current.style.transform = `scale(${(1 / g.z + (1 - 1 / g.z) * k).toFixed(4)})`;
  };

  const fold = () => {
    if (closing.current) return;
    closing.current = true;
    drive.current?.stop();
    bloom.current?.stop();
    bloom.current = animateSpring(st.current.b, 0, 0, (x) => { st.current.b = x; draw(); }, () => {
      // The digits come back once they show the picked value (alarms save on the native side first).
      const want = values[last.current];
      const t0 = performance.now();
      const show = () => {
        if (anchor.textContent?.trim() === want || performance.now() - t0 > 700 || !anchor.isConnected) { anchor.style.visibility = ""; onClose(); }
        else requestAnimationFrame(show);
      };
      show();
    }, FOLD);
  };

  useLayoutEffect(() => {
    const d = new WheelDrive({
      count: n, rowH: g.rowH, index, wrap,
      write: (off) => { st.current.offset = off; draw(); },
      onRow: (i) => { feel("tick"); root.current?.setAttribute("aria-valuetext", values[i]); },
      onSettle: (i) => {
        if (i !== last.current) { last.current = i; onPick(i); }
        if (foldOnRest.current) fold();
      },
    });
    drive.current = d;
    anchor.style.visibility = "hidden";
    draw();
    bloom.current = animateSpring(0, 1, 0, (x) => { st.current.b = x; draw(); }, undefined, BLOOM);
    return () => { d.stop(); bloom.current?.stop(); anchor.style.visibility = ""; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => pushBack(fold), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handing = useHandoff(pointerId, drive, (turned) => { if (turned) foldOnRest.current = true; });

  const rowStyle = { height: g.rowH, lineHeight: `${g.rowH}px`, top: (g.H - g.rowH) / 2 };
  return (
    <div className="tw-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget && !handing.current) fold(); }}>
      <div ref={root} className="tw-drum" role="spinbutton" tabIndex={-1} aria-label={label} aria-valuetext={values[index]}
        style={{
          left: g.left, top: g.top, width: g.W, height: g.H,
          font: g.font, letterSpacing: g.spacing, ["--fc" as string]: g.color, perspective: `${Math.round(g.R * 3.2)}px`,
        }}
        onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); drive.current?.step(e.key === "ArrowUp" ? -1 : 1); } }}
        onPointerDown={(e) => {
          if (e.button !== 0 || handing.current || closing.current) return;
          const el = root.current!, d = drive.current!;
          el.setPointerCapture(e.pointerId);
          const y0 = e.clientY, id = e.pointerId;
          d.grab(e.clientY, e.timeStamp);
          const move = (ev: PointerEvent) => {
            if (ev.pointerId !== id) return;
            const list = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [];
            for (const c of list.length ? list : [ev]) d.move(c.clientY, c.timeStamp);
          };
          const up = (ev: PointerEvent) => {
            if (ev.pointerId !== id) return;
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            el.removeEventListener("pointercancel", up);
            if (d.release(ev.timeStamp)) return;
            // A tap above or below the middle turns to that number; on the middle, it's done.
            const r = el.getBoundingClientRect();
            const steps = Math.round((y0 - (r.top + r.height / 2)) / g.rowH);
            if (steps) d.step(steps);
            else fold();
          };
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", up);
          el.addEventListener("pointercancel", up);
        }}>
        <div className="tw-panel" ref={panel} />
        {Array.from({ length: 2 * SIDE + 1 }, (_, i) => (
          <div key={i} className="tw-row" style={rowStyle} ref={(el) => { if (el) rows3d.current[i] = el; }} />
        ))}
        <div className="tw-band" style={{ top: (g.H - g.rowH) / 2, height: g.rowH }}>
          <div className="tw-band-bg" ref={bandBg} />
          {[0, 1, 2].map((i) => (
            <div key={i} className="tw-flat" style={{ height: g.rowH, lineHeight: `${g.rowH}px` }} ref={(el) => { if (el) flat.current[i] = el; }} aria-hidden="true" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Holding a time ----------

const HOLD_MS = 450;
let hold: { id: number; x0: number; y0: number; timer: number; fired: boolean } | null = null;
let swallowClick = false;

/**
 * Props for something that opens a drum when held (450 ms, with the soft pick-up feel): [onHold] gets the
 * finger's pointer id, so the same finger can go on to turn it. The click after a hold is swallowed,
 * so the row or button under it doesn't open too.
 */
export function holdProps(onHold: (pointerId: number) => void): HTMLAttributes<HTMLElement> {
  return {
    onPointerDown: (e) => {
      if (e.button !== 0 || !e.isPrimary) return;
      if (hold) clearTimeout(hold.timer);
      swallowClick = false;
      const h = { id: e.pointerId, x0: e.clientX, y0: e.clientY, fired: false, timer: 0 };
      h.timer = window.setTimeout(() => { h.fired = true; swallowClick = true; feel("pickup"); onHold(h.id); }, HOLD_MS);
      hold = h;
    },
    onPointerMove: (e) => {
      const h = hold;
      if (!h || h.fired || e.pointerId !== h.id) return;
      if (Math.hypot(e.clientX - h.x0, e.clientY - h.y0) > TOUCH_SLOP) { clearTimeout(h.timer); hold = null; }
    },
    onPointerUp: () => { if (hold && !hold.fired) clearTimeout(hold.timer); hold = null; },
    onPointerCancel: () => { if (hold && !hold.fired) clearTimeout(hold.timer); hold = null; },
    onClickCapture: (e) => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } },
    onContextMenu: (e) => e.preventDefault(),
  };
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * A time whose hours, minutes (and AM/PM) can each be held: a drum blooms out of just those digits,
 * and where it rests is the new time. [step]: the minutes offered (5 for tasks and events, keeping an
 * odd minute the time already has; 1 for alarms).
 */
export function HeldTime({ min, onChange, step = 5, className = "" }: { min: number; onChange: (min: number) => void; step?: number; className?: string }) {
  const h24 = use24h();
  const hEl = useRef<HTMLSpanElement>(null), mEl = useRef<HTMLSpanElement>(null), pEl = useRef<HTMLSpanElement>(null);
  const hours = wheelHours(h24);
  const minutes = wheelMinutes(step, min % 60);
  const t = splitTime(min, h24, minutes);
  const hourText = (x: number) => (h24 ? two(x) : String(x));
  const hold = (el: React.RefObject<HTMLSpanElement | null>, label: string, values: string[], index: number, wrap: boolean, to: (i: number) => number) =>
    holdProps((id) => { if (el.current) openDrum({ anchor: el.current, label, values, index, wrap, pointerId: id, onPick: (i) => onChange(to(i)) }); });
  return (
    <span className={`p-heldtime ${className}`}>
      <span ref={hEl} className="tw-part" {...hold(hEl, "Hours", hours.map(hourText), t.hour, true, (i) => joinTime(i, t.minute, t.pm, h24, minutes))}>{hourText(hours[t.hour])}</span>
      :
      <span ref={mEl} className="tw-part" {...hold(mEl, "Minutes", minutes.map(two), t.minute, true, (i) => joinTime(t.hour, i, t.pm, h24, minutes))}>{two(minutes[t.minute])}</span>
      {!h24 && <>{" "}<span ref={pEl} className="tw-part" {...hold(pEl, "AM or PM", ["AM", "PM"], t.pm ? 1 : 0, false, (i) => joinTime(t.hour, t.minute, i === 1, h24, minutes))}>{t.pm ? "PM" : "AM"}</span></>}
    </span>
  );
}
