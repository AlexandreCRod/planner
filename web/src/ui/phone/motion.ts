// The phone's motion kit, shared by every gesture so they all feel the same: a spring that starts at
// the finger's speed, a rubber band for edges, a velocity tracker fed with every touch sample, and the
// momentum projection a wheel snaps with. The maths is pure (tested in test/motion.test.ts); the
// animation loop only writes what [frame] is given, through refs, never through React state.
//
// Units: positions in px, velocities in px per ms (what pointer events give), stiffness in s⁻².

export interface SpringConfig {
  /** Stiffness (Compose's Spring.Stiffness*: 1500 high, 400 medium-low, 200 low). */
  stiffness?: number;
  /** Damping ratio: 1 critically damped (no overshoot), below 1 a little bounce. */
  damping?: number;
  /** At rest once closer than this (px) and slower than restSpeed (px per s). */
  restDelta?: number;
  restSpeed?: number;
}

/** The pagers' settle: snappy, critically damped (stiffness 600). */
export const PAGE_SPRING: SpringConfig = { stiffness: 600, damping: 1 };
/** Something small gliding to a new place (a marked slot, a dragged line): a touch of bounce. */
export const GLIDE_SPRING: SpringConfig = { stiffness: 700, damping: 0.78 };
/** Scaling in: quick, with a little overshoot. */
export const POP_SPRING: SpringConfig = { stiffness: 900, damping: 0.62 };
/** An edge giving back after a pull or a fling: soft, no overshoot. */
export const EDGE_SPRING: SpringConfig = { stiffness: 380, damping: 1 };
/** A firm edge (the calendar's) giving back: quicker, still without overshoot. */
export const FIRM_EDGE_SPRING: SpringConfig = { stiffness: 900, damping: 1 };

/**
 * Where a spring is [t] s after starting [d0] px from its target at [v0] px/s: the offset from the
 * target and the speed, for stiffness ω² and damping ratio ζ (closed form, so frames can be dropped).
 */
export function springAt(t: number, d0: number, v0: number, stiffness: number, damping: number): { x: number; v: number } {
  const w = Math.sqrt(stiffness), z = damping;
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w * t), c = Math.cos(wd * t), s = Math.sin(wd * t);
    const b = (v0 + z * w * d0) / wd;
    const x = e * (d0 * c + b * s);
    const v = e * ((-z * w) * (d0 * c + b * s) + (-d0 * wd * s + b * wd * c));
    return { x, v };
  }
  if (z === 1) {
    const e = Math.exp(-w * t), b = v0 + w * d0;
    return { x: (d0 + b * t) * e, v: (v0 - w * b * t) * e };
  }
  const r = Math.sqrt(z * z - 1);
  const r1 = -w * (z - r), r2 = -w * (z + r);
  const c2 = (v0 - r1 * d0) / (r2 - r1), c1 = d0 - c2;
  const e1 = Math.exp(r1 * t), e2 = Math.exp(r2 * t);
  return { x: c1 * e1 + c2 * e2, v: c1 * r1 * e1 + c2 * r2 * e2 };
}

export interface Animation {
  /** Stops where it is (done isn't called). */
  stop(): void;
  /** Where it is now and how fast it moves (px, px per ms): to hand on to the next animation. */
  now(): { x: number; v: number };
}

/**
 * Animates from [from] to [to] on a spring that starts at [v0] px/ms (the finger's speed when let go),
 * calling [frame] with the value every animation frame (never rounded: sub-pixel moves stay smooth)
 * and [done] once it rests exactly on [to].
 */
export function animateSpring(from: number, to: number, v0: number, frame: (x: number) => void, done?: () => void, cfg: SpringConfig = PAGE_SPRING): Animation {
  const k = cfg.stiffness ?? 600, z = cfg.damping ?? 1;
  const restDelta = cfg.restDelta ?? 0.3, restSpeed = cfg.restSpeed ?? 20;
  const d0 = from - to, vs = v0 * 1000;
  const t0 = performance.now();
  let raf = 0, cur = { x: d0, v: vs }, stopped = false;
  const step = (now: number) => {
    const t = Math.max(0, (now - t0) / 1000);
    cur = springAt(t, d0, vs, k, z);
    if ((t > 0.02 && Math.abs(cur.x) < restDelta && Math.abs(cur.v) < restSpeed) || t > 3) {
      cur = { x: 0, v: 0 };
      frame(to);
      stopped = true;
      done?.();
      return;
    }
    frame(to + cur.x);
    raf = requestAnimationFrame(step);
  };
  if (d0 === 0 && vs === 0) { frame(to); stopped = true; done?.(); }
  else raf = requestAnimationFrame(step);
  return {
    stop() { stopped = true; cancelAnimationFrame(raf); },
    now() { return stopped && cur.x === 0 ? { x: to, v: 0 } : { x: to + cur.x, v: cur.v / 1000 }; },
  };
}

/**
 * A rubber band: [over] px pulled past an edge shows as this much, giving less and less the further it
 * goes, never more than [dim] (iOS's formula, c = 0.55). Negative pulls give negative results.
 */
export function rubberBand(over: number, dim: number, c = 0.55): number {
  if (!over || dim <= 0) return 0;
  const a = Math.abs(over);
  return Math.sign(over) * (1 - 1 / ((a * c) / dim + 1)) * dim;
}

/** How far the finger must have pulled to show [shown] px of rubber band (rubberBand's inverse). */
export function rubberBandInverse(shown: number, dim: number, c = 0.55): number {
  if (!shown || dim <= 0) return 0;
  const a = Math.min(Math.abs(shown), dim * 0.999);
  return Math.sign(shown) * ((1 / (1 - a / dim) - 1) * dim) / c;
}

