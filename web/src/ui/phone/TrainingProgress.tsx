// Progress (#/training?view=progress), in place of the old Bests page: how the lifts, runs and body weight
// are moving. Tabs Lifts · Runs · Weight · Sleep · Nutrition (greyed: it comes later, from the meal photos). Each tab
// is a list of rows, each with its latest number and a 3-month sparkline; a tap opens the row's card: its
// headline number, a chart with the range switch, and what goes with it (hard sets, rep bests, the recent
// weigh-ins). Touching a chart reads a day, and the headline shows that day's reading (it stays when the
// finger lifts), naming where it came from when it's history (FitNotes, Strava, Garmin). On the phone a card
// opens over the list (back closes it); in a wide window the list and the card sit side by side. Weight's
// top bar has "+ Weigh in", and a weigh-in tapped (a dot, or a row of the recent ones) opens to change or
// delete it, or hide an imported one. Sleep: the nights, resting HR and HRV, from sleep.json and the watch.
// The numbers come from domain/trends.ts and domain/sleep.ts; nothing here is stored but the user's weigh-ins and what they hid.
import { type ReactNode, useMemo, useState } from "react";
import { formatDate, today as todayEpoch } from "../../domain/dates.ts";
import { dayOf, repBests } from "../../domain/training.ts";
import {
  type BodyWeight, type LiftPoint, type Run, bodyWeights, easyRuns, hiddenId, liftPoints, longRuns, sourceName, targetRpeOf, weeklyChange,
  weeklyHardSets, weeklyKm, weightTrend,
} from "../../domain/trends.ts";
import { type SleepField, type SleepNight, type SleepSource, avg7, avg7Line, clockOfMoment, fmtSleep, hrvRange, restingHrFlag } from "../../domain/sleep.ts";
import { type LoadedPlan, type Training, saveHidden, saveWeighIn } from "../../store/training.ts";
import { useWide } from "../../platform.ts";
import { go, replaceRoute } from "../shared/common.tsx";
import { type RangeKey, DEFAULT_RANGE, dayMonth, inRange, rangeStart, signed, xDomain } from "./chartMath.ts";
import { EmptyHint, MIcon, Scaffold, Segmented } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { BottomSheet, SheetButtons, TextButton, showSnackbar } from "./m3.tsx";
import { type Pt, type Series, Chart, GYM, GYM_DIM, PAIN, RUN, RangeSwitch, SLEEP, SLEEP_DIM, Spark, WEIGHT, WEIGHT_DIM } from "./ProgressChart.tsx";
import { SlideStepper } from "./SlideStepper.tsx";
import { allExercises, bestWord, fmtKg, planQ, randomId, shownBests } from "./trainingParts.tsx";
import "./progress.css";

type Tab = "lifts" | "runs" | "weight" | "sleep" | "nutrition";
const TABS: [Tab, string][] = [["lifts", "Lifts"], ["runs", "Runs"], ["weight", "Weight"], ["sleep", "Sleep"], ["nutrition", "Nutrition"]];
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

// ---------- Formats ----------

/** "6:10" from seconds. */
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
/** "16", "13.1": km to 0.1. */
const km1 = (km: number) => String(Math.round(km * 10) / 10);
/** "+0.2", "−1.4", "0": to 0.1, with its sign. */
const signed1 = (v: number) => { const r = Math.round(v * 10) / 10; return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : "0"; };
const from = (source: string | null) => { const n = sourceName(source); return n ? `from ${n}` : ""; };
const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ");

// ---------- The page ----------

/** One row of a tab's list: its name and line under it, the sparkline, the number and the line under it. */
interface Row { id: string; name: string; sub: string; spark: ReactNode; value: string; valueSub: string; group: string; open?: boolean }

