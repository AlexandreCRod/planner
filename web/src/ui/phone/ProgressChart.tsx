// The Progress charts (TrainingProgress.tsx): a time chart that a finger reads, a list row's sparkline, and
// the range switch. Drawn as SVG at the card's real width, so text and dots keep their size in a wide window.
// The chart rules (handover, 2.8): 2 px lines, dots of at least 8 px with a ring of the card's colour, bars
// at most 24 px wide with 4 px rounded tops, hairline grid, one value axis, text never in a series colour.
// Touching or sliding on a chart reads the point nearest the finger, one tick for each new point.
import { useLayoutEffect, useRef, useState } from "react";
import { Segmented } from "./chrome.tsx";
import { type RangeKey, RANGES, dayMonth, nearestIndex, niceTicks, scale } from "./chartMath.ts";
import { feel } from "./haptics.ts";

/** The series colours, validated on the dark surface (dataviz skill); in step with the Training kinds. */
export const GYM = "#bf8a2a", GYM_DIM = "#7a5c22", RUN = "#33a390", WEIGHT = "#6a8ed4", WEIGHT_DIM = "#5d6475", PAIN = "#d9664f";

/** One reading. [mark]: drawn hollow (an assumed RPE) or as a lower bound (history with no RPE). */
export interface Pt { day: number; v: number; mark?: "hollow" | "lower" }
export type Series =
  | { kind: "line"; pts: Pt[]; color: string; area?: boolean; dots?: boolean }
  | { kind: "dots"; pts: Pt[]; color: string; r?: number }
  /** One bar per [span] days from its day (a week by default). */
  | { kind: "bars"; pts: Pt[]; color: string; span?: number };

const L = 36, R = 10, T = 8, B = 22;

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
 * gets the index of the one nearest the finger, and null when it lets go. [rings]: pain, as a ring around the
 * point. [fmt] writes the value axis; [invert] puts low values at the top (pace: faster is higher). [zero]
 * starts the axis at 0 (bars always do). [labels]: the axis's first and last day, when not the domain's.
 */
export function Chart({ series, domain, today, height = 150, fmt = String, invert = false, zero = false, rings = [], reads, onRead, labels }: {
  series: Series[]; domain: [number, number]; today: number; height?: number; fmt?: (v: number) => string; invert?: boolean; zero?: boolean;
  rings?: Pt[]; reads: readonly number[]; onRead: (i: number | null) => void; labels?: [number, number];
}) {
  const [box, w] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const atRef = useRef<number | null>(null);
  const all = series.flatMap((s) => s.pts.map((p) => p.v)).concat(rings.map((p) => p.v));
  const bars = series.some((s) => s.kind === "bars");
  const lo = all.length ? Math.min(...all, ...(zero || bars ? [0] : [])) : 0, hi = all.length ? Math.max(...all) : 1;
  const ticks = niceTicks(lo, hi, 3);
  const [d0, d1] = domain;
  const x = scale(d0, d1, L, Math.max(L + 1, w - R));
  const y = scale(ticks.lo, ticks.hi, ...(invert ? [T, height - B] : [height - B, T]) as [number, number]);
  const base = y(invert ? ticks.hi : ticks.lo);

  const read = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!reads.length || w === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const day = d0 + ((e.clientX - r.left - L) / Math.max(1, w - L - R)) * (d1 - d0);
    const i = nearestIndex(reads, day);
    if (i === atRef.current) return;
    atRef.current = i;
    setAt(i);
    feel("tick");
    onRead(i);
  };
  const leave = () => { if (atRef.current === null) return; atRef.current = null; setAt(null); onRead(null); };

  const drawn: React.ReactNode[] = [];
  series.forEach((s, k) => {
    if (s.kind === "bars") {
      const span = s.span ?? 7;
      const bw = Math.max(1, Math.min(24, (x(d0 + span) - x(d0)) - 2));
      s.pts.forEach((p, i) => {
        if (p.v <= 0) return;
        const cx = x(p.day + span / 2), top = y(p.v), r = Math.min(4, bw / 2, (base - top) / 2);
        drawn.push(<path key={`${k}b${i}`} fill={s.color}
          d={`M${cx - bw / 2},${base}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${base}Z`} />);
      });
      return;
    }
    if (s.kind === "line" && s.pts.length) {
      const path = s.pts.map((p, i) => `${i ? "L" : "M"}${x(p.day)},${y(p.v)}`).join("");
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
    <div className="pg-chart" ref={box}>
      {w > 0 && (
        <svg width={w} height={height} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); read(e); }} onPointerMove={read}
          onPointerUp={leave} onPointerCancel={leave} onPointerLeave={leave}>
          {ticks.ticks.map((t) => <g key={t}>
            <line className="pg-grid" x1={L} x2={w - R} y1={y(t)} y2={y(t)} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>
          </g>)}
          <text x={x(l0)} y={height - 5} textAnchor="start">{dayMonth(l0, today)}</text>
          {l1 !== l0 && <text x={x(l1)} y={height - 5} textAnchor="end">{dayMonth(l1, today)}</text>}
          {drawn}
          {rings.map((p, i) => <circle key={`p${i}`} cx={x(p.day)} cy={y(p.v)} r={8} fill="none" stroke={PAIN} strokeWidth={2} />)}
          {at !== null && reads[at] !== undefined && <line className="pg-cursor" x1={x(reads[at] + (bars ? 3.5 : 0))} x2={x(reads[at] + (bars ? 3.5 : 0))} y1={T} y2={height - B} />}
        </svg>
      )}
    </div>
  );
}

/** A list row's small line (the last reading dotted) or bars, from oldest to newest; [invert]: low at the top. */
export function Spark({ values, color, bars = false, invert = false }: { values: readonly number[]; color: string; bars?: boolean; invert?: boolean }) {
  const W = 74, H = 26;
  if (!values.length) return <svg className="pg-spark" width={W} height={H} aria-hidden />;
  const mn = Math.min(...values, ...(bars ? [0] : [])), mx = Math.max(...values);
  const f = (v: number) => { const k = (v - mn) / (mx - mn || 1); return invert ? 1 - k : k; };
  if (bars) {
    const bw = Math.max(2, Math.min(10, 70 / values.length - 3));
    return (
      <svg className="pg-spark" width={W} height={H} aria-hidden>
        {values.map((v, i) => { const h = Math.max(1, 20 * f(v)); return <rect key={i} x={3 + 68 * (i + 0.5) / values.length - bw / 2} y={23 - h} width={bw} height={h} rx={2} fill={color} />; })}
      </svg>
    );
  }
  const X = (i: number) => (values.length === 1 ? 71 : 3 + 68 * i / (values.length - 1)), Y = (v: number) => 22 - 18 * f(v);
  const last = values.length - 1;
  return (
    <svg className="pg-spark" width={W} height={H} aria-hidden>
      {values.length > 1 && <path d={values.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join("")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      <circle cx={X(last)} cy={Y(values[last])} r={3.5} fill={color} className="pg-ring-bg" strokeWidth={2} />
    </svg>
  );
}

/** 1M · 3M · 6M · 1Y · All. */
export function RangeSwitch({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  return <div className="pg-range"><Segmented value={value} options={RANGES} onChange={(k) => { feel("tick"); onChange(k); }} /></div>;
}
