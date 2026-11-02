// One night (308, mockup 2.8.6 section 4), from Progress → Sleep: the hours, bed and wake times, a stepped chart of
// awake, REM, light and deep, and the time in each stage against the usual. A slide reads the stage at once, with no
// hold: a night has nothing to swipe to. A mouse reads on hover; on the keyboard ← → step through the stretches. A
// night with totals only keeps the page, with a grey band for its chart and its totals. The numbers come from
// domain/sleep.ts.
import { useEffect, useRef, useState } from "react";
import { dayShort, formatDate, weekday } from "../../domain/dates.ts";
import { type NightSpan, type SleepNight, NIGHT_STAGES, clockAfter, clockChange, clockOfMoment, fmtSleep, inBedMin, nightTotals, spanAt, usualNight } from "../../domain/sleep.ts";
import type { Training } from "../../store/training.ts";
import { dayMonth, scale } from "./chartMath.ts";
import { EmptyState, MIcon } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { GREY, STAGE_COLOURS, STAGE_NAMES, useWidth } from "./ProgressChart.tsx";
import { join } from "./progressParts.tsx";

/** "Last night" for this morning's, else "Sat night", by the evening it began. */
export const nightWord = (day: number, t: number) => (day === t ? "Last night" : `${dayShort(weekday(day - 1))} night`);

/** The night as a thin strip, by its stretches; grey with totals only. */
export function NightStrip({ n }: { n: SleepNight }) {
  return <span className="pg-nstrip">{n.spans.map((x, i) => <i key={i} style={{ flex: x.to - x.from, background: STAGE_COLOURS[x.stage] }} />)}</span>;
}

const L = 46, R = 6, T = 4, LANE = 34, BELOW = 22, BAR = 18;
const laneY = (stage: NightSpan["stage"]) => T + LANE * NIGHT_STAGES.indexOf(stage) + LANE / 2;
/** Hour labels every 2 h, kept this far from the bed and wake times. */
const TICK = 120, CLEAR = 34;

/** The stepped chart: each stretch a block on its stage's row, thin lines joining them. */
function NightChart({ n, bed, wake }: { n: SleepNight; bed: string; wake: string }) {
  const [box, w] = useWidth<HTMLDivElement>();
  const spans = n.spans, len = Math.max(inBedMin(bed, wake), spans[spans.length - 1].to);
  const change = clockChange(bed, wake);
  const [at, setAt] = useState<number | null>(null);
  const atRef = useRef<number | null>(null);
  const down = useRef(false);
  const X = scale(0, len, L, Math.max(L + 1, w - R));
  const show = (i: number | null) => {
    if (i === atRef.current) return;
    atRef.current = i;
    setAt(i);
    if (i !== null) feel("tick");
  };
  const read = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    show(spanAt(spans, ((clientX - r.left - L) / Math.max(1, w - L - R)) * len));
  };
  // The reading stays where the finger lifts, until a press off the chart.
  useEffect(() => {
    if (at === null) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) show(null); };
    document.addEventListener("pointerdown", off, true);
    return () => document.removeEventListener("pointerdown", off, true);
  }, [at === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    show(Math.max(0, Math.min(spans.length - 1, atRef.current === null ? (step > 0 ? 0 : spans.length - 1) : atRef.current + step)));
  };
  const a = at !== null ? spans[at] : null;
  const first = Math.ceil((Number(bed.slice(11, 13)) * 60 + Number(bed.slice(14, 16))) / TICK) * TICK - (Number(bed.slice(11, 13)) * 60 + Number(bed.slice(14, 16)));
  const hours: number[] = [];
  for (let m = first; m < len; m += TICK) if (X(m) - X(0) > CLEAR && X(len) - X(m) > CLEAR) hours.push(m);
  const h = T + LANE * 4 + BELOW;
  return <>
    <div className="pg-nread">
      {a ? <><i style={{ background: STAGE_COLOURS[a.stage] }} /><b>{STAGE_NAMES[a.stage]}</b><span>{clockAfter(bed, a.from, change)}–{clockAfter(bed, a.to, change)} · {fmtSleep(a.to - a.from)}</span></>
        : <span>Slide along the chart to read it</span>}
    </div>
    <div className="pg-chart night" ref={box} tabIndex={0} role="group" aria-label={`The night from ${clockOfMoment(bed)} to ${clockOfMoment(wake)}. The left and right arrows step through its stages.`}
      onPointerDown={(e) => { if (e.pointerType === "mouse" && e.button) return; down.current = true; e.currentTarget.setPointerCapture(e.pointerId); read(e.clientX); }}
      onPointerMove={(e) => { if (down.current || e.pointerType === "mouse") read(e.clientX); }}
      onPointerUp={() => { down.current = false; }} onPointerCancel={() => { down.current = false; }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse" && !down.current) show(null); }}
      onContextMenu={(e) => e.preventDefault()} onKeyDown={keys}>
      {w > 0 && (
        <svg width={w} height={h} className={a ? "rd" : ""} aria-hidden>
          {NIGHT_STAGES.map((k, i) => <g key={k}>
            <line className="pg-grid" x1={L} x2={w - R} y1={T + LANE * (i + 1)} y2={T + LANE * (i + 1)} />
            <text className="lane" x={0} y={laneY(k) + 4}>{STAGE_NAMES[k]}</text>
          </g>)}
          {hours.map((m) => <text key={m} x={X(m)} y={h - 5} textAnchor="middle">{clockAfter(bed, m, change)}</text>)}
          <text className="end" x={L} y={h - 5} textAnchor="start">{clockOfMoment(bed)}</text>
          <text className="end" x={w - R} y={h - 5} textAnchor="end">{clockOfMoment(wake)}</text>
          {spans.slice(0, -1).map((x, i) => <line key={i} className="sp" x1={X(x.to)} x2={X(x.to)} y1={laneY(x.stage)} y2={laneY(spans[i + 1].stage)} stroke={GREY} strokeWidth={1} />)}
          {spans.map((x, i) => {
            const wd = Math.max(2, X(x.to) - X(x.from));
            return <rect key={i} className={`sp ${i === at ? "on" : ""}`} x={X(x.from)} y={laneY(x.stage) - BAR / 2} width={wd} height={BAR} rx={wd > 8 ? 3 : 1} fill={STAGE_COLOURS[x.stage]} />;
          })}
          {a && <line className="pg-cursor" x1={X((a.from + a.to) / 2)} x2={X((a.from + a.to) / 2)} y1={T} y2={T + LANE * 4} />}
        </svg>
      )}
    </div>
  </>;
}

