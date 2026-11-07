// A week of nights (344 option B), at the top of Progress → Sleep: each night a strip on a 22:00–09:00 clock,
// coloured by stage along the night (grey with totals only), dashed lines at the average bed and wake times, the
// hours at the right, naps under their morning's night (never counted). "Last 7 nights" ends on the latest night;
// "This week" is Monday to Sunday. A tap on a night opens it. The numbers come from domain/sleep.ts.
import { type ReactNode, useMemo, useState } from "react";
import { dayShort, startOfWeek, weekday } from "../../domain/dates.ts";
import {
  type NightSpan, type SleepNight, type WeekRow, clockFromNoon, clockOfMoment, fmtSleep, inBedMin, nightPlace, weekAverages, weekClock, weekRows, withRecord,
} from "../../domain/sleep.ts";
import type { Training } from "../../store/training.ts";
import { Segmented } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { STAGE_COLOURS, STAGE_NAMES } from "./ProgressChart.tsx";
import { tapProps } from "./tapProps.ts";

type Mode = "last" | "week";
const MODES: [Mode, string][] = [["last", "7 nights"], ["week", "This week"]];

/** "Fri", by the evening the night began. */
const eveningOf = (day: number) => dayShort(weekday(day - 1));

/** "+ a 35-min nap at 14:10, not counted"; with more than one, their count and time together. */
function napWords(naps: WeekRow["naps"]): string {
  if (naps.length === 1) return `+ a ${fmtSleep(naps[0].min).replace(" min", "-min")} nap at ${clockOfMoment(naps[0].bed)}, not counted`;
  return `+ ${naps.length} naps, ${fmtSleep(naps.reduce((a, n) => a + n.min, 0))}, not counted`;
}

/** The night's stretches as blocks along its strip (minutes from bed, as a share of the night). */
function Stages({ spans, len }: { spans: readonly NightSpan[]; len: number }) {
  return <>{spans.map((x, i) => <i key={i} style={{ left: `${(x.from / len) * 100}%`, width: `${((x.to - x.from) / len) * 100}%`, background: STAGE_COLOURS[x.stage] }} />)}</>;
}

/** One night's row: its evening, its strip on the clock (or why there's none), its hours, and its naps under it. */
function Row({ r, x, latest, onNight }: { r: WeekRow; x: (m: number) => number; latest: boolean; onNight: (day: number) => void }) {
  const n: SleepNight | null = r.night;
  const p = n && nightPlace(n);
  let track: ReactNode;
  if (r.future) track = <span className="msg">still to come</span>;
  else if (!n) track = <span className="msg">no record</span>;
  else if (!p) track = <span className="msg">totals only</span>;
  else {
    const left = x(p.bed), right = x(p.wake), len = Math.max(1, inBedMin(n.bed!, n.wake!));
    const stages = n.spans.length > 0;
    track = <>
      <span className={`strip ${stages ? "" : "totals"}`} style={{ left: `${left}%`, width: `${Math.max(0.5, right - left)}%` }}>{stages && <Stages spans={n.spans} len={len} />}</span>
      {!stages && (right < 72
        ? <span className="tag" style={{ left: `calc(${right}% + 6px)` }}>totals only</span>
        : <span className="tag end" style={{ right: `calc(${100 - left}% + 6px)` }}>totals only</span>)}
    </>;
  }
  const label = n
    ? `${eveningOf(r.day)} night${n.bed && n.wake ? `, ${clockOfMoment(n.bed)} to ${clockOfMoment(n.wake)}` : ""}, ${fmtSleep(n.totalMin!)} asleep`
    : `${eveningOf(r.day)} night, ${r.future ? "still to come" : "no record"}`;
  return (
    <div className={`pg-wkr ${latest ? "last" : ""} ${n ? "tap" : ""} ${r.naps.length ? "naps" : ""}`} aria-label={label}
      {...(n ? tapProps(() => onNight(r.day)) : { role: "group" })}>
      <span className="d">{eveningOf(r.day)}</span>
      <span className="tk">
        {track}
        {r.naps.length > 0 && <span className="nap"><i />{napWords(r.naps)}</span>}
      </span>
      <span className="h">{n ? fmtSleep(n.totalMin!) : ""}</span>
    </div>
  );
}

/** The week card; [head] (the headline of last night) goes at its top. */
export function SleepWeek({ tr, t, head, onNight }: { tr: Training; t: number; head: ReactNode; onNight: (day: number) => void }) {
  const [mode, setMode] = useState<Mode>("last");
  const recorded = withRecord(tr.sleep, "totalMin");
  const latest = recorded.length ? recorded[recorded.length - 1].day : t;
  const from = mode === "last" ? latest - 6 : startOfWeek(t, true);
  const rows = useMemo(() => weekRows(tr.sleep, tr.healthNights, from, t), [tr, from, t]);
  const [lo, hi] = weekClock(rows);
  const x = (m: number) => ((m - lo) / (hi - lo)) * 100;
  const ticks: number[] = [];
  for (let m = Math.ceil(lo / 120) * 120; m <= hi; m += 120) ticks.push(m);
  const a = weekAverages(rows);
  const count = `${a.nights} of ${a.of} nights`;
  return (
    <div className="pg-card pg-wk">
      {head}
      <div className="pg-ct pg-wkt"><span>{mode === "last" ? "Last 7 nights" : "This week"}</span>
        <span className="pg-wkseg"><Segmented value={mode} options={MODES} onChange={(k) => { feel("tick"); setMode(k); }} /></span>
      </div>
      <div className="pg-wkg">
        <div className="pg-wkaxis">{ticks.map((m) => <span key={m} style={{ left: `${x(m)}%` }}>{clockFromNoon(m)}</span>)}</div>
        <div className="pg-wklines" aria-hidden>
          {ticks.map((m) => <i key={m} style={{ left: `${x(m)}%` }} />)}
          {a.bed !== null && <i className="avg" style={{ left: `${x(a.bed)}%` }} />}
          {a.wake !== null && <i className="avg" style={{ left: `${x(a.wake)}%` }} />}
        </div>
        {rows.map((r) => <Row key={r.day} r={r} x={x} latest={r.day === latest && !!r.night} onNight={onNight} />)}
        <div className="pg-wkfoot">
          {a.bed !== null && <span style={{ left: `${x(a.bed)}%` }}>avg {clockFromNoon(a.bed)}</span>}
          {a.wake !== null && <span style={{ left: `${x(a.wake)}%` }}>avg {clockFromNoon(a.wake)}</span>}
        </div>
      </div>
      <div className="pg-wkavg">
        {a.asleep === null
          ? (mode === "week" ? "No nights recorded this week yet." : "No nights recorded in these 7.")
          : mode === "week"
            ? <>This week so far, <b>{count}</b>: <b>{fmtSleep(a.asleep)}</b> asleep</>
            : <>Average, <b>{count}</b>: <b>{fmtSleep(a.asleep)}</b> asleep{a.bed !== null && a.wake !== null && <> · bed <b>{clockFromNoon(a.bed)}</b> · up <b>{clockFromNoon(a.wake)}</b></>}</>}
      </div>
      {mode === "last" && a.stages && (
        <>
          <div className="pg-wkleg">
            {(["deep", "light", "rem", "awake"] as const).map((k) => (
              <span key={k}><i style={{ background: STAGE_COLOURS[k] }} />{STAGE_NAMES[k]}<em>{fmtSleep(a.stages![k])}</em></span>
            ))}
          </div>
          {a.stageNights < a.nights && <div className="pg-foot">Stages over the {a.stageNights} nights that have them.</div>}
        </>
      )}
    </div>
  );
}
