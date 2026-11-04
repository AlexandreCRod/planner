// Progress (#/training?view=progress), in place of the old Bests page: how the lifts, runs and body weight
// are moving. Tabs Body · Cardio (TrainingCardio.tsx) · Lifts · Nutrition (355; greyed: it comes later, from the meal photos). Each tab
// is a list of rows, each with its latest number and a 3-month sparkline; a tap opens the row's card: its
// headline number, a chart with the range switch, and what goes with it (hard sets, rep bests, the recent
// weigh-ins). A swipe on a chart moves one window through time (302), and the headline and what's under it follow;
// a hold, then a slide, reads a day, and the headline shows that day's reading (it stays when the finger
// lifts), naming where it came from when it's history (FitNotes, Strava, Garmin). On the phone a card
// opens over the list (back closes it); in a wide window the list and the card sit side by side. A swipe turns the tab. Weight's
// top bar has "+ Weigh in", and a weigh-in tapped (a dot, or a row of the recent ones) opens to change or
// delete it, or hide an imported one. Body (251, a grid of small charts since 270): weight across the top, then
// a tile for each of the nights, resting HR, steps, body fat, HRV, VO2 max, blood oxygen and breathing rate, each
// opening its card; those with no reading for 14 days fold under "Not updating". The numbers come from
// domain/trends.ts, domain/sleep.ts and domain/body.ts; nothing here is stored but the user's weigh-ins and what they hid.
import { type ReactNode, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatDate, today as todayEpoch } from "../../domain/dates.ts";
import { dayOf, repBests } from "../../domain/training.ts";
import { type BodyKind, type BodyPoint, type ProgressTab, PROGRESS_TABS, progressTabOf, avg7LineOf, avg7Of, avgNow, bodySeries, fmtSteps, lastWeighInLine, settled, shortWhen, signedTenths, splitStale, tileDays } from "../../domain/body.ts";
import {
  type BodyWeight, type LiftPoint, bodyWeights, healthWeighIns, hiddenId, liftPoints, targetRpeOf, weeklyChange,
  weeklyHardSets, weightTrend,
} from "../../domain/trends.ts";
import { type SleepField, type SleepNight, type SleepSource, avg7, avg7Line, clockOfMoment, fmtSleep, hrvRange, nightsOf7, restingHrFlag, sleepAverages, withRecord } from "../../domain/sleep.ts";
import { type LoadedPlan, type Training, saveHidden, saveWeighIn } from "../../store/training.ts";
import { useWide } from "../../platform.ts";
import { go, replaceRoute } from "../shared/common.tsx";
import { type RangeKey, DEFAULT_RANGE, dayMonth, inRange, rangeStart, signed, spanWindow } from "./chartMath.ts";
import { EmptyState, MIcon, Scaffold, Segmented } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { NO_SWIPE, spring, swipeTabs, useSwipePager } from "./pager.ts";
import { BottomSheet, SheetButtons, TextButton, showSnackbar } from "./m3.tsx";
import { type Pan, type Pt, type Series, Chart, GREY, GYM, GYM_DIM, MiniChart, PAIN, RUN, RangeSwitch, SLEEP, SLEEP_DIM, Spark, WEIGHT, WEIGHT_DIM } from "./ProgressChart.tsx";
import { ChartCard, Head, from, join, tapProps } from "./progressParts.tsx";
import { CardioCards, CardioList, cardioTitle, useCardio } from "./TrainingCardio.tsx";
import { SlideStepper } from "./SlideStepper.tsx";
import { NightCards, NightStrip, nightWord } from "./TrainingNight.tsx";
import { allExercises, bestWord, fmtKg, planQ, randomId, shownBests } from "./trainingParts.tsx";
import "./progress.css";

type Tab = ProgressTab;
const TAB_NAMES: Record<Tab, string> = { body: "Body", runs: "Cardio", lifts: "Lifts", nutrition: "Nutrition" };
const TABS: [Tab, string][] = PROGRESS_TABS.map((k) => [k, TAB_NAMES[k]]);
const tabOf = progressTabOf;
/** The lifts before this day are the "before the break" peak, shown only as quiet text (keep it quiet before the race). */
const PEAK_BEFORE = dayOf("2025-04-01")!;

// The range picked on a card stays for the next card opened, until the app restarts.
let keptRange: RangeKey = DEFAULT_RANGE;
function useRange(): [RangeKey, (k: RangeKey) => void] {
  const [r, setR] = useState(keptRange);
  return [r, (k) => { keptRange = k; setR(k); }];
}

const route = (tab: Tab, card: string | null, planId: string | null) =>
  `training?view=progress&tab=${tab}${card ? `&c=${encodeURIComponent(card)}` : ""}${planQ(planId)}`;

/**
 * Where a chart's line breaks (266): the 7-day average over more than 7 days without a reading has nothing to
 * average; the weight trend over more than 2 weeks without a weigh-in jumps to the new weight.
 */
const AVG_GAP = 7, TREND_GAP = 14;

// ---------- The page ----------

/** One row of a tab's list: its name and line under it, the sparkline, the number and the line under it. */
interface Row { id: string; name: string; sub: string; spark: ReactNode; value: string; valueSub: string; group: string }

// Body's "Not updating" stays open or folded until the app restarts.
let keptMore = false;

export function TrainingProgress({ tr, lp, query, planId }: { tr: Training; lp: LoadedPlan; query: URLSearchParams; planId: string | null }) {
  const wide = useWide();
  const t = todayEpoch();
  const wantedTab = tabOf(query.get("tab"));
  const card = query.get("c");
  const [weighing, setWeighing] = useState(false);
  // The tab shown, kept here as well as in the route, so a swipe's new page is drawn at once (248); a route
  // changed from elsewhere (back, a link) still wins.
  const [tab, setTabState] = useState<Tab>(wantedTab);
  const [lastWanted, setLastWanted] = useState<Tab>(wantedTab);
  if (lastWanted !== wantedTab) { setLastWanted(wantedTab); setTabState(wantedTab); }
  const index = TABS.findIndex(([k]) => k === tab);
  const setIndex = (i: number) => {
    const k = TABS[clampTab(i)][0];
    setLastWanted(k);
    setTabState(k);
    replaceRoute(route(k, null, planId));
  };
  const open = (id: string) => {
    feel("tick");
    // Wide, the open card is swapped in place, so back leaves Progress rather than going through each card.
    if (wide && card) replaceRoute(route(tab, id, planId)); else go(route(tab, id, planId));
  };
  const weighIn = tab === "body" && (wide || !card || card === "w") && <TextButton className="pg-act" onClick={() => setWeighing(true)}>+ Weigh in</TextButton>;
  const sheet = weighing && <WeighInSheet tr={tr} t={t} onClose={() => setWeighing(false)} />;
  const cardio = useCardio();
  // A night opens over the Sleep card, wide too, so back returns to it; the ‹ › beside a night swap it in place.
  const night = { open: (day: number) => { feel("tick"); go(route("body", `night:${day}`, planId)); }, swap: (day: number) => { feel("tick"); replaceRoute(route("body", `night:${day}`, planId)); } };
  const cardView = card ? <CardView tr={tr} lp={lp} tab={tab} id={card} t={t} cardio={cardio} onOpen={open} night={night} /> : null;

  if (!wide && card) {
    return <Scaffold title={cardTitle(tr, tab, card)} back flush actions={card === "w" ? weighIn : null}>
      <div className="p-content pg-page">{cardView}<div className="p-endspace" /></div>{sheet}
    </Scaffold>;
  }

  const list = <TabsPager index={index} setIndex={setIndex}>
    {(k, i) => Math.abs(i - index) <= 1 && (k === "runs"
      ? <CardioList tr={tr} lp={lp} t={t} st={cardio} sel={wide && k === tab ? card : null} onOpen={open} />
      : k === "body" ? <BodyGrid tr={tr} t={t} sel={wide && k === tab ? (card?.startsWith("night:") ? "sl" : card) : null} onOpen={open} />
      : <TabPage tr={tr} tab={k} t={t} sel={wide && k === tab ? card : null} onOpen={open} />)}
  </TabsPager>;

  return (
    <Scaffold title="Progress" back flush actions={weighIn}>
      {wide ? (
        <div className="tr-split">
          {list}
          <div className="tr-side">
            {cardView ? <div className="p-content pg-page pg-side">{cardView}<div className="p-endspace" /></div>
              : <div className="tr-side-hint"><MIcon name="fShowChart" size={40} /><span>Tap a row to see its chart</span></div>}
          </div>
        </div>
      ) : list}
      {sheet}
    </Scaffold>
  );
}

