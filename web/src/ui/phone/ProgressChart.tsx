// The Progress charts (TrainingProgress.tsx): a time chart that a finger reads, a list row's sparkline, and
// the range switch. Drawn as SVG at the card's real width, so text and dots keep their size in a wide window.
// The chart rules (handover, 2.8): 2 px lines, dots of at least 8 px with a ring of the card's colour, bars
// at most 24 px wide with 4 px rounded tops, hairline grid, one value axis, text never in a series colour.
// A chart that can move through time (302, [pan]): a swipe moves it one whole window, older to the right; a hold
// of a quarter of a second, then a slide, reads the point nearest the finger, one tick for each new point. A chart
// with nowhere to go reads at the touch. The reading stays where the finger lifts, until a tap (on the chart too)
// goes back to the latest. A mouse reads on hover, keeps the reading where it clicks and drags to move; on the
// keyboard, the arrows move the chart that has the focus. The ‹ › above a chart (PanBar) do the same as a swipe.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DropdownMenu, MIcon, Segmented } from "./chrome.tsx";
import { type RangeKey, type WindowKey, RANGES, WINDOW_NAMES, WINDOWS, dayMonth, nearestIndex, niceTicks, panTarget, scale } from "./chartMath.ts";
import { claimSwipe } from "./gesture.ts";
import { feel } from "./haptics.ts";
import { VelocityTracker, frameWriter, rubberBand } from "./motion.ts";
import { spring } from "./pager.ts";
import { TOUCH_SLOP, swallowClick } from "./press.ts";

/** The series colours, validated on the dark surface (dataviz skill); in step with the Training kinds. */
export const GYM = "#bf8a2a", GYM_DIM = "#7a5c22", RUN = "#33a390", WEIGHT = "#6a8ed4", WEIGHT_DIM = "#5d6475", PAIN = "#d9664f";
/**
 * Sleep, resting HR and HRV (2.8-final.html); the dim one for each night under the 7-day line. Validated on
 * both themes in 2.8.2 (the dim one was #80527c, too grey); on the dark card it stays just under 3:1, with
 * the legend and the 7-day line carrying the reading.
 */
export const SLEEP = "#c06cb8", SLEEP_DIM = "#864d81";
/** Futsal's marks (the Training kind's colour), and the quiet grey of an average line (2.8.5 mockup). */
export const FUTSAL = "#9fb3c8", GREY = "#6b6d73";

/**
 * One reading. [mark]: drawn hollow (an assumed RPE) or as a lower bound (history with no RPE). In a bar series,
 * [span]: this bar's days (a month's), and [dim]: it's still filling.
 */
export interface Pt { day: number; v: number; mark?: "hollow" | "lower"; span?: number; dim?: boolean }
export type Series =
  /** [gap]: the line breaks where readings are more than this many days apart (266: no straight line over weeks of nothing). */
  | { kind: "line"; pts: Pt[]; color: string; area?: boolean; dots?: boolean; gap?: number }
  | { kind: "dots"; pts: Pt[]; color: string; r?: number }
  /** One bar per [span] days from its day (a week by default), at most [maxW] px wide (24). */
  | { kind: "bars"; pts: Pt[]; color: string; span?: number; maxW?: number }
  /** A shaded band from [lo] to [hi] (HRV's normal range), drawn under the other series. */
  | { kind: "band"; pts: { day: number; lo: number; hi: number }[]; color: string };

const L = 36, R = 10, T = 8, B = 22;

/** How long a finger keeps still before a chart reads instead of waiting for a swipe (mockup 2.8.6 section 3). */
const HOLD = 250;

/** A chart's place in time (302): the window's name, how many back it is, and the way to move. [id] changes with the range. */
export interface Pan { id: string; label: string; back: number; canBack: boolean; canFwd: boolean; step: (dir: 1 | -1) => void; now: () => void }

/** One press on a chart. "wait": it could still become a swipe or a hold. "off": a scroll took it. */
interface Press {
  id: number; x: number; y: number; t: number; lastX: number; moved: boolean; mouse: boolean;
  mode: "wait" | "read" | "pan" | "off"; timer: number; dx: number; vt: VelocityTracker;
}