/**
 * The finger's speed from its recent samples, as Android's VelocityTracker does: a least-squares line
 * through the last 100 ms of positions. A finger that stopped (nothing for 40 ms) has no speed.
 */
export class VelocityTracker {
  private t: number[] = [];
  private x: number[] = [];
  /** Adds a position [x] (px) at time [t] (ms). */
  add(t: number, x: number) {
    const n = this.t.length;
    if (n && t < this.t[n - 1]) this.reset();
    this.t.push(t); this.x.push(x);
    while (this.t.length > 1 && t - this.t[0] > 100) { this.t.shift(); this.x.shift(); }
    if (this.t.length > 24) { this.t.shift(); this.x.shift(); }
  }
  /** Adds an event's position on [axis], with every sample the browser merged into it. */
  addEvent(e: PointerEvent, axis: "x" | "y") {
    const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const all = list.length ? list : [e];
    for (const c of all) this.add(c.timeStamp, axis === "x" ? c.clientX : c.clientY);
  }
  reset() { this.t = []; this.x = []; }
  /** px per ms; [now] (ms) to tell a paused finger (default: the last sample's time). */
  velocity(now?: number): number {
    const n = this.t.length;
    if (n < 2) return 0;
    const last = this.t[n - 1];
    if (now !== undefined && now - last > 40) return 0;
    let st = 0, sx = 0;
    for (let i = 0; i < n; i++) { st += this.t[i] - last; sx += this.x[i]; }
    const mt = st / n, mx = sx / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { const dt = this.t[i] - last - mt; num += dt * (this.x[i] - mx); den += dt * dt; }
    return den > 0 ? num / den : 0;
  }
}

/** How far a fling at [v] px/ms coasts before stopping, slowing by [rate] each ms (iOS's normal 0.998). */
export function project(v: number, rate = 0.998): number {
  return (v * rate) / (1 - rate);
}

/**
 * The value a wheel of [step]-px rows lands on: from offset [pos] (px) flung at [v] px/ms, the coast
 * rounded to the nearest whole row, between rows [min] and [max]. Returns the row index.
 */
export function snapIndex(pos: number, v: number, step: number, min: number, max: number, rate = 0.996): number {
  const i = Math.round((pos + project(v, rate)) / step);
  return Math.min(max, Math.max(min, i));
}

/**
 * The time constant (ms) of a coast that starts at [v0] px/ms and comes to rest exactly [dist] px on,
 * slowing all the way (x = dist·(1 − e^(−t/τ)), so its starting speed is dist/τ): null when the fling
 * points the other way or is too slow to coast, for a spring to take it instead.
 */
export function coastTau(dist: number, v0: number, min = 60, max = 900): number | null {
  if (Math.abs(v0) < 0.05 || Math.sign(dist) !== Math.sign(v0)) return null;
  return Math.max(min, Math.min(max, dist / v0));
}

/** A wheel's last few px onto its row: a quick spring with the faintest overshoot (never back past a row). */
export const SNAP_SPRING: SpringConfig = { stiffness: 460, damping: 0.8 };

/**
 * Carries a flung value from [from] to [to] (a wheel's row): it coasts from the finger's [v0] px/ms,
 * slowing all the way (taking at most about [maxTau] ms to slow down), and the last [snapAt] px are a
 * soft spring onto the row, carrying the coast's speed. A slow or backwards release is the spring alone.
 */
export function animateCoast(from: number, to: number, v0: number, frame: (x: number) => void, done?: () => void, snapAt = 10, maxTau = 900): Animation {
  const tau = coastTau(to - from, v0, 60, maxTau);
  if (tau === null || Math.abs(to - from) <= snapAt) return animateSpring(from, to, v0, frame, done, SNAP_SPRING);
  const d = to - from, t0 = performance.now();
  let raf = 0, x = from, v = v0, snap: Animation | null = null;
  const step = (now: number) => {
    const t = Math.max(0, now - t0), e = Math.exp(-t / tau);
    x = to - d * e;
    v = (d / tau) * e;
    if (Math.abs(to - x) <= snapAt) { snap = animateSpring(x, to, v, frame, done, SNAP_SPRING); return; }
    frame(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return {
    stop() { cancelAnimationFrame(raf); snap?.stop(); },
    now() { return snap ? snap.now() : { x, v }; },
  };
}

/** A value kept to [lo]..[hi], with the part past either end given back as a rubber band over [dim] px. */
export function bandClamp(v: number, lo: number, hi: number, dim: number): number {
  if (v < lo) return lo + rubberBand(v - lo, dim);
  if (v > hi) return hi + rubberBand(v - hi, dim);
  return v;
}

/**
 * Runs [frame] on the next animation frame with the latest value only: pointer events can come
 * faster than the screen, and each frame should write the DOM once.
 */
export function frameWriter<T>(frame: (v: T) => void): { (v: T): void; cancel(): void; flush(): void } {
  let raf = 0, pending: { v: T } | null = null;
  const run = () => { raf = 0; const p = pending; pending = null; if (p) frame(p.v); };
  const write = ((v: T) => { pending = { v }; if (!raf) raf = requestAnimationFrame(run); }) as { (v: T): void; cancel(): void; flush(): void };
  write.cancel = () => { cancelAnimationFrame(raf); raf = 0; pending = null; };
  write.flush = () => { cancelAnimationFrame(raf); run(); };
  return write;
}