/** Time in each stage: a strip of the shares, then a row each with the usual beside it. */
function StageCard({ n, usual }: { n: SleepNight; usual: ReturnType<typeof usualNight>["stages"] }) {
  const tot = nightTotals(n);
  if (!tot) return null;
  const sum = NIGHT_STAGES.reduce((a, k) => a + tot[k], 0) || 1;
  return (
    <div className="pg-card">
      <div className="pg-ct"><span>Time in each stage</span>{usual && <span>usual</span>}</div>
      <div className="pg-seg8">{NIGHT_STAGES.filter((k) => tot[k] > 0).map((k) => <i key={k} style={{ flex: tot[k], background: STAGE_COLOURS[k] }} />)}</div>
      {NIGHT_STAGES.map((k) => (
        <div key={k} className="pg-strow">
          <i style={{ background: STAGE_COLOURS[k] }} /><span className="nm">{STAGE_NAMES[k]}</span>
          <span className="pc">{Math.round((tot[k] / sum) * 100)}%</span><span className="du">{fmtSleep(tot[k])}</span>
          {usual && <span className="us">{fmtSleep(usual[k])}</span>}
        </div>
      ))}
    </div>
  );
}

/** The night on the morning of [day]; the ‹ › go to the nights either side ([onGo]). */
export function NightCards({ tr, day, t, onGo }: { tr: Training; day: number; t: number; onGo: (day: number) => void }) {
  const list = tr.sleep.filter((x) => x.totalMin !== null);
  const i = list.findIndex((x) => x.day === day);
  if (i < 0) return <EmptyState icon="oNightsStay" title="This night isn't here any more" />;
  const n = list[i], prev = list[i - 1], next = list[i + 1];
  const usual = usualNight(tr.sleep, day);
  const diff = usual.asleep !== null ? n.totalMin! - usual.asleep : null;
  const timed = !!n.bed && !!n.wake;
  const reason = n.source === "garmin" ? "No timeline for this night: it came from the Garmin export, which only has totals." : "No timeline for this night: the watch only sent its totals.";
  return <>
    <div className="pg-nnav">
      <button className="pg-pb" aria-label="Night before" disabled={!prev} onClick={() => onGo(prev.day)}><MIcon name="fKeyboardArrowLeft" size={24} /></button>
      <div className="mid">{nightWord(day, t)}<small>{formatDate(day - 1)} into {dayMonth(day, t)}</small></div>
      <button className="pg-pb" aria-label="Night after" disabled={!next} onClick={() => onGo(next.day)}><MIcon name="fKeyboardArrowRight" size={24} /></button>
    </div>
    <div className="pg-hv">{fmtSleep(n.totalMin!)}<small>asleep</small>{diff !== null && Math.round(diff) !== 0 && <span className="pg-hchip">{fmtSleep(Math.abs(diff))} {diff > 0 ? "over" : "under"} usual</span>}</div>
    {timed && <div className="pg-nsub">{join(`Bed ${clockOfMoment(n.bed)}`, `woke ${clockOfMoment(n.wake)}`, `${fmtSleep(inBedMin(n.bed!, n.wake!))} in bed`)}</div>}
    <div className="pg-card">
      <div className="pg-ct"><span>The night</span></div>
      {n.spans.length && timed
        ? <NightChart key={day} n={n} bed={n.bed!} wake={n.wake!} />
        : <>
          <div className="pg-band">{reason}</div>
          {timed && <div className="pg-times"><span>{clockOfMoment(n.bed)}</span><span>{clockOfMoment(n.wake)}</span></div>}
        </>}
    </div>
    <StageCard n={n} usual={usual.stages} />
  </>;
}