/** The width an element is drawn at, kept up to date. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * A chart over the days [domain] (first, last). [reads] are the days a finger can read, ascending; [onRead]
 * gets the index of the one nearest the finger, which stays when it lifts, and null when a tap goes back to
 * the latest (or [reads] change). [rings]: pain, as a ring around the point. [fmt] writes the value axis;
 * [invert] puts low values at the top (pace: faster is higher). [zero] starts the axis at 0 (bars always do).
 * [top]: the axis reaches at least this, so bars keep one scale from window to window. [labels]: the axis's
 * first and last day, when not the domain's; [xLabels]: the axis's words instead of dates. [avg]: a dashed
 * grey average line. [onTap]: a tap (a short press that hardly moves) on a point, by the index of its reading.
 * [pan]: it moves through time. With nothing to draw it says so, and can still be swiped.
 */
export function Chart({ series, domain, today, height = 150, fmt = String, invert = false, zero = false, top, rings = [], reads, onRead, labels, xLabels, avg, onTap, pan }: {
  series: Series[]; domain: [number, number]; today: number; height?: number; fmt?: (v: number) => string; invert?: boolean; zero?: boolean; top?: number;
  rings?: Pt[]; reads: readonly number[]; onRead: (i: number | null) => void; labels?: [number, number]; onTap?: (i: number) => void;
  xLabels?: { day: number; text: string; anchor: "start" | "middle" | "end" }[]; avg?: number | null; pan?: Pan;
}) {
  const [box, w] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const atRef = useRef<number | null>(null);
  /** The reading kept after the finger lifted (or the mouse clicked); a mouse's hover goes back to it. */
  const kept = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);
  const [reading, setReading] = useState(false);
  const press = useRef<Press | null>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const panRef = useRef(pan);
  panRef.current = pan;
  /** The part that moves with a swipe. */
  const plot = useRef<HTMLDivElement>(null);
  const stopAnim = useRef<(() => void) | null>(null);
  /** This chart's own swipe made the step: it already slid out, so it comes in by itself. */
  const own = useRef(false);
  const write = useRef(frameWriter((x: number) => { if (plot.current) plot.current.style.transform = x ? `translate3d(${x}px,0,0)` : ""; })).current;
  const all = series.flatMap((s) => (s.kind === "band" ? s.pts.flatMap((p) => [p.lo, p.hi]) : s.pts.map((p) => p.v))).concat(rings.map((p) => p.v));
  const barSeries = series.find((s) => s.kind === "bars");
  const bars = !!barSeries;
  /** A bar stands from its day over its span: the cursor goes to its middle. */
  const halfAt = (day: number) => (barSeries?.kind === "bars" ? (barSeries.pts.find((p) => p.day === day)?.span ?? barSeries.span ?? 7) / 2 : 0);
  const lo = all.length ? Math.min(...all, ...(zero || bars ? [0] : [])) : 0, hi = all.length ? Math.max(...all, top ?? -Infinity) : 1;
  const ticks = niceTicks(lo, hi, 3);
  const [d0, d1] = domain;
  const x = scale(d0, d1, L, Math.max(L + 1, w - R));
  const y = scale(ticks.lo, ticks.hi, ...(invert ? [T, height - B] : [height - B, T]) as [number, number]);
  const base = y(invert ? ticks.hi : ticks.lo);

  /** Shows reading [i] (null: none, the card shows its latest); a tick when a finger reaches a new point. */
  const show = (i: number | null, tick = false) => {
    if (i === atRef.current) return;
    atRef.current = i;
    setAt(i);
    if (tick && i !== null) feel("tick");
    onReadRef.current(i);
  };
  const forget = () => { kept.current = null; setHolding(false); show(null); };
  const nearestAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return nearestIndex(reads, d0 + ((clientX - r.left - L) / Math.max(1, w - L - R)) * (d1 - d0));
  };
  const read = (clientX: number) => { if (reads.length && w > 0) show(nearestAt(clientX), true); };
  /** Whether a tap at [clientX] lands on reading [i]: within 24 px of it across. */
  const onPoint = (i: number, clientX: number) => Math.abs(x(reads[i] + halfAt(reads[i])) - (clientX - box.current!.getBoundingClientRect().left)) <= 24;

  // Once a hold reads or a swipe moves the chart, the browser mustn't take the finger for a scroll. Only listened
  // to then, so plain scrolling never waits on the page's script.
  const noScroll = useRef((e: TouchEvent) => { if (e.cancelable) e.preventDefault(); }).current;
  const lockScroll = (on: boolean) => {
    if (on) box.current?.addEventListener("touchmove", noScroll, { passive: false });
    else box.current?.removeEventListener("touchmove", noScroll);
  };
  const glide = (from: number, to: number, v: number, done?: () => void) => {
    stopAnim.current = spring(from, to, v, write, () => { stopAnim.current = null; done?.(); });
  };
  /** Lets a swipe go at [dx] px and [v] px/ms: a whole window that way ([dir]), or back to where it was. */
  const settle = (dir: -1 | 0 | 1, dx: number, v: number) => {
    write.cancel();
    if (!dir) { glide(dx, 0, v); return; }
    const off = dir * ((box.current?.clientWidth ?? w) + 12);
    glide(dx, off, v, () => {
      own.current = true;
      forget();
      flushSync(() => panRef.current?.step(dir));
      write(-off);
      glide(-off, 0, 0);
    });
  };
  const endPress = (p: Press) => { clearTimeout(p.timer); press.current = null; lockScroll(false); setReading(false); };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    const mouse = e.pointerType === "mouse";
    if (mouse && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p: Press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, lastX: e.clientX, moved: false, mouse, mode: pan ? "wait" : "read", timer: 0, dx: 0, vt: new VelocityTracker() };
    p.vt.add(e.timeStamp, e.clientX);
    press.current = p;
    if (!pan || mouse) { read(e.clientX); return; }
    forget();
    p.timer = window.setTimeout(() => {
      if (press.current !== p || p.mode !== "wait" || !reads.length) return;
      p.mode = "read";
      lockScroll(true);
      setReading(true);
      feel("pickup");
      read(p.lastX);
    }, HOLD);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) { if (e.pointerType === "mouse") read(e.clientX); return; }
    if (e.pointerId !== p.id) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.lastX = e.clientX;
    p.vt.addEvent(e.nativeEvent, "x");
    if (Math.hypot(dx, dy) > TOUCH_SLOP) p.moved = true;
    if (p.mode === "wait") {
      if (Math.abs(dx) > TOUCH_SLOP && Math.abs(dx) >= Math.abs(dy)) {
        clearTimeout(p.timer);
        p.mode = "pan";
        p.x += Math.sign(dx) * TOUCH_SLOP; // like the pagers, the drag starts from where the slop ran out
        claimSwipe(p.id);
        lockScroll(true);
        forget();
        stopAnim.current?.();
        stopAnim.current = null;
      } else if (Math.abs(dy) > TOUCH_SLOP && !p.mouse) {
        clearTimeout(p.timer);
        p.mode = "off"; // a scroll
      } else if (p.mouse) read(e.clientX);
    }
    if (p.mode === "pan") {
      const d = e.clientX - p.x, open = d > 0 ? panRef.current?.canBack : panRef.current?.canFwd;
      p.dx = open ? d : rubberBand(d, w);
      write(p.dx);
    } else if (p.mode === "read") read(e.clientX);
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return; // a press that started off the chart
    endPress(p);
    if (p.mode === "off") return;
    if (p.mode === "pan") {
      swallowClick(400);
      const v = p.vt.velocity(e.timeStamp), o = panRef.current;
      settle(panTarget(p.dx, v, !!o?.canBack, !!o?.canFwd), p.dx, v);
      return;
    }
    const tap = !p.moved && e.timeStamp - p.t < 500;
    if (p.mode === "wait" && !p.mouse) { // a plain tap: the reading already went
      if (onTap && tap && reads.length) { const i = nearestAt(e.clientX); if (onPoint(i, e.clientX)) onTap(i); }
      return;
    }
    // The reading stays where the finger lifted (it's already on the nearest point).
    const i = atRef.current;
    kept.current = i;
    setHolding(i !== null);
    if (onTap && tap && i !== null && onPoint(i, e.clientX)) onTap(i);
  };
  // A mouse leaving (or a touch that ends after lifting) goes back to the kept reading, not to none.
  const leave = () => { if (!press.current) show(kept.current); };
  const cancel = () => {
    const p = press.current;
    if (!p) return;
    endPress(p);
    if (p.mode === "pan") settle(0, p.dx, 0); else show(kept.current);
  };
  const keys = (e: React.KeyboardEvent) => {
    const o = panRef.current;
    if (!o || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === "ArrowLeft" && o.canBack) o.step(1);
    else if (e.key === "ArrowRight" && o.canFwd) o.step(-1);
    else if (e.key === "Home" && o.back > 0) o.now();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // While a reading is kept, a press anywhere off the chart goes back to the latest.
  useEffect(() => {
    if (!holding) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) forget(); };
    document.addEventListener("pointerdown", off, true);
    return () => document.removeEventListener("pointerdown", off, true);
  }, [holding]); // eslint-disable-line react-hooks/exhaustive-deps
  // New readings (another range or window, a weigh-in added): the old index means nothing, so back to the latest.
  const readsKey = reads.join(",");
  useLayoutEffect(() => { if (kept.current !== null || atRef.current !== null) forget(); }, [readsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Moved from outside (‹ ›, Back to now, another chart on the card): the window slides in from its side.
  const shownAt = useRef(pan && { id: pan.id, back: pan.back });
  useLayoutEffect(() => {
    const was = shownAt.current;
    shownAt.current = pan && { id: pan.id, back: pan.back };
    const mine = own.current;
    own.current = false;
    if (!pan || !was || was.id !== pan.id || was.back === pan.back || mine) return;
    const from = (pan.back > was.back ? -1 : 1) * ((box.current?.clientWidth ?? w) + 12);
    stopAnim.current?.();
    write(from);
    write.flush();
    glide(from, 0, 0);
  }, [pan?.id, pan?.back]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopAnim.current?.(); write.cancel(); const p = press.current; if (p) clearTimeout(p.timer); lockScroll(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const drawn: React.ReactNode[] = [];
  series.forEach((s, k) => {
    if (s.kind === "band") {
      if (s.pts.length > 1) {
        const top = s.pts.map((p, i) => `${i ? "L" : "M"}${x(p.day)},${y(p.hi)}`).join("");
        const bottom = [...s.pts].reverse().map((p) => `L${x(p.day)},${y(p.lo)}`).join("");
        drawn.unshift(<path key={`${k}n`} d={`${top}${bottom}Z`} fill={s.color} fillOpacity={0.14} />);
      }
      return;
    }
    if (s.kind === "bars") {
      s.pts.forEach((p, i) => {
        if (p.v <= 0) return;
        const span = p.span ?? s.span ?? 7;
        const bw = Math.max(1, Math.min(s.maxW ?? 24, (x(d0 + span) - x(d0)) - 2));
        const cx = x(p.day + span / 2), top = y(p.v), r = Math.min(4, bw / 2, (base - top) / 2);
        drawn.push(<path key={`${k}b${i}`} fill={s.color} fillOpacity={p.dim ? 0.45 : undefined}
          d={`M${cx - bw / 2},${base}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${base}Z`} />);
      });
      return;
    }
    if (s.kind === "line" && s.pts.length) {
      const gap = s.gap ?? Infinity;
      const path = s.pts.map((p, i) => `${i && p.day - s.pts[i - 1].day <= gap ? "L" : "M"}${x(p.day)},${y(p.v)}`).join("");
      if (s.area && s.pts.length > 1) {
        drawn.push(<path key={`${k}a`} d={`M${x(s.pts[0].day)},${base}${path.replace(/^M/, "L")}L${x(s.pts[s.pts.length - 1].day)},${base}Z`} fill={s.color} fillOpacity={0.1} />);
      }
      drawn.push(<path key={`${k}l`} d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />);
    }
    if (s.kind === "line" && s.dots === false) return;
    const r = s.kind === "dots" ? s.r ?? 4 : 4;
    s.pts.forEach((p, i) => {
      const cx = x(p.day), cy = y(p.v);
      if (p.mark === "lower") {
        // A lower bound: a small triangle pointing up (the real max was at least this).
        drawn.push(<path key={`${k}d${i}`} className="pg-ring" d={`M${cx},${cy - 5.5}L${cx + 5},${cy + 3.5}L${cx - 5},${cy + 3.5}Z`} fill={s.color} strokeWidth={1.5} strokeLinejoin="round" />);
      } else if (p.mark === "hollow") {
        drawn.push(<circle key={`${k}d${i}`} cx={cx} cy={cy} r={r} className="pg-fill" stroke={s.color} strokeWidth={2} />);
      } else {
        drawn.push(<circle key={`${k}d${i}`} cx={cx} cy={cy} r={r} className="pg-ring" fill={s.color} strokeWidth={2} />);
      }
    });
  });
  const [l0, l1] = labels ?? domain;

  return (
    <div className={`pg-chart ${pan ? "pans" : ""} ${reading ? "reading" : ""}`} ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={leave}
      onContextMenu={(e) => e.preventDefault()} onKeyDown={keys} tabIndex={pan && (pan.canBack || pan.canFwd) ? 0 : undefined} aria-label={pan ? `Chart, ${pan.label}. The left and right arrows move it through time.` : undefined}>
      <div className="pg-plot" ref={plot}>
        {!all.length ? <div className="pg-none" style={{ height }}>Nothing in this range.</div> : w > 0 && (
          <svg width={w} height={height}>
            {ticks.ticks.map((t) => <g key={t}>
              <line className="pg-grid" x1={L} x2={w - R} y1={y(t)} y2={y(t)} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>
            </g>)}
            {xLabels ? xLabels.map((l) => <text key={l.day} x={x(l.day)} y={height - 5} textAnchor={l.anchor}>{l.text}</text>) : <>
              <text x={x(l0)} y={height - 5} textAnchor="start">{dayMonth(l0, today)}</text>
              {l1 !== l0 && <text x={x(l1)} y={height - 5} textAnchor="end">{dayMonth(l1, today)}</text>}
            </>}
            {avg != null && <line x1={L} x2={w - R} y1={y(avg)} y2={y(avg)} stroke={GREY} strokeWidth={1} strokeDasharray="3 3" />}
            {drawn}
            {rings.map((p, i) => <circle key={`p${i}`} cx={x(p.day)} cy={y(p.v)} r={8} fill="none" stroke={PAIN} strokeWidth={2} />)}
            {at !== null && reads[at] !== undefined && <line className="pg-cursor" x1={x(reads[at] + halfAt(reads[at]))} x2={x(reads[at] + halfAt(reads[at]))} y1={T} y2={height - B} />}
          </svg>
        )}
      </div>
    </div>
  );
}

/** The ‹ › and the window's dates over a chart that moves through time: they show that it can, and they're the mouse's way. */
export function PanBar({ pan }: { pan: Pan }) {
  const step = (dir: 1 | -1) => { feel("tick"); pan.step(dir); };
  return (
    <div className="pg-pnav">
      <button className="pg-pb" aria-label="Earlier" disabled={!pan.canBack} onClick={() => step(1)}><MIcon name="fKeyboardArrowLeft" size={24} /></button>
      <div className="pl">{pan.label}</div>
      <button className="pg-pb" aria-label="Later" disabled={!pan.canFwd} onClick={() => step(-1)}><MIcon name="fKeyboardArrowRight" size={24} /></button>
    </div>
  );
}

/** Shown only when a chart has moved away from now. */
export const BackToNow = ({ pan }: { pan: Pan }) => (pan.back > 0 ? <button className="pg-nowc" onClick={() => { feel("tick"); pan.now(); }}>Back to now</button> : null);

/**
 * A list row's small line (the last reading dotted) or bars, from oldest to newest; [invert]: low at the top.
 * [days]: the readings' days, so a line is spaced by time and breaks over more than [gap] days without one (266).
 */
export function Spark({ values, color, bars = false, invert = false, days, gap = Infinity }: {
  values: readonly number[]; color: string; bars?: boolean; invert?: boolean; days?: readonly number[]; gap?: number;
}) {
  const W = 74, H = 26;
  if (!values.length) return <svg className="pg-spark" width={W} height={H} aria-hidden />;
  const mn = Math.min(...values, ...(bars ? [0] : [])), mx = Math.max(...values);
  const f = (v: number) => { const k = (v - mn) / (mx - mn || 1); return invert ? 1 - k : k; };
  if (bars) {
    const bw = Math.max(2, Math.min(10, 70 / values.length - 3));
    return (
      <svg className="pg-spark" width={W} height={H} aria-hidden>
        {values.map((v, i) => { const h = v > 0 ? Math.max(1, 20 * f(v)) : 0; return <rect key={i} x={3 + 68 * (i + 0.5) / values.length - bw / 2} y={23 - h} width={bw} height={h} rx={2} fill={color} />; })}
      </svg>
    );
  }
  const d0 = days?.[0] ?? 0, span = days ? days[days.length - 1] - d0 : values.length - 1;
  const X = (i: number) => (span <= 0 ? 71 : 3 + 68 * ((days ? days[i] - d0 : i) / span)), Y = (v: number) => 22 - 18 * f(v);
  const last = values.length - 1;
  const cut = (i: number) => !!days && days[i] - days[i - 1] > gap;
  return (
    <svg className="pg-spark" width={W} height={H} aria-hidden>
      {values.length > 1 && <path d={values.map((v, i) => `${i && !cut(i) ? "L" : "M"}${X(i)},${Y(v)}`).join("")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      <circle cx={X(last)} cy={Y(values[last])} r={3.5} fill={color} className="pg-ring-bg" strokeWidth={2} />
    </svg>
  );
}

/**
 * A Body tile's small chart (270): the shape only, spaced by time over [domain]. Not read by touch: a tap on the
 * tile opens its card, a swipe turns the tab. A line (breaking over more than [gap] days, the last reading
 * ringed, [dots] under it), or a bar per day with [avg] dashed; [dimLast]: the last bar is still filling.
 */
export function MiniChart({ kind, pts, domain, color, height, gap = Infinity, dots, dotColor, avg, dimLast = false }: {
  kind: "line" | "bars"; pts: readonly { day: number; v: number }[]; domain: [number, number]; color: string; height: number; gap?: number;
  dots?: readonly { day: number; v: number }[]; dotColor?: string; avg?: number | null; dimLast?: boolean;
}) {
  const [box, w] = useWidth<HTMLDivElement>();
  const all = [...pts, ...(dots ?? [])].map((p) => p.v);
  const bars = kind === "bars";
  const lo = bars ? 0 : Math.min(...all), hi = Math.max(...all, avg ?? -Infinity);
  const x = scale(domain[0], domain[1] + (bars ? 1 : 0), bars ? 1 : 3, Math.max(4, w - (bars ? 1 : 6)));
  const y = scale(lo, hi === lo ? lo + 1 : hi, height - (bars ? 1 : 5), bars ? 2 : 5);
  const bw = Math.max(2, Math.min(14, x(domain[0] + 1) - x(domain[0]) - 2));
  const end = pts[pts.length - 1];
  return (
    <div className="pg-mchart" ref={box}>
      {w > 0 && pts.length > 0 && (
        <svg width={w} height={height} aria-hidden>
          {dots?.map((p, i) => <circle key={i} cx={x(p.day)} cy={y(p.v)} r={2} fill={dotColor} />)}
          {avg != null && <line x1={0} x2={w} y1={y(avg)} y2={y(avg)} stroke={GREY} strokeWidth={1} strokeDasharray="3 3" />}
          {bars
            ? pts.map((p, i) => <rect key={i} x={x(p.day + 0.5) - bw / 2} y={y(p.v)} width={bw} height={Math.max(1, y(0) - y(p.v))} rx={Math.min(3, bw / 2)} fill={color} fillOpacity={dimLast && i === pts.length - 1 ? 0.45 : undefined} />)
            : <>
              {pts.length > 1 && <path d={pts.map((p, i) => `${i && p.day - pts[i - 1].day <= gap ? "L" : "M"}${x(p.day)},${y(p.v)}`).join("")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              <circle cx={x(end.day)} cy={y(end.v)} r={3.5} fill={color} className="pg-mring" strokeWidth={2} />
            </>}
        </svg>
      )}
    </div>
  );
}

/** 1M · 3M · 6M · 1Y · All, or the [options] given (Cardio's add 1W). */
export function RangeSwitch<K extends string = RangeKey>({ value, onChange, options = RANGES as unknown as [K, string][] }: { value: K; onChange: (k: K) => void; options?: [K, string][] }) {
  return <div className="pg-range"><Segmented value={value} options={options} onChange={(k) => { feel("tick"); onChange(k); }} /></div>;
}

/** Cardio's six ranges in the top row (294 option B): one button showing the choice, and a tap opens the list. */
export function RangeMenu({ value, onChange }: { value: WindowKey; onChange: (k: WindowKey) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  /** Opened from the keyboard: the current choice takes the focus, and the arrows move through the list. */
  const byKey = useRef(false);
  useEffect(() => {
    if (!open || !byKey.current) return;
    byKey.current = false;
    const id = requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(".p-menu-tick")?.closest("button")?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  const keys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLElement && !e.target.closest(".p-menu")) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); byKey.current = true; setOpen(true); }
      return;
    }
    if (e.key === "Escape") { setOpen(false); box.current?.querySelector<HTMLElement>(".pg-rbtn")?.focus(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...(box.current?.querySelectorAll<HTMLElement>(".p-menu button") ?? [])], i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
  };
  return (
    <div className="p-menu-anchor pg-rmenu" ref={box} onKeyDown={keys}>
      <button className="pg-rbtn" aria-haspopup="menu" aria-expanded={open} aria-label={`Range: ${WINDOW_NAMES[value]}`} onClick={() => { feel("tick"); setOpen(!open); }}>
        {value}<MIcon name="fExpandMore" size={20} />
      </button>
      <DropdownMenu open={open} onClose={() => setOpen(false)}
        items={WINDOWS.map(([k]) => ({ label: WINDOW_NAMES[k], checked: k === value, onClick: () => { feel("tick"); onChange(k); } }))} />
    </div>
  );
}