export function TrainingProgress({ tr, lp, query, planId }: { tr: Training; lp: LoadedPlan; query: URLSearchParams; planId: string | null }) {
  const wide = useWide();
  const t = todayEpoch();
  const tab = (TABS.find(([k]) => k === query.get("tab"))?.[0] ?? "lifts") as Tab;
  const card = query.get("c");
  const [weighing, setWeighing] = useState(false);
  const rows = useMemo(() => rowsOf(tr, lp, tab, t), [tr, lp, tab, t]);
  const open = (id: string) => {
    feel("tick");
    // Wide, the open card is swapped in place, so back leaves Progress rather than going through each card.
    if (wide && card) replaceRoute(route(tab, id, planId)); else go(route(tab, id, planId));
  };
  const weighIn = tab === "weight" && <TextButton className="pg-act" onClick={() => setWeighing(true)}>+ Weigh in</TextButton>;
  const sheet = weighing && <WeighInSheet tr={tr} t={t} onClose={() => setWeighing(false)} />;
  const cardView = card ? <CardView tr={tr} lp={lp} tab={tab} id={card} t={t} /> : null;

  if (!wide && card) {
    return <Scaffold title={cardTitle(tr, tab, card)} back flush actions={card === "w" ? weighIn : null}>
      <div className="p-content pg-page">{cardView}<div className="p-endspace" /></div>{sheet}
    </Scaffold>;
  }

  let group = "";
  const list = (
    <div className="p-content pg-page pg-list">
      <div className="pg-tabs">
        <Segmented value={tab} options={TABS} onChange={(k) => { feel("tick"); replaceRoute(route(k, null, planId)); }} />
      </div>
      {tab === "nutrition" && <div className="pg-soon">Later: from the meal photos you send to the Meals chat, against the plan's protein, carbs and fat.</div>}
      {tab !== "nutrition" && rows.length === 0 && <EmptyHint>{({
        lifts: "Lifts show here once sets are logged.", sleep: "Sleep shows here once your watch's data (Health Connect) or sleep.json arrives.",
      } as Record<string, string>)[tab] ?? "Runs show here once the plan session sends runs.json."}</EmptyHint>}
      {rows.map((r) => {
        const head = r.group !== group ? r.group : null;
        group = r.group;
        return <div key={r.id}>
          {head && <div className="pg-group">{head}</div>}
          <div className={`pg-row ${wide && card === r.id ? "sel" : ""} ${r.open === false ? "still" : ""}`} role={r.open === false ? undefined : "button"}
            onClick={r.open === false ? undefined : () => open(r.id)}>
            <div className="n"><b>{r.name}</b><span>{r.sub}</span></div>
            {r.spark}
            <div className="v">{r.value}<span>{r.valueSub}</span></div>
          </div>
        </div>;
      })}
      <div className="p-endspace" />
    </div>
  );

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

function cardTitle(tr: Training, tab: Tab, id: string): string {
  if (tab === "lifts") return liftName(tr, id);
  return ({ km: "Distance per week", long: "Long run", easy: "Easy pace", q: "Quality runs", w: "Weight", sl: "Sleep", rh: "Resting heart rate", hrv: "HRV" } as Record<string, string>)[id] ?? "Progress";
}

function CardView({ tr, lp, tab, id, t }: { tr: Training; lp: LoadedPlan; tab: Tab; id: string; t: number }) {
  if (tab === "lifts") return <LiftCards tr={tr} lp={lp} id={id} />;
  if (tab === "runs") return <RunCards tr={tr} id={id} t={t} />;
  if (tab === "weight") return <WeightCards tr={tr} t={t} />;
  if (tab === "sleep") return <SleepCards tr={tr} id={id} t={t} />;
  return null;
}

function rowsOf(tr: Training, lp: LoadedPlan, tab: Tab, t: number): Row[] {
  const since = rangeStart("3M", t);
  if (tab === "lifts") return liftRows(tr, since);
  if (tab === "runs") return runRows(tr, lp, since, t);
  if (tab === "weight") return weightRows(tr, since);
  if (tab === "sleep") return sleepRows(tr, t);
  return [];
}

// ---------- A card and its headline ----------

/**
 * A chart card: its title, the headline (its number, or the day a finger read on the chart, kept after it lifts
 * until a tap off the chart: [read] gives its two lines), the chart and what's under it.
 */
function ChartCard({ title, head, read, children, foot }: {
  title: string; head: ReactNode; read: [string, ReactNode] | null; children: ReactNode; foot?: ReactNode;
}) {
  return (
    <div className="pg-card">
      <div className="pg-ct"><span>{title}</span></div>
      <div className="pg-head">{read ? <div className="pg-ro"><div className="a">{read[0]}</div><div className="b">{read[1]}</div></div> : head}</div>
      {children}
      {foot}
    </div>
  );
}

/** The headline: a big number, a small word after it, and a chip with the change. */
const Head = ({ value, unit, chip }: { value: string; unit: string; chip?: string | null }) => (
  <div className="pg-hv">{value}<small>{unit}</small>{chip && <span className="pg-chip">{chip}</span>}</div>
);
const Empty = () => <div className="pg-none">Nothing in this range.</div>;

/** The range a card shows: its first day (null: from the first reading) and the axis's days. */
function useSpan(days: readonly number[], t: number): { range: RangeKey; setRange: (k: RangeKey) => void; start: number | null; domain: [number, number] } {
  const [range, setRange] = useRange();
  return { range, setRange, start: rangeStart(range, t), domain: xDomain(range, t, days) };
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
function liftsShown(tr: Training): { id: string; name: string; added: boolean; pts: LiftPoint[] }[] {
  const plans = tr.plans.map((p) => p.plan);
  const ids = [...allExercises(tr).values()].filter((e) => e.trackBests).map((e) => e.id);
  for (const s of tr.pastSets) if (!ids.includes(s.exerciseId)) ids.push(s.exerciseId);
  return ids.map((id) => {
    const name = liftName(tr, id);
    return { id, name, added: addedWeight(name), pts: liftPoints(tr.lifts, id, plans, tr.pastSets) };
  }).filter((x) => x.pts.length > 0);
}

/** Whether an exercise is drawn by its estimated max (else by its top set). */
const byMax = (added: boolean, pts: readonly LiftPoint[]) => !added && pts.some((p) => p.e1rm !== null);

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
  const shown = inRange(main, span.start);
  const [at, setAt] = useState<number | null>(null);
  const [weekAt, setWeekAt] = useState<number | null>(null);
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

  const hard = weeklyHardSets(tr.lifts, [id], span.start ?? pts[0].day, t, tr.pastSets);
  const wk = weekAt !== null ? hard[weekAt] : null;
  const tracked = allExercises(tr).get(id)?.trackBests ?? false;
  const bests = tracked ? repBests(tr.lifts, new Set([id]), lp.plan.bestsSince).get(id) : undefined;

  return <>
    <RangeSwitch value={span.range} onChange={(k) => { setAt(null); setWeekAt(null); span.setRange(k); }} />
    <ChartCard title={max ? "Estimated max" : added ? "Top set, added weight" : "Top set"} head={head} read={read}
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
      {shown.length ? <Chart series={series} rings={rings} domain={span.domain} today={t} height={160} reads={shown.map((q) => q.day)} onRead={setAt} /> : <Empty />}
    </ChartCard>
    <div className="pg-card">
      <div className="pg-ct"><span>Hard sets per week</span>{wk && <span className="pg-ct-read">Week of {dayMonth(wk.weekStart, t)} · {wk.sets} sets</span>}</div>
      {hard.some((w) => w.sets > 0)
        ? <Chart series={[{ kind: "bars", color: GYM, pts: hard.map((w) => ({ day: w.weekStart, v: w.sets })) }]} zero height={100} today={t}
            domain={[hard[0].weekStart, hard[hard.length - 1].weekStart + 7]} labels={[hard[0].weekStart, hard[hard.length - 1].weekStart]}
            reads={hard.map((w) => w.weekStart)} onRead={setWeekAt} />
        : <Empty />}
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

// ---------- Runs ----------

const qualityRuns = (runs: readonly Run[]) => runs.filter((r) => r.type === "quality" && r.avgHr !== null);

function runRows(tr: Training, lp: LoadedPlan, since: number | null, t: number): Row[] {
  const rows: Row[] = [];
  const runs = tr.runs;
  if (runs.length) {
    const weeks = weeklyKm(runs, since ?? runs[0].day, t);
    const now = weeks[weeks.length - 1], before = weeks[weeks.length - 2];
    rows.push({
      id: "km", group: "Runs", name: "Distance per week", sub: "this week", spark: <Spark bars values={weeks.map((w) => w.km)} color={RUN} />,
      value: `${km1(now.km)} km`, valueSub: before ? `${signed1(now.km - before.km)} km` : "",
    });
  }
  const long = longRuns(runs).filter((r) => r.distanceKm !== null);
  if (long.length) {
    const last = long[long.length - 1], most = Math.max(...long.map((r) => r.distanceKm!));
    rows.push({
      id: "long", group: "Runs", name: "Long run", sub: formatDate(last.day), spark: <Spark values={inRange(long, since).map((r) => r.distanceKm!)} color={RUN} />,
      value: `${km1(last.distanceKm!)} km`, valueSub: last.distanceKm! >= most ? "longest yet" : `longest ${km1(most)} km`,
    });
  }
  const easy = easyRuns(runs);
  if (easy.length) {
    const last = easy[easy.length - 1], recent = inRange(easy, since);
    const d = recent.length > 1 ? recent[0].paceSPerKm! - last.paceSPerKm! : null;
    rows.push({
      id: "easy", group: "Runs", name: "Easy pace", sub: `at ${last.avgHr} bpm`, spark: <Spark invert values={recent.map((r) => r.paceSPerKm!)} color={RUN} />,
      value: mmss(last.paceSPerKm!), valueSub: d === null ? dayMonth(last.day, t) : d === 0 ? "no change" : `${Math.abs(Math.round(d))} s ${d > 0 ? "faster" : "slower"}`,
    });
  }
  const q = qualityRuns(runs);
  if (q.length) {
    const last = q[q.length - 1];
    rows.push({
      id: "q", group: "Runs", name: "Quality runs", sub: "avg heart rate", spark: <Spark values={inRange(q, since).map((r) => r.avgHr!)} color={RUN} />,
      value: String(last.avgHr), valueSub: last.cadenceSpm !== null ? `cadence ${Math.round(last.cadenceSpm)}` : dayMonth(last.day, t),
    });
  }
  // The plan's run records (they were on the Bests page): kept here, as plain rows.
  lp.plan.records.runs.forEach((r, i) => rows.push({
    id: `rec${i}`, group: "Records", name: r.distance, sub: join(r.day !== null ? dayMonth(r.day, t) : "", r.note), spark: null, value: r.time, valueSub: "", open: false,
  }));
  return rows;
}

function RunCards({ tr, id, t }: { tr: Training; id: string; t: number }) {
  const runs = tr.runs;
  const [at, setAt] = useState<number | null>(null);
  const [at2, setAt2] = useState<number | null>(null);
  const span = useSpan(runs.map((r) => r.day), t);
  const switcher = <RangeSwitch value={span.range} onChange={(k) => { setAt(null); setAt2(null); span.setRange(k); }} />;
  if (!runs.length) return <EmptyHint>No runs yet.</EmptyHint>;

  if (id === "km") {
    const weeks = weeklyKm(runs, span.start ?? runs[0].day, t);
    const now = weeks[weeks.length - 1], before = weeks[weeks.length - 2];
    const w = at !== null ? weeks[at] : null;
    const count = w ? runs.filter((r) => r.day >= w.weekStart && r.day < w.weekStart + 7).length : 0;
    return <>{switcher}<ChartCard title="Km per week" read={w ? [`Week of ${dayMonth(w.weekStart, t)}`, <>{km1(w.km)} km <small>{count === 1 ? "1 run" : `${count} runs`}</small></>] : null}
      head={<Head value={km1(now.km)} unit="km this week" chip={before ? `${signed1(now.km - before.km)} km on last week` : null} />}>
      <Chart series={[{ kind: "bars", color: RUN, pts: weeks.map((x) => ({ day: x.weekStart, v: x.km })) }]} zero height={140} today={t}
        domain={[weeks[0].weekStart, weeks[weeks.length - 1].weekStart + 7]} labels={[weeks[0].weekStart, weeks[weeks.length - 1].weekStart]}
        reads={weeks.map((x) => x.weekStart)} onRead={setAt} />
    </ChartCard></>;
  }

  /** A line of runs by [value] (km, pace, heart rate...), read with its day, the run's line and its source. */
  const runChart = (list: Run[], value: (r: Run) => number, opts: { fmt?: (v: number) => string; invert?: boolean; zero?: boolean }, onRead: (i: number | null) => void) => {
    const shown = inRange(list, span.start);
    return shown.length
      ? <Chart series={[{ kind: "line", color: RUN, pts: shown.map((r) => ({ day: r.day, v: value(r) })) }]} domain={xDomain(span.range, t, list.map((r) => r.day))} today={t} height={140}
          fmt={opts.fmt} invert={opts.invert} zero={opts.zero} reads={shown.map((r) => r.day)} onRead={onRead} />
      : <Empty />;
  };
  const readRun = (r: Run, b: ReactNode): [string, ReactNode] => [join(formatDate(r.day), r.title, from(r.source)), b];

  if (id === "long") {
    const long = longRuns(runs).filter((r) => r.distanceKm !== null), shown = inRange(long, span.start);
    const most = shown.reduce<Run | null>((m, r) => (!m || r.distanceKm! > m.distanceKm! ? r : m), null);
    const r = at !== null ? shown[at] : null;
    return <>{switcher}<ChartCard title="Long run" read={r ? readRun(r, <>{km1(r.distanceKm!)} km <small>{join(r.paceSPerKm !== null && `${mmss(r.paceSPerKm)} /km`, r.avgHr !== null && `${r.avgHr} bpm`)}</small></>) : null}
      head={most ? <Head value={km1(most.distanceKm!)} unit={`km longest, ${formatDate(most.day)}`} /> : <Head value="–" unit="km" />}>
      {runChart(long, (x) => x.distanceKm!, { zero: true }, setAt)}
    </ChartCard></>;
  }

  if (id === "easy") {
    const easy = easyRuns(runs), shown = inRange(easy, span.start);
    const last = shown[shown.length - 1], first = shown[0];
    const d = shown.length > 1 ? first.paceSPerKm! - last.paceSPerKm! : null;
    const r = at !== null ? shown[at] : null;
    return <>{switcher}<ChartCard title="Easy pace (148 bpm or under)" read={r ? readRun(r, <>{mmss(r.paceSPerKm!)} <small>/km at {r.avgHr} bpm{r.distanceKm !== null ? ` · ${km1(r.distanceKm)} km` : ""}</small></>) : null}
      head={last ? <Head value={mmss(last.paceSPerKm!)} unit={`/km at ${last.avgHr} bpm`} chip={d === null ? null : d === 0 ? "no change" : `${Math.abs(Math.round(d))} s ${d > 0 ? "faster" : "slower"}`} /> : <Head value="–" unit="/km" />}
      foot={<div className="pg-foot">Faster is higher. Walk/run mixes slower than 9:00 /km are left out.</div>}>
      {runChart(easy, (x) => x.paceSPerKm!, { fmt: mmss, invert: true }, setAt)}
    </ChartCard></>;
  }

  // Quality runs: average heart rate, then cadence (the runs that have it; the old Strava runs don't).
  const q = qualityRuns(runs), shown = inRange(q, span.start);
  const last = shown[shown.length - 1], first = shown[0];
  const r = at !== null ? shown[at] : null;
  const withCadence = q.filter((x) => x.cadenceSpm !== null), cad = inRange(withCadence, span.start);
  const c = at2 !== null ? cad[at2] : null;
  return <>{switcher}
    <ChartCard title="Average heart rate" read={r ? readRun(r, <>{r.avgHr} bpm <small>{join(r.paceSPerKm !== null && `${mmss(r.paceSPerKm)} /km`, r.cadenceSpm !== null && `cadence ${Math.round(r.cadenceSpm)}`)}</small></>) : null}
      head={last ? <Head value={String(last.avgHr)} unit="bpm average" chip={shown.length > 1 ? `${signed(last.avgHr! - first.avgHr!)} since ${dayMonth(first.day, t)}` : null} /> : <Head value="–" unit="bpm" />}>
      {runChart(q, (x) => x.avgHr!, {}, setAt)}
    </ChartCard>
    {withCadence.length > 0 && (
      <div className="pg-card">
        <div className="pg-ct"><span>Cadence</span>{c && <span className="pg-ct-read">{join(dayMonth(c.day, t), `${Math.round(c.cadenceSpm!)} steps/min`, from(c.source))}</span>}</div>
        {runChart(withCadence, (x) => x.cadenceSpm!, {}, setAt2)}
      </div>
    )}
  </>;
}

// ---------- Weight ----------

function weightData(tr: Training) {
  const all = bodyWeights(tr.weighIns, tr.pastWeighIns, tr.hiddenWeighIns);
  return { all, trend: weightTrend(all) };
}

function weightRows(tr: Training, since: number | null): Row[] {
  const { all, trend } = weightData(tr);
  const rows: Row[] = [];
  if (trend.length) {
    const recent = inRange(trend, since), last = trend[trend.length - 1], wk = weeklyChange(trend), n = inRange(all, since).length;
    rows.push({
      id: "w", group: "Weight", name: "Trend", sub: `from ${n === 1 ? "1 weigh-in" : `${n} weigh-ins`}`,
      spark: <Spark values={recent.map((p) => p.trend)} color={WEIGHT} />, value: last.trend.toFixed(1), valueSub: wk !== null ? `${signed1(wk)} kg/wk` : "",
    });
  }
  return rows;
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
  const shown = inRange(trend, span.start);
  const raw = inRange(all, span.start);
  const last = trend[trend.length - 1];
  const wk = weeklyChange(trend);
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
    <RangeSwitch value={span.range} onChange={(k) => { setAt(null); span.setRange(k); }} />
    <ChartCard title="Weight" read={read}
      head={last ? <Head value={last.trend.toFixed(1)} unit="kg trend" chip={wk !== null ? `${signed1(wk)} kg / week` : null} /> : <Head value="–" unit="kg" />}
      foot={<>
        <div className="pg-leg"><span><i className="ln" style={{ background: WEIGHT }} />Trend</span><span><i className="dt" style={{ background: WEIGHT_DIM }} />Each weigh-in</span></div>
        <div className="pg-foot">One weigh-in can swing 1–2 kg with water; follow the line. A day with several weigh-ins counts their average.</div>
      </>}>
      {shown.length
        ? <Chart series={[
            { kind: "dots", r: 3, color: WEIGHT_DIM, pts: raw.map((w) => ({ day: w.day, v: w.kg })) },
            { kind: "line", dots: false, color: WEIGHT, pts: shown.map((q) => ({ day: q.day, v: q.trend })) },
          ]} domain={span.domain} today={t} height={150} fmt={(v) => String(v)} reads={shown.map((q) => q.day)} onRead={setAt}
            onTap={(i) => openDay(shown[i].day)} />
        : <Empty />}
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

/** The mornings that have [field], oldest first. */
const withField = (nights: readonly SleepNight[], field: SleepField) => nights.filter((n) => n[field] !== null);
/** "last night" ("this morning") for today's, else its date. */
const whenOf = (day: number, t: number, today: string) => (day === t ? today : formatDate(day));

function sleepRows(tr: Training, t: number): Row[] {
  const rows: Row[] = [];
  const add = (id: string, name: string, field: SleepField, today: string, value: (v: number) => string, bars = false) => {
    const list = withField(tr.sleep, field);
    const last = list[list.length - 1];
    if (!last) return;
    const avg = avg7(tr.sleep, field, last.day);
    rows.push({
      id, group: "Sleep", name, sub: whenOf(last.day, t, today),
      spark: <Spark bars={bars} values={list.slice(bars ? -10 : -14).map((n) => n[field]!)} color={SLEEP} />,
      value: value(last[field]!), valueSub: avg !== null ? `avg ${value(avg)}` : "",
    });
  };
  add("sl", "Sleep", "totalMin", "last night", fmtSleep, true);
  add("rh", "Resting heart rate", "restingHr", "this morning", (v) => String(Math.round(v)));
  add("hrv", "HRV", "hrvMs", "last night", (v) => `${Math.round(v)} ms`);
  return rows;
}

/** Where a sleep number came from, for its reading: sleep.json's "from Garmin"; the watch's own needs no word. */
const fromSleep = (s: SleepSource | null) => (s === "garmin" ? from(s) : "");

/** "deep 1 h 10 · light 4 h 20 · REM 1 h 42", for the stages known. */
const stagesOf = (n: SleepNight) => join(n.deepMin !== null && `deep ${fmtSleep(n.deepMin)}`, n.lightMin !== null && `light ${fmtSleep(n.lightMin)}`, n.remMin !== null && `REM ${fmtSleep(n.remMin)}`);

/**
 * The Sleep tab's cards: sleep per night (a bar a night and the 7-day line), resting heart rate (each
 * morning, the 7-day line, a ring on the days it's flagged) and HRV (each night, the 7-day line and the
 * normal range shaded). Touching a point reads it with where it came from.
 */
function SleepCards({ tr, id, t }: { tr: Training; id: string; t: number }) {
  const field: SleepField = id === "rh" ? "restingHr" : id === "hrv" ? "hrvMs" : "totalMin";
  const list = useMemo(() => withField(tr.sleep, field), [tr, field]);
  const line = useMemo(() => avg7Line(tr.sleep, field), [tr, field]);
  const span = useSpan(list.map((n) => n.day), t);
  const [at, setAt] = useState<number | null>(null);
  const switcher = <RangeSwitch value={span.range} onChange={(k) => { setAt(null); span.setRange(k); }} />;
  if (!list.length) return <EmptyHint>No nights yet.</EmptyHint>;
  const shown = inRange(list, span.start);
  const avgPts = inRange(line, span.start);
  const last = list[list.length - 1];
  const lastAvg = avg7(tr.sleep, field, last.day);
  const n = at !== null ? shown[at] : null;
  const nAvg = n && avg7(tr.sleep, field, n.day);
  const legend = (each: string, extra?: ReactNode) => (
    <div className="pg-leg"><span><i className="ln" style={{ background: SLEEP }} />7-day average</span><span><i className="dt" style={{ background: SLEEP_DIM }} />{each}</span>{extra}</div>
  );
  const chart = (series: Series[], opts: { fmt?: (v: number) => string; zero?: boolean; rings?: Pt[]; bars?: boolean } = {}) => shown.length
    // A night's bar stands over its day, so the axis runs a day longer and its line goes through the bars' middles.
    ? <Chart series={series} domain={opts.bars ? [span.domain[0], span.domain[1] + 1] : span.domain} labels={opts.bars ? span.domain : undefined} today={t} height={150}
        fmt={opts.fmt} zero={opts.zero} rings={opts.rings} reads={shown.map((x) => x.day)} onRead={setAt} />
    : <Empty />;

  if (field === "totalMin") {
    // A bar a night; over a long range, where bars would be hairlines, a small dot instead.
    const pts = shown.map((x) => ({ day: x.day, v: x.totalMin! / 60 })); // drawn in hours
    const bars = shown.length <= 120;
    const each: Series = bars ? { kind: "bars", span: 1, color: SLEEP_DIM, pts } : { kind: "dots", r: 2.5, color: SLEEP_DIM, pts };
    const bed = n && n.bed && n.wake ? `bed ${clockOfMoment(n.bed)} → ${clockOfMoment(n.wake)}` : "";
    return <>{switcher}<ChartCard title="Sleep per night"
      read={n ? [join(`Night to ${formatDate(n.day)}`, bed, fromSleep(n.source)), <>{fmtSleep(n.totalMin!)} <small>{stagesOf(n)}</small></>] : null}
      head={<Head value={fmtSleep(last.totalMin!)} unit={whenOf(last.day, t, "last night")} chip={lastAvg !== null ? `7-day avg ${fmtSleep(lastAvg)}` : null} />}
      foot={<>{legend("Each night")}<div className="pg-foot">Under 6 h before a quality or long run puts a moon on that session.</div></>}>
      {chart([each, { kind: "line", dots: false, color: SLEEP, pts: avgPts.map((p) => ({ day: p.day + (bars ? 0.5 : 0), v: p.v / 60 })) }], { fmt: (v) => `${v} h`, zero: true, bars })}
    </ChartCard></>;
  }

  if (field === "restingHr") {
    const rings = shown.filter((x) => restingHrFlag(tr.sleep, x.day)).map((x) => ({ day: x.day, v: x.restingHr! }));
    return <>{switcher}<ChartCard title="Resting heart rate"
      read={n ? [join(formatDate(n.day), fromSleep(n.restingHrSource)), <>{n.restingHr} bpm <small>{join(nAvg !== null && `7-day avg ${Math.round(nAvg)}`, restingHrFlag(tr.sleep, n.day) && "up two mornings running")}</small></>] : null}
      head={<Head value={String(last.restingHr)} unit={`bpm ${whenOf(last.day, t, "this morning")}`} chip={lastAvg !== null ? `7-day avg ${Math.round(lastAvg)}` : null} />}
      foot={<>{legend("Each morning", rings.length > 0 && <span><i className="ho" style={{ borderColor: PAIN }} />Up 7+ two mornings running</span>)}
        <div className="pg-foot">7 or more above your 7-day average two mornings running puts a quiet marker on the day.</div></>}>
      {chart([{ kind: "dots", r: 3, color: SLEEP_DIM, pts: shown.map((x) => ({ day: x.day, v: x.restingHr! })) }, { kind: "line", dots: false, color: SLEEP, pts: avgPts }], { rings })}
    </ChartCard></>;
  }

  // HRV: the normal range as of each night, shaded.
  const band = shown.flatMap((x) => { const r = hrvRange(tr.sleep, x.day); return r ? [{ day: x.day, lo: r.lo, hi: r.hi }] : []; });
  const range = hrvRange(tr.sleep, last.day);
  const nRange = n && hrvRange(tr.sleep, n.day);
  return <>{switcher}<ChartCard title="HRV (overnight)"
    read={n ? [join(formatDate(n.day), fromSleep(n.hrvSource)), <>{n.hrvMs} ms <small>{join(nAvg !== null && `7-day avg ${Math.round(nAvg)}`, nRange && `normal ${Math.round(nRange.lo)}–${Math.round(nRange.hi)}`)}</small></>] : null}
    head={<Head value={String(last.hrvMs)} unit={`ms ${whenOf(last.day, t, "last night")}`} chip={lastAvg !== null ? `7-day avg ${Math.round(lastAvg)}` : null} />}
    foot={<>{legend("Each night", band.length > 0 && <span><i className="bd" style={{ background: SLEEP }} />Your normal range</span>)}
      <div className="pg-foot">{range ? `Normal for you: ${Math.round(range.lo)}–${Math.round(range.hi)} ms, the last 60 nights' average ± 1 SD. ` : ""}A few nights in a row below the band: make it an easy day.</div></>}>
    {chart([{ kind: "band", color: SLEEP, pts: band }, { kind: "dots", r: 3, color: SLEEP_DIM, pts: shown.map((x) => ({ day: x.day, v: x.hrvMs! })) }, { kind: "line", dots: false, color: SLEEP, pts: avgPts }])}
  </ChartCard></>;
}

/**
 * The weigh-in sheet. "+ Weigh in" (no [edit]): the weight by the slide stepper (0.1 kg a step), saved for
 * today at the time now. One of the user's own: the same stepper to change its weight (its day and time
 * stay), with Delete. One from the history: its weight, read-only, with Hide. Each has an Undo.
 */
function WeighInSheet({ tr, t, edit, onClose }: { tr: Training; t: number; edit?: BodyWeight; onClose: () => void }) {
  const own = edit?.source === "planner" ? tr.weighIns.find((w) => w.id === edit.id) : undefined;
  const lastKg = useMemo(() => { const all = bodyWeights(tr.weighIns, tr.pastWeighIns, tr.hiddenWeighIns); return all[all.length - 1]?.kg ?? 75; }, [tr]);
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