/**
 * The tab row over a pager of the tabs' lists (248): a swipe turns the tab with the tab row following, a tap
 * on a tab slides there. Its own component, so the pager is set up again each time the list comes back
 * (on a phone a card replaces the list).
 */
function TabsPager({ index, setIndex, children }: { index: number; setIndex: (i: number) => void; children: (k: Tab, i: number) => ReactNode }) {
  const idx = useRef(index);
  idx.current = index;
  const strip = useRef<HTMLDivElement>(null);
  const track = useRef<((p: number | null) => void) | null>(null);
  const stopSlide = useRef<(() => void) | null>(null);
  // A tap on a tab slides there on the pager's spring (a jump of more than one tab is just there).
  const showTab = (k: Tab) => {
    const i = TABS.findIndex(([x]) => x === k), from = idx.current;
    stopSlide.current?.(); stopSlide.current = null;
    if (strip.current) strip.current.style.transform = "";
    if (i === from) return;
    feel("tick");
    const el = strip.current, w = el?.parentElement?.clientWidth ?? 0;
    flushSync(() => { idx.current = i; setIndex(i); });
    if (!el || !w || Math.abs(i - from) > 1) return;
    const place = (x: number) => { el.style.transform = x ? `translate3d(${x}px,0,0)` : ""; };
    stopSlide.current = spring((i - from) * w, 0, 0, place, () => { stopSlide.current = null; place(0); });
  };
  const pager = useSwipePager<HTMLDivElement>({
    layers: () => [strip.current],
    onStep: (d) => { const i = clampTab(idx.current + d); idx.current = i; setIndex(i); },
    canStep: (d) => idx.current + d >= 0 && idx.current + d <= TABS.length - 1,
    onMove: (x, w) => { stopSlide.current?.(); stopSlide.current = null; track.current?.(idx.current - x / w); },
    onSettled: () => track.current?.(null),
    allow: (el) => !el.closest(NO_SWIPE),
    yieldAtEdge: swipeTabs,
  });
  return (
    <div className="pg-list">
      <div className="pg-tabs">
        <Segmented value={TABS[index][0]} options={TABS} onChange={showTab} track={track} />
      </div>
      <div className="p-tabpager" ref={pager}>
        <div className="p-tabstrip" ref={strip} style={{ left: `${-index * 100}%` }}>
          {TABS.map(([k], i) => (
            <div key={k} className="p-content p-tabpage pg-page" style={{ left: `${i * 100}%` }} aria-hidden={i !== index}>{children(k, i)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

const clampTab = (i: number) => Math.max(0, Math.min(TABS.length - 1, i));

/** The Lifts tab's list, or Nutrition's word: rows under their group headings ([sel]: the row whose card is open beside it). */
function TabPage({ tr, tab, t, sel, onOpen }: { tr: Training; tab: Tab; t: number; sel: string | null; onOpen: (id: string) => void }) {
  const rows = useMemo(() => (tab === "lifts" ? liftRows(tr, rangeStart("3M", t)) : []), [tr, tab, t]);
  let group = "";
  return <>
    {tab === "nutrition" && <div className="pg-soon">Later: from the meal photos you send to the Meals chat, against the plan's protein, carbs and fat.</div>}
    {tab !== "nutrition" && rows.length === 0 && <EmptyState icon="oFitnessCenter" title="No lifts yet" hint="They show here once sets are logged" />}
    {rows.map((r) => {
      const head = r.group !== group ? r.group : null;
      const first = group === "";
      group = r.group;
      return <div key={r.id}>
        {head && <div className={`pg-group ${first ? "first" : ""}`}>{head}</div>}
        <div className={`pg-row ${sel === r.id ? "sel" : ""}`} role="button" onClick={() => onOpen(r.id)}>
          <div className="n"><b>{r.name}</b><span>{r.sub}</span></div>
          {r.spark}
          <div className="v">{r.value}<span>{r.valueSub}</span></div>
        </div>
      </div>;
    })}
    <div className="p-endspace" />
  </>;
}

function cardTitle(tr: Training, tab: Tab, id: string): string {
  if (tab === "lifts") return liftName(tr, id);
  if (tab === "runs") return cardioTitle(id);
  if (id.startsWith("night:")) return "Sleep";
  if (id in BODY) return BODY[id].title;
  return ({ w: "Weight", sl: "Sleep", rh: "Resting heart rate", hrv: "HRV" } as Record<string, string>)[id] ?? "Progress";
}

function CardView({ tr, lp, tab, id, t, cardio, onOpen, night }: {
  tr: Training; lp: LoadedPlan; tab: Tab; id: string; t: number; cardio: ReturnType<typeof useCardio>; onOpen: (id: string) => void;
  night: { open: (day: number) => void; swap: (day: number) => void };
}) {
  if (tab === "lifts") return <LiftCards tr={tr} lp={lp} id={id} />;
  if (tab === "runs") return <CardioCards tr={tr} id={id} t={t} st={cardio} onOpen={onOpen} />;
  if (tab === "body") {
    if (id === "w") return <WeightCards tr={tr} t={t} />;
    if (id === "sl" || id === "rh" || id === "hrv") return <SleepCards tr={tr} id={id} t={t} onNight={night.open} />;
    if (id.startsWith("night:")) return <NightCards tr={tr} day={Number(id.slice(6))} t={t} onGo={night.swap} />;
    if (id in BODY) return <BodyCards tr={tr} def={BODY[id]} t={t} />;
  }
  return null;
}

/**
 * The range a card shows and the window of it (302): its first and last days (null: no limit), the axis's days,
 * how many windows back it is, and the chart's way through time. A new range starts back at now.
 */
function useSpan(days: readonly number[], t: number): { range: RangeKey; setRange: (k: RangeKey) => void; start: number | null; end: number | null; domain: [number, number]; back: number; pan: Pan } {
  const [range, setKept] = useRange();
  const [back, setBack] = useState(0);
  const w = spanWindow(range, t, days, back);
  return {
    range, setRange: (k) => { setBack(0); setKept(k); }, start: w.from, end: w.to, domain: w.domain, back,
    pan: { id: range, label: w.label, back, canBack: w.earlier, canFwd: back > 0, step: (d) => setBack((b) => Math.max(0, b + d)), now: () => setBack(0) },
  };
}

// ---------- Lifts ----------

/** The name of an exercise from any plan, else from the history. */
function liftName(tr: Training, id: string): string {
  return allExercises(tr).get(id)?.name ?? tr.pastSets.find((s) => s.exerciseId === id)?.name ?? id;
}
/** A pull-up's or dip's weight is what's added to the body: it's shown as its top set, "+12.5". */
const addedWeight = (name: string) => /pull-?up|chin-?up|\bdips?\b/i.test(name);

/** The RPE a Planner point was estimated with (logged, else its session's target); null for history. */
function rpeAt(tr: Training, id: string, p: LiftPoint): number | null {
  if (p.source !== "planner") return null;
  const l = tr.lifts.find((x) => x.exercise === id && x.day === p.day && x.planId === p.planId && x.sessionId === p.sessionId);
  return l ? l.rpe ?? targetRpeOf(tr.plans.map((q) => q.plan), l) : null;
}

/** Each exercise worth a row: the tracked ones in any plan, then any only in the history; with its points. */
export function liftsShown(tr: Training): { id: string; name: string; added: boolean; pts: LiftPoint[] }[] {
  const plans = tr.plans.map((p) => p.plan);
  const ids = [...allExercises(tr).values()].filter((e) => e.trackBests).map((e) => e.id);
  for (const s of tr.pastSets) if (!ids.includes(s.exerciseId)) ids.push(s.exerciseId);
  return ids.map((id) => {
    const name = liftName(tr, id);
    return { id, name, added: addedWeight(name), pts: liftPoints(tr.lifts, id, plans, tr.pastSets) };
  }).filter((x) => x.pts.length > 0);
}

/** Whether an exercise is drawn by its estimated max (else by its top set). */
export const byMax = (added: boolean, pts: readonly LiftPoint[]) => !added && pts.some((p) => p.e1rm !== null);

function liftRows(tr: Training, since: number | null): Row[] {
  const rows = liftsShown(tr).map(({ id, name, added, pts }): Row => {
    const topOf = (p: LiftPoint) => {
      const rpe = rpeAt(tr, id, p);
      return p.topKg !== null ? `${fmtKg(p.topKg)} × ${p.topReps ?? "?"}${rpe !== null ? ` @ ${rpe}` : ""}` : "";
    };
    if (byMax(added, pts)) {
      const all = pts.filter((p) => p.e1rm !== null);
      const recent = inRange(all, since);
      const end = all[all.length - 1];
      return {
        id, name, group: "Estimated max", sub: end.topKg !== null ? `top set ${topOf(end)}` : "", spark: <Spark values={recent.map((p) => p.e1rm!)} color={GYM} />,
        value: fmtKg(end.e1rm!), valueSub: recent.length > 1 ? `${signed(end.e1rm! - recent[0].e1rm!)} kg` : dayMonth(end.day, todayEpoch()),
      };
    }
    // By the top set; a set with no weight added (a bodyweight pull-up) counts as 0.
    const last = pts[pts.length - 1], rpe = rpeAt(tr, id, last), kg = last.topKg ?? 0;
    return {
      id, name, group: "Top set", sub: added ? (kg > 0 ? "added weight" : "bodyweight") : "top set",
      spark: <Spark values={inRange(pts, since).map((p) => p.topKg ?? 0)} color={GYM} />,
      value: `${added && kg > 0 ? "+" : ""}${fmtKg(kg)}`,
      valueSub: [last.topReps !== null ? `× ${last.topReps}` : "", rpe !== null ? `@ ${rpe}` : ""].filter(Boolean).join(" ") || dayMonth(last.day, todayEpoch()),
    };
  });
  // Estimated maxes first, as in the design; each group in the plan's order.
  return [...rows.filter((r) => r.group === "Estimated max"), ...rows.filter((r) => r.group !== "Estimated max")];
}

/**
 * An exercise's cards: its estimated max (or top set) over time with its top sets, pain and where each RPE came
 * from; its hard sets per week; its rep bests since the return. Also on the exercise's history page.
 */
export function LiftCards({ tr, lp, id }: { tr: Training; lp: LoadedPlan; id: string }) {
  const t = todayEpoch();
  const name = liftName(tr, id);
  const added = addedWeight(name);
  const pts = useMemo(() => liftPoints(tr.lifts, id, tr.plans.map((p) => p.plan), tr.pastSets), [tr, id]);
  const max = byMax(added, pts);
  const main = max ? pts.filter((p) => p.e1rm !== null) : pts;
  const span = useSpan(main.map((p) => p.day), t);
  const shown = inRange(main, span.start, span.end);
  const [at, setAt] = useState<number | null>(null);
  const [weekAt, setWeekAt] = useState<number | null>(null);
  // The bars' scale stays put from window to window: the best week there's been.
  const hardTop = useMemo(() => (pts.length ? Math.max(...weeklyHardSets(tr.lifts, [id], pts[0].day, t, tr.pastSets).map((w) => w.sets)) : 0), [tr, id, pts, t]);
  if (!pts.length) return null;

  const val = (p: LiftPoint) => (max ? p.e1rm! : p.topKg ?? 0);
  const kgText = (kg: number) => `${added && kg > 0 ? "+" : ""}${fmtKg(kg)}`;
  const last = shown[shown.length - 1];
  const first = shown[0];
  const chip = shown.length > 1 ? `${signed(val(last) - val(first))} since ${dayMonth(first.day, t)}` : null;
  const head = last
    ? <Head value={kgText(val(last))} unit={max ? "kg estimated max" : last.topReps !== null ? `kg × ${last.topReps}` : "kg"} chip={chip} />
    : <Head value="–" unit={max ? "kg estimated max" : "kg"} />;
  const p = at !== null ? shown[at] : null;
  let read: [string, ReactNode] | null = null;
  if (p) {
    const rpe = rpeAt(tr, id, p);
    const how = p.rpeBasis === "logged" ? ` @ RPE ${rpe}` : p.rpeBasis === "assumed" ? ` @ RPE ${rpe} (plan's target, not logged)` : p.rpeBasis === "lowerBound" ? ", no RPE: at least this" : "";
    read = [
      join(formatDate(p.day), p.pain ? `pain ${p.pain}/10` : "", from(p.source)),
      max ? <>{fmtKg(p.e1rm!)} kg <small>top set {fmtKg(p.topKg ?? 0)} × {p.topReps ?? "?"}{how}</small></>
        : <>{kgText(p.topKg ?? 0)} kg <small>{p.topReps !== null ? `× ${p.topReps}` : "bodyweight"}{rpe !== null ? ` @ RPE ${rpe}` : ""}</small></>,
    ];
  }
  const series: Series[] = max
    ? [
      { kind: "dots", pts: shown.filter((q) => q.topKg !== null).map((q) => ({ day: q.day, v: q.topKg! })), color: GYM_DIM },
      { kind: "line", area: true, color: GYM, pts: shown.map((q): Pt => ({ day: q.day, v: q.e1rm!, mark: q.rpeBasis === "assumed" ? "hollow" : q.rpeBasis === "lowerBound" ? "lower" : undefined })) },
    ]
    : [{ kind: "line", area: true, color: GYM, pts: shown.map((q): Pt => ({ day: q.day, v: q.topKg ?? 0 })) }];
  const rings = shown.filter((q) => q.pain).map((q) => ({ day: q.day, v: val(q) }));

  // The best before the break: the plan's own record, else the history's best estimate. Quiet text, not a line.
  const record = lp.plan.records.historical.filter((h) => h.exercise === id).sort((a, b) => b.kg - a.kg)[0];
  const oldBest = pts.filter((q) => q.day < PEAK_BEFORE && q.e1rm !== null).sort((a, b) => b.e1rm! - a.e1rm!)[0];
  const peak = record ? `${fmtKg(record.kg)} kg${record.reps > 1 ? ` × ${record.reps}` : ""}` : oldBest && max ? `at least ${fmtKg(oldBest.e1rm!)} kg estimated` : null;

  const hard = weeklyHardSets(tr.lifts, [id], span.start ?? pts[0].day, span.end ?? t, tr.pastSets);
  const wk = weekAt !== null ? hard[weekAt] : null;
  const tracked = allExercises(tr).get(id)?.trackBests ?? false;
  const bests = tracked ? repBests(tr.lifts, new Set([id]), lp.plan.bestsSince).get(id) : undefined;

  return <>
    <RangeSwitch value={span.range} onChange={span.setRange} />
    <ChartCard title={max ? "Estimated max" : added ? "Top set, added weight" : "Top set"} head={head} read={read} pan={span.pan}
      foot={<>
        <div className="pg-leg">
          <span><i className="ln" style={{ background: GYM }} />{max ? "Estimated max" : "Top set"}</span>
          {max && <span><i className="dt" style={{ background: GYM_DIM }} />Top set</span>}
          {shown.some((q) => q.rpeBasis === "assumed") && <span><i className="ho" style={{ borderColor: GYM }} />RPE not logged</span>}
          {shown.some((q) => q.rpeBasis === "lowerBound") && <span><i className="tri" style={{ borderBottomColor: GYM }} />History: at least</span>}
          {rings.length > 0 && <span><i className="ho" style={{ borderColor: PAIN }} />Pain</span>}
        </div>
        {peak && <div className="pg-foot">Before Apr 2025: {peak}.</div>}
      </>}>
      <Chart series={series} rings={rings} domain={span.domain} today={t} height={160} reads={shown.map((q) => q.day)} onRead={setAt} pan={span.pan} />
    </ChartCard>
    <div className="pg-card">
      <div className="pg-ct"><span>Hard sets per week</span>{wk && <span className="pg-ct-read">Week of {dayMonth(wk.weekStart, t)} · {wk.sets} sets</span>}</div>
      <Chart series={[{ kind: "bars", color: GYM, pts: hard.filter((w) => w.sets > 0).map((w) => ({ day: w.weekStart, v: w.sets })) }]} zero top={hardTop} height={100} today={t}
        domain={[hard[0].weekStart, hard[hard.length - 1].weekStart + 7]} labels={[hard[0].weekStart, hard[hard.length - 1].weekStart]}
        reads={hard.map((w) => w.weekStart)} onRead={setWeekAt} pan={span.pan} />
    </div>
    {bests && bests.size > 0 && (
      <div className="pg-card pg-mini">
        <div className="pg-ct"><span>{lp.plan.bestsSince !== null ? `Rep bests since ${dayMonth(lp.plan.bestsSince, t)}` : "Rep bests"}</span></div>
        {shownBests(bests).map((n) => (
          <div key={n} className="r"><span>{bestWord(n)} · {fmtKg(bests.get(n)!.kg)} kg</span><span>{dayMonth(bests.get(n)!.day, t)}</span></div>
        ))}
      </div>
    )}
  </>;
}

// ---------- Weight ----------

/** Every weigh-in shown: the user's own, the history's and the scale's from Health Connect (266). */
const allWeights = (tr: Training) => bodyWeights(tr.weighIns, [...tr.pastWeighIns, ...healthWeighIns(tr.healthDays)], tr.hiddenWeighIns);

export function weightData(tr: Training) {
  const all = allWeights(tr);
  return { all, trend: weightTrend(all) };
}

/** A day's weigh-in times for its reading: "08:12", "08:12 & 19:40", else "3 weigh-ins". Blank when none has a time. */
function timesOf(list: readonly BodyWeight[]): string {
  if (list.length > 2) return `${list.length} weigh-ins`;
  return list.map((w) => w.time).filter(Boolean).join(" & ");
}

/** How many weigh-ins the Recent list under the chart shows. */
const RECENT = 7;

/**
 * The weight chart and the recent weigh-ins under it. Tapping a dot (that day's latest weigh-in) or a row
 * opens the weigh-in: the user's own to change or delete, the history's to hide.
 */
function WeightCards({ tr, t }: { tr: Training; t: number }) {
  const { all, trend } = useMemo(() => weightData(tr), [tr]);
  const span = useSpan(trend.map((p) => p.day), t);
  const [at, setAt] = useState<number | null>(null);
  const [editing, setEditing] = useState<BodyWeight | null>(null);
  const openDay = (day: number) => { const w = all.filter((x) => x.day === day).pop(); if (w) { feel("tick"); setEditing(w); } };
  const recent = all.slice(-RECENT).reverse();
  const shown = inRange(trend, span.start, span.end);
  const raw = inRange(all, span.start, span.end);
  // The headline is the latest; moved back through time, the window's latest.
  const last = span.back ? shown[shown.length - 1] : trend[trend.length - 1];
  const wk = weeklyChange(trend, last?.day);
  const p = at !== null ? shown[at] : null;
  let read: [string, ReactNode] | null = null;
  if (p) {
    const day = all.filter((x) => x.day === p.day);
    read = [
      join(formatDate(p.day), timesOf(day), `${p.count > 1 ? "average " : ""}${p.kg.toFixed(1)} kg`, day[0] && from(day[0].source)),
      <>{p.trend.toFixed(1)} kg <small>trend</small></>,
    ];
  }
  return <>
    <RangeSwitch value={span.range} onChange={span.setRange} />
    <ChartCard title="Weight" read={read} pan={span.pan}
      head={last ? <Head value={last.trend.toFixed(1)} unit="kg trend" chip={wk !== null ? `${signedTenths(wk)} kg / week` : null} /> : <Head value="–" unit="kg" />}
      foot={<>
        <div className="pg-leg"><span><i className="ln" style={{ background: WEIGHT }} />Trend</span><span><i className="dt" style={{ background: WEIGHT_DIM }} />Each weigh-in</span></div>
        <div className="pg-foot">One weigh-in can swing 1–2 kg with water; follow the line. A day with several weigh-ins counts their average.</div>
      </>}>
      <Chart series={[
        { kind: "dots", r: 3, color: WEIGHT_DIM, pts: raw.map((w) => ({ day: w.day, v: w.kg })) },
        { kind: "line", dots: false, color: WEIGHT, gap: TREND_GAP, pts: shown.map((q) => ({ day: q.day, v: q.trend })) },
      ]} domain={span.domain} today={t} height={150} fmt={(v) => String(v)} reads={shown.map((q) => q.day)} onRead={setAt} pan={span.pan}
        onTap={(i) => openDay(shown[i].day)} />
    </ChartCard>
    {recent.length > 0 && (
      <div className="pg-card pg-mini">
        <div className="pg-ct"><span>Recent weigh-ins</span></div>
        {recent.map((w) => (
          <div key={w.id} className="r tap" role="button" onClick={() => { feel("tick"); setEditing(w); }}>
            <span>{join(formatDate(w.day), w.time)}{w.source !== "planner" && <small>{from(w.source)}</small>}</span>
            <span className="big">{w.kg.toFixed(1)}</span>
          </div>
        ))}
      </div>
    )}
    {editing && <WeighInSheet tr={tr} t={t} edit={editing} onClose={() => setEditing(null)} />}
  </>;
}

// ---------- Sleep ----------

/** "last night" ("this morning") for today's, else its date. */
const whenOf = (day: number, t: number, today: string) => (day === t ? today : formatDate(day));

/** Where a sleep number came from, for its reading: sleep.json's "from Garmin"; the watch's own needs no word. */
const fromSleep = (s: SleepSource | null) => (s === "garmin" ? from(s) : "");

/** "deep 1 h 10 · light 4 h 20 · REM 1 h 42", for the stages known. */
const stagesOf = (n: SleepNight) => join(n.deepMin !== null && `deep ${fmtSleep(n.deepMin)}`, n.lightMin !== null && `light ${fmtSleep(n.lightMin)}`, n.remMin !== null && `REM ${fmtSleep(n.remMin)}`);

/**
 * The Sleep tab's cards: sleep per night (a bar a night and the 7-day line), resting heart rate (each
 * morning, the 7-day line, a ring on the days it's flagged) and HRV (each night, the 7-day line and the
 * normal range shaded). Holding a point reads it with where it came from. On the first, the latest night has a
 * row with its strip, and a tap on a bar opens that night (308).
 */
function SleepCards({ tr, id, t, onNight }: { tr: Training; id: string; t: number; onNight: (day: number) => void }) {
  const field: SleepField = id === "rh" ? "restingHr" : id === "hrv" ? "hrvMs" : "totalMin";
  const list = useMemo(() => withRecord(tr.sleep, field), [tr, field]);
  const line = useMemo(() => avg7Line(tr.sleep, field), [tr, field]);
  const span = useSpan(list.map((n) => n.day), t);
  const [at, setAt] = useState<number | null>(null);
  const switcher = <RangeSwitch value={span.range} onChange={span.setRange} />;
  if (!list.length) return <EmptyState icon="oNightsStay" title="No nights yet" hint="They come from the watch through Health Connect" />;
  const shown = inRange(list, span.start, span.end);
  const avgPts = inRange(line, span.start, span.end);
  const last = span.back ? shown[shown.length - 1] : list[list.length - 1];
  const lastAvg = last ? avg7(tr.sleep, field, last.day) : null;
  const none = <Head value="–" unit="" />;
  const n = at !== null ? shown[at] : null;
  const nAvg = n && avg7(tr.sleep, field, n.day);
  const legend = (each: string, extra?: ReactNode) => (
    <div className="pg-leg"><span><i className="ln" style={{ background: SLEEP }} />7-day average</span><span><i className="dt" style={{ background: SLEEP_DIM }} />{each}</span>{extra}</div>
  );
  // A night's bar stands over its day, so the axis runs a day longer and its line goes through the bars' middles.
  const chart = (series: Series[], opts: { fmt?: (v: number) => string; zero?: boolean; rings?: Pt[]; bars?: boolean; top?: number; onTap?: (i: number) => void } = {}) =>
    <Chart series={series} onTap={opts.onTap} domain={opts.bars ? [span.domain[0], span.domain[1] + 1] : span.domain} labels={opts.bars ? span.domain : undefined} today={t} height={150} pan={span.pan}
      fmt={opts.fmt} zero={opts.zero} top={opts.top} rings={opts.rings} reads={shown.map((x) => x.day)} onRead={setAt} />;

  if (field === "totalMin") {
    // A bar a night; over a long range, where bars would be hairlines, a small dot instead.
    const pts = shown.map((x) => ({ day: x.day, v: x.totalMin! / 60 })); // drawn in hours
    const bars = shown.length <= 120;
    const each: Series = bars ? { kind: "bars", span: 1, color: SLEEP_DIM, pts } : { kind: "dots", r: 2.5, color: SLEEP_DIM, pts };
    const bed = n && n.bed && n.wake ? `bed ${clockOfMoment(n.bed)} → ${clockOfMoment(n.wake)}` : "";
    return <>{switcher}<ChartCard title="Sleep per night" pan={span.pan} tall
      read={n ? [join(`Night to ${formatDate(n.day)}`, bed, fromSleep(n.source)), <>{fmtSleep(n.totalMin!)} <small>{stagesOf(n)}</small></>] : null}
      head={last ? <Head value={fmtSleep(last.totalMin!)} unit={whenOf(last.day, t, "last night")} chip={lastAvg !== null ? `7-day avg ${fmtSleep(lastAvg)} · ${nightsOf7(sleepAverages(tr.sleep, last.day).nights)}` : null} /> : none}
      foot={<>{legend("Each night")}<div className="pg-foot">Tap a bar to open that night. Under 6 h before a quality or long run puts a moon on that session.</div></>}>
      {!span.back && (
        <div className="pg-lrow" {...tapProps(() => onNight(list[list.length - 1].day))}>
          <div className="x">{nightWord(list[list.length - 1].day, t)}{list[list.length - 1].bed && list[list.length - 1].wake && <small>{clockOfMoment(list[list.length - 1].bed)}–{clockOfMoment(list[list.length - 1].wake)}</small>}</div>
          <NightStrip n={list[list.length - 1]} /><MIcon name="fKeyboardArrowRight" size={18} />
        </div>
      )}
      {chart([each, { kind: "line", dots: false, color: SLEEP, gap: AVG_GAP, pts: avgPts.map((p) => ({ day: p.day + (bars ? 0.5 : 0), v: p.v / 60 })) }], { fmt: (v) => `${v} h`, zero: true, bars, top: Math.max(...list.map((x) => x.totalMin!)) / 60, onTap: (i) => onNight(shown[i].day) })}
    </ChartCard></>;
  }

  if (field === "restingHr") {
    const rings = shown.filter((x) => restingHrFlag(tr.sleep, x.day)).map((x) => ({ day: x.day, v: x.restingHr! }));
    return <>{switcher}<ChartCard title="Resting heart rate" pan={span.pan}
      read={n ? [join(formatDate(n.day), fromSleep(n.restingHrSource)), <>{n.restingHr} bpm <small>{join(nAvg !== null && `7-day avg ${Math.round(nAvg)}`, restingHrFlag(tr.sleep, n.day) && "up two mornings running")}</small></>] : null}
      head={last ? <Head value={String(last.restingHr)} unit={`bpm ${whenOf(last.day, t, "this morning")}`} chip={lastAvg !== null ? `7-day avg ${Math.round(lastAvg)}` : null} /> : none}
      foot={<>{legend("Each morning", rings.length > 0 && <span><i className="ho" style={{ borderColor: PAIN }} />Up 7+ two mornings running</span>)}
        <div className="pg-foot">7 or more above your 7-day average two mornings running puts a quiet marker on the day.</div></>}>
      {chart([{ kind: "dots", r: 3, color: SLEEP_DIM, pts: shown.map((x) => ({ day: x.day, v: x.restingHr! })) }, { kind: "line", dots: false, color: SLEEP, gap: AVG_GAP, pts: avgPts }], { rings })}
    </ChartCard></>;
  }

  // HRV: the normal range as of each night, shaded.
  const band = shown.flatMap((x) => { const r = hrvRange(tr.sleep, x.day); return r ? [{ day: x.day, lo: r.lo, hi: r.hi }] : []; });
  const range = hrvRange(tr.sleep, last?.day ?? t);
  const nRange = n && hrvRange(tr.sleep, n.day);
  return <>{switcher}<ChartCard title="HRV (overnight)" pan={span.pan}
    read={n ? [join(formatDate(n.day), fromSleep(n.hrvSource)), <>{n.hrvMs} ms <small>{join(nAvg !== null && `7-day avg ${Math.round(nAvg)}`, nRange && `normal ${Math.round(nRange.lo)}–${Math.round(nRange.hi)}`)}</small></>] : null}
    head={last ? <Head value={String(last.hrvMs)} unit={`ms ${whenOf(last.day, t, "last night")}`} chip={lastAvg !== null ? `7-day avg ${Math.round(lastAvg)}` : null} /> : none}
    foot={<>{legend("Each night", band.length > 0 && <span><i className="bd" style={{ background: SLEEP }} />Your normal range</span>)}
      <div className="pg-foot">{range ? `Normal for you: ${Math.round(range.lo)}–${Math.round(range.hi)} ms, the last 60 nights' average ± 1 SD. ` : ""}A few nights in a row below the band: make it an easy day.</div></>}>
    {chart([{ kind: "band", color: SLEEP, pts: band }, { kind: "dots", r: 3, color: SLEEP_DIM, pts: shown.map((x) => ({ day: x.day, v: x.hrvMs! })) }, { kind: "line", dots: false, color: SLEEP, gap: AVG_GAP, pts: avgPts }])}
  </ChartCard></>;
}

// ---------- Body: VO2 max, steps, and under More blood oxygen, breathing rate and body fat ----------

/** A Body kind's card id, names, colours and how its numbers are written. */
interface BodyDef {
  kind: BodyKind; title: string; name: string; color: string; dim: string;
  fmt: (v: number) => string;
  /** After the headline's number. */
  unit: string;
  /** The tile's second number: the 7-day average, or the change over 3 months. */
  sub: "avg" | "change";
  foot: string;
}
const RUN_SOFT = `${RUN}73`; // the run colour, see-through: steps' daily bars under their 7-day line
const BODY: Record<string, BodyDef> = {
  vo2: { kind: "vo2", title: "VO2 max", name: "VO2 max", color: RUN, dim: RUN_SOFT, fmt: (v) => v.toFixed(1), unit: "ml/kg/min", sub: "change",
    foot: "Garmin's estimate, from runs with heart rate. It moves slowly: look at months, not days." },
  steps: { kind: "steps", title: "Steps", name: "Steps", color: RUN, dim: RUN_SOFT, fmt: fmtSteps, unit: "steps", sub: "avg",
    foot: "Today's count grows through the day." },
  spo2: { kind: "spo2", title: "Blood oxygen (overnight)", name: "Blood oxygen", color: SLEEP, dim: SLEEP_DIM, fmt: (v) => v.toFixed(1), unit: "%", sub: "avg",
    foot: "The watch's average while you sleep. Most nights sit between 94 and 99%." },
  br: { kind: "breath", title: "Breathing rate", name: "Breathing rate", color: SLEEP, dim: SLEEP_DIM, fmt: (v) => v.toFixed(1), unit: "breaths/min", sub: "avg",
    foot: "Breaths a minute, the watch's average. A rise of 2 or more over your usual can mean you're run down." },
  fat: { kind: "fat", title: "Body fat", name: "Body fat", color: WEIGHT, dim: WEIGHT_DIM, fmt: (v) => v.toFixed(1), unit: "%", sub: "change",
    foot: "From a scale that writes it to Health Connect. A scale's body fat is rough: follow the line, not a day." },
};
/** What a reading from today is called: blood oxygen is the night's. */
const todayWord = (kind: BodyKind) => (kind === "spo2" ? "last night" : "today");
/** The value with its unit on a row ("95.2%", "48.2", "8,412"). */
const rowValue = (b: BodyDef, v: number) => `${b.fmt(v)}${b.unit === "%" ? "%" : ""}`;

/** A Body kind's readings (one per day) from the watch's days and sleep.json. */
const seriesOf = (tr: Training, kind: BodyKind) => bodySeries(kind, tr.healthDays, tr.nights);

// ---------- Body's tiles (270) ----------

/** A tile: what it says, its last reading's day (null: none yet) and its small chart, in colour or grey when stale. */
interface BodyTile { id: string; name: string; value: string; unit: string; sub: string; last: number | null; chart: (stale: boolean) => ReactNode }

const DAILY = 14, MONTH = 30, TWO_MONTHS = 60, QUARTER = 90, TILE_H = 52;

const lineTile = (pts: readonly { day: number; v: number }[], color: string, t: number, days: number, gap: number) => (stale: boolean) => {
  const last = pts[pts.length - 1].day, domain = tileDays(last, t, days);
  return <MiniChart kind="line" pts={pts.filter((p) => p.day >= domain[0])} domain={domain} color={stale ? GREY : color} height={stale ? 44 : TILE_H} gap={gap} />;
};

/** Sleep, resting HR, steps, body fat, HRV, VO2 max, blood oxygen and breathing rate; those with no data yet only for the first three. */
function bodyTiles(tr: Training, t: number): BodyTile[] {
  const out: BodyTile[] = [];
  const none = (id: string, name: string) => out.push({ id, name, value: "–", unit: "", sub: "Nothing from the watch yet", last: null, chart: () => null });
  const nights = (id: string, name: string, field: SleepField, unit: string, today: string, fmt: (v: number) => string, chart: BodyTile["chart"] | null, must: boolean) => {
    const list = withRecord(tr.sleep, field), last = list[list.length - 1];
    if (!last) { if (must) none(id, name); return; }
    const avg = avg7(tr.sleep, field, last.day);
    out.push({
      id, name, value: fmt(last[field]!), unit, last: last.day,
      // Sleep's says how many nights its average is over, which leaves no room for the day in the tile.
      sub: field === "totalMin" && avg !== null ? join(`avg ${fmt(avg)}`, nightsOf7(sleepAverages(tr.sleep, last.day).nights)) : join(last.day === t ? today : shortWhen(last.day, t), avg !== null && `avg ${fmt(avg)}`),
      chart: chart ?? lineTile(list.map((n) => ({ day: n.day, v: n[field]! })), SLEEP, t, id === "rh" ? MONTH : TWO_MONTHS, AVG_GAP),
    });
  };
  const sleepList = withRecord(tr.sleep, "totalMin");
  const sleepLast = sleepList[sleepList.length - 1];
  nights("sl", "Sleep", "totalMin", "", "last night", fmtSleep, sleepLast ? (stale) => {
    const domain = tileDays(sleepLast.day, t, DAILY - 1), avg = avg7(tr.sleep, "totalMin", sleepLast.day);
    return <MiniChart kind="bars" pts={sleepList.filter((n) => n.day >= domain[0]).map((n) => ({ day: n.day, v: n.totalMin! }))} domain={domain} color={stale ? GREY : SLEEP} height={stale ? 44 : TILE_H} avg={avg} />;
  } : null, true);
  nights("rh", "Resting heart rate", "restingHr", "bpm", "this morning", (v) => String(Math.round(v)), null, true);
  const kind = (id: string, unit: string, days: number) => {
    const b = BODY[id], list = seriesOf(tr, b.kind), last = list[list.length - 1];
    if (!last) { if (id === "steps") none(id, b.name); return; }
    const a = avgNow(b.kind, list, t), recent = inRange(list, rangeStart("3M", t));
    const when = last.day === t ? todayWord(b.kind) : shortWhen(last.day, t);
    const more = b.sub === "avg" ? a !== null && `avg ${b.fmt(a)}` : recent.length > 1 && `${signedTenths(last.v - recent[0].v)} in 3M`;
    out.push({
      id, name: b.name, value: b.fmt(last.v), unit, sub: join(when, more), last: last.day,
      chart: id === "steps"
        ? (stale) => {
          const domain = tileDays(last.day, t, DAILY - 1);
          return <MiniChart kind="bars" pts={list.filter((p) => p.day >= domain[0])} domain={domain} color={stale ? GREY : b.color} height={stale ? 44 : TILE_H} avg={a} dimLast={last.day === t} />;
        }
        : lineTile(list, b.color, t, days, b.sub === "avg" ? AVG_GAP : Infinity),
    });
  };
  kind("steps", "", DAILY);
  kind("fat", "%", QUARTER);
  nights("hrv", "HRV", "hrvMs", "ms", "last night", (v) => String(Math.round(v)), null, false);
  kind("vo2", "", QUARTER);
  kind("spo2", "%", MONTH);
  kind("br", "/ min", MONTH);
  return out;
}

/** Weight across the top: the trend with each weigh-in over 3 months, the weekly change and the last weigh-in. */
function WeightTile({ tr, t, sel, onOpen }: { tr: Training; t: number; sel: boolean; onOpen: () => void }) {
  const { all, trend } = useMemo(() => weightData(tr), [tr]);
  const last = trend[trend.length - 1];
  if (!last) return <div className="pg-tile pg-tile-wide"><div className="a">Weight</div><div className="b">–</div><div className="c">No weigh-ins yet</div></div>;
  const since = rangeStart("3M", t), wk = weeklyChange(trend), w = all[all.length - 1];
  return (
    <div className={`pg-tile pg-tile-wide ${sel ? "sel" : ""}`} {...tapProps(onOpen)}>
      <div className="a pg-tile-top"><span>Weight</span><span>3 months</span></div>
      <div className="pg-tile-big"><span className="b">{last.trend.toFixed(1)} <small>kg trend</small></span>{wk !== null && <span className="pg-hchip">{signedTenths(wk)} kg / week</span>}</div>
      <MiniChart kind="line" pts={inRange(trend, since).map((p) => ({ day: p.day, v: p.trend }))} domain={[since ?? last.day, t]} color={WEIGHT} height={96} gap={TREND_GAP}
        dots={inRange(all, since).map((x) => ({ day: x.day, v: x.kg }))} dotColor={WEIGHT_DIM} />
      <div className="c">{lastWeighInLine(w.kg, w.day, t)}</div>
    </div>
  );
}

/** The four the watch doesn't send (Garmin's export only): they get the mockup's words; anything else stale, plainer ones. */
const EXPORT_ONLY = new Set(["hrv", "vo2", "spo2", "br"]);

/** The Body tab (270, mockup B): a grid of small charts; each tile opens the card the row used to. */
function BodyGrid({ tr, t, sel, onOpen }: { tr: Training; t: number; sel: string | null; onOpen: (id: string) => void }) {
  const { fresh, stale, since } = useMemo(() => splitStale(bodyTiles(tr, t), t), [tr, t]);
  const [more, setMore] = useState(() => keptMore || stale.some((x) => x.id === sel));
  const toggle = () => { feel("tick"); keptMore = !more; setMore(!more); };
  const tile = (x: BodyTile, old: boolean) => {
    const shown = x.last !== null;
    return (
      <div key={x.id} className={`pg-tile pg-btile ${old ? "dim" : ""} ${sel === x.id ? "sel" : ""}`} {...(shown ? tapProps(() => onOpen(x.id)) : {})}>
        <div className="a">{x.name}</div>
        <div className="b">{x.value}{x.unit && <> <small>{x.unit}</small></>}</div>
        <div className="c">{old ? `last ${dayMonth(x.last!, t)}` : x.sub}</div>
        {shown && x.chart(old)}
      </div>
    );
  };
  return <>
    <WeightTile tr={tr} t={t} sel={sel === "w"} onOpen={() => onOpen("w")} />
    <div className="pg-tiles">{fresh.map((x) => tile(x, false))}</div>
    {stale.length > 0 && <>
      <button className="pg-group pg-more pg-stale" aria-expanded={more} onClick={toggle}>
        <span>Not updating · {stale.length}</span><MIcon name={more ? "fExpandLess" : "fExpandMore"} size={20} />
        <span className="r">since {dayMonth(since!, t)}</span>
      </button>
      {more && <>
        <div className="pg-stalenote"><MIcon name="oInfo" size={16} />
          <span>{stale.every((x) => EXPORT_ONLY.has(x.id))
            ? "From your Garmin export. Garmin doesn't send these to Health Connect; they move back up if new readings arrive."
            : "No new readings for two weeks or more; they move back up when new readings arrive."}</span>
        </div>
        <div className="pg-tiles">{stale.map((x) => tile(x, true))}</div>
      </>}
    </>}
    <div className="p-endspace" />
  </>;
}

/**
 * A Body kind's card: each day's reading (a bar a day for steps, else a dot) under the 7-day average line, or
 * for VO2 max (a slow estimate) the readings joined; the headline is the latest with its 7-day average or
 * its change in the range. Touching a point reads it.
 */
function BodyCards({ tr, def: b, t }: { tr: Training; def: BodyDef; t: number }) {
  const kind = b.kind;
  const list = useMemo(() => seriesOf(tr, kind), [tr, kind]);
  // Steps' line and averages leave out today's count, still growing (266).
  const base = useMemo(() => settled(kind, list, t), [kind, list, t]);
  const line = useMemo(() => avg7LineOf(base), [base]);
  const span = useSpan(list.map((p) => p.day), t);
  const [at, setAt] = useState<number | null>(null);
  const switcher = <RangeSwitch value={span.range} onChange={span.setRange} />;
  if (!list.length) return <EmptyState icon="fShowChart" title={`No ${b.name.toLowerCase()} readings yet`} hint="They come from the watch through Health Connect" />;
  const shown = inRange(list, span.start, span.end);
  const avgPts = inRange(line, span.start, span.end);
  const last = span.back ? shown[shown.length - 1] : list[list.length - 1], first = shown[0];
  const lastAvg = span.back ? (last ? avg7Of(base, last.day) : null) : avgNow(kind, list, t);
  const isSteps = kind === "steps", joined = kind === "vo2";
  const chip = b.sub === "avg" ? (lastAvg !== null ? `7-day avg ${rowValue(b, lastAvg)}` : null)
    : shown.length > 1 && last ? `${signedTenths(last.v - first.v)} since ${dayMonth(first.day, t)}` : null;
  const p: BodyPoint | null = at !== null ? shown[at] ?? null : null;
  const pAvg = p && (p.day >= t ? lastAvg : avg7Of(base, p.day));
  const read: [string, ReactNode] | null = p
    ? [join(formatDate(p.day), p.fromSleepJson && "from Garmin"), <>{rowValue(b, p.v)} <small>{join(b.unit !== "%" && b.unit, !joined && pAvg !== null && `7-day avg ${rowValue(b, pAvg)}`)}</small></>]
    : null;
  const pts = shown.map((x) => ({ day: x.day, v: x.v }));
  // Steps: a bar a day (the axis a day longer, the line through the bars' middles); over a long range, dots.
  const bars = isSteps && shown.length <= 120;
  const series: Series[] = joined
    ? [{ kind: "line", color: b.color, pts }]
    : [
      bars ? { kind: "bars", span: 1, color: b.dim, pts } : { kind: "dots", r: isSteps ? 2.5 : 3, color: b.dim, pts },
      { kind: "line", dots: false, color: b.color, gap: AVG_GAP, pts: avgPts.map((x) => ({ day: x.day + (bars ? 0.5 : 0), v: x.v })) },
    ];
  return <>{switcher}<ChartCard title={b.title} read={read} pan={span.pan}
    head={last ? <Head value={b.fmt(last.v)} unit={`${b.unit} ${whenOf(last.day, t, todayWord(kind))}`} chip={chip} /> : <Head value="–" unit="" />}
    foot={<>
      {!joined && <div className="pg-leg"><span><i className="ln" style={{ background: b.color }} />7-day average</span><span><i className={bars ? "bd" : "dt"} style={{ background: b.dim, opacity: 1 }} />Each day</span></div>}
      <div className="pg-foot">{b.foot}</div>
    </>}>
    <Chart series={series} domain={bars ? [span.domain[0], span.domain[1] + 1] : span.domain} labels={bars ? span.domain : undefined} today={t} height={150} pan={span.pan}
      fmt={isSteps ? (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v)) : undefined} zero={isSteps} top={isSteps ? Math.max(...list.map((x) => x.v)) : undefined} reads={shown.map((x) => x.day)} onRead={setAt} />
  </ChartCard></>;
}

/**
 * The weigh-in sheet. "+ Weigh in" (no [edit]): the weight by the slide stepper (0.1 kg a step), saved for
 * today at the time now. One of the user's own: the same stepper to change its weight (its day and time
 * stay), with Delete. One from the history: its weight, read-only, with Hide. Each has an Undo.
 */
function WeighInSheet({ tr, t, edit, onClose }: { tr: Training; t: number; edit?: BodyWeight; onClose: () => void }) {
  const own = edit?.source === "planner" ? tr.weighIns.find((w) => w.id === edit.id) : undefined;
  const lastKg = useMemo(() => allWeights(tr).at(-1)?.kg ?? 75, [tr]);
  const [kg, setKg] = useState<number | null>(Math.round((edit?.kg ?? lastKg) * 10) / 10);
  const done = (close: () => void, text: string, undo: () => void) => { feel("settle"); close(); showSnackbar(text, "Undo", undo); };
  const save = (close: () => void) => {
    if (kg === null) return;
    if (own) {
      saveWeighIn({ ...own, kg });
      done(close, `Saved: ${kg.toFixed(1)} kg`, () => saveWeighIn(own));
      return;
    }
    const now = new Date();
    const w = {
      id: randomId(), day: t, time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, kg, note: "",
      updatedAt: Date.now(), deletedAt: null,
    };
    saveWeighIn(w);
    done(close, `Weighed in: ${kg.toFixed(1)} kg`, () => saveWeighIn({ ...w, deletedAt: Date.now() }));
  };
  const remove = (close: () => void) => {
    if (!own) return;
    saveWeighIn({ ...own, deletedAt: Date.now() });
    done(close, "Weigh-in deleted", () => saveWeighIn({ ...own, deletedAt: null }));
  };
  const hide = (close: () => void) => {
    if (!edit) return;
    const h = { id: hiddenId(edit.id), kind: "weighIn" as const, pastId: edit.id, hiddenAt: Date.now(), updatedAt: Date.now(), deletedAt: null };
    saveHidden(h);
    done(close, "Weigh-in hidden", () => saveHidden({ ...h, deletedAt: Date.now() }));
  };
  const when = edit && join(formatDate(edit.day), edit.time, from(edit.source));
  return (
    <BottomSheet onClose={onClose}>{(close) => (
      <div className="pg-weigh">
        <div className="tr-sheet-title t-title-medium">{edit ? "Weigh-in" : "Weigh in"}</div>
        {when && <div className="pg-weigh-sub">{when}</div>}
        {edit && !own ? <>
          <div className="pg-weigh-kg">{edit.kg.toFixed(1)}<small>kg</small></div>
          <div className="pg-weigh-sub">Imported: it can't be changed here, only hidden.</div>
          <div className="p-sheet-buttons">
            <TextButton onClick={close}>Cancel</TextButton>
            <button className="p-filled-btn" onClick={() => hide(close)}>Hide</button>
          </div>
        </> : <>
          <SlideStepper value={kg} onChange={setKg} step={0.1} min={30} max={250} format={(v) => v.toFixed(1)} unit="kg" decimal label="Weight" />
          {own ? (
            <div className="p-sheet-buttons">
              <TextButton className="pg-left" onClick={() => remove(close)}>Delete</TextButton>
              <TextButton onClick={close}>Cancel</TextButton>
              <button className="p-filled-btn" disabled={kg === null} onClick={() => save(close)}>Save</button>
            </div>
          ) : <SheetButtons onCancel={close} onSave={() => save(close)} enabled={kg !== null} />}
        </>}
      </div>
    )}</BottomSheet>
  );
}
