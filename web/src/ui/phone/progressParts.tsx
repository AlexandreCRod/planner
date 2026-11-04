// What Progress's tabs share (TrainingProgress.tsx, TrainingCardio.tsx): number formats, a chart card with its
// headline, a stat tile, and a row or tile a keyboard can open.
import type { ReactNode } from "react";
import { sourceName } from "../../domain/trends.ts";
import { type Pan, BackToNow, PanBar } from "./ProgressChart.tsx";

/** "6:10" from seconds. */
export const mmss = (s: number) => { const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`; };
/** "16", "13.1": km to 0.1. */
export const km1 = (km: number) => String(Math.round(km * 10) / 10);
/** "6.4", "16.0": km to 0.1, the decimal always written. */
export const kmFixed = (km: number) => km.toFixed(1);
/** "+0.2", "−1.4", "0": to 0.1, with its sign. */
export const signed1 = (v: number) => { const r = Math.round(v * 10) / 10; return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : "0"; };
export const from = (source: string | null) => { const n = sourceName(source); return n ? `from ${n}` : ""; };
export const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ");

/** Opens on a tap, a click, Enter or Space: for a row or tile that isn't a real button. */
export const tapProps = (open: () => void) => ({
  role: "button", tabIndex: 0, onClick: open,
  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
});

/**
 * A chart card: its title (and [side], beside it), the headline (its number, or the day a finger read on the
 * chart, kept after it lifts until a tap off the chart: [read] gives its two lines), the chart and what's under it.
 * [pan]: the chart moves through time, so the ‹ › and the window's dates go above the headline. [tall]: room
 * for a long chip on its own line under the number (it keeps the height, so a reading doesn't move the chart).
 */
export function ChartCard({ title, side, head, read, children, foot, pan, tall }: {
  title: string; side?: ReactNode; head: ReactNode; read: [string, ReactNode] | null; children: ReactNode; foot?: ReactNode; pan?: Pan; tall?: boolean;
}) {
  return (
    <div className="pg-card">
      <div className={`pg-ct ${pan ? "pans" : ""}`}><span>{title}</span>{pan && <BackToNow pan={pan} />}{side}</div>
      {pan && <PanBar pan={pan} />}
      <div className={`pg-cardhead ${tall ? "tall" : ""}`}>{read ? <div className="pg-ro"><div className="a">{read[0]}</div><div className="b">{read[1]}</div></div> : head}</div>
      {children}
      {foot}
    </div>
  );
}

/** The headline: a big number, a small word after it, and a chip with the change. */
export const Head = ({ value, unit, chip }: { value: string; unit: string; chip?: string | null }) => (
  <div className="pg-hv">{value}<small>{unit}</small>{chip && <span className="pg-hchip">{chip}</span>}</div>
);

/** A stat tile: its name, its number and the line under it. */
export const Tile = ({ a, b, c }: { a: string; b: ReactNode; c: string }) => (
  <div className="pg-tile"><div className="a">{a}</div><div className="b">{b}</div><div className="c">{c}</div></div>
);
