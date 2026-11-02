// Progress's Cardio tab (items 294, 269; mockup 2.8.6 section 1 with top row B): a Runs | Futsal switch and the
// compact range menu; the range sets everything below it. Runs: a Distance | Time chart whose bars the range
// picks, four tiles, the switch that counts futsal in the totals, the run types, each opening its own stats, then
// the runs and the plan's records. Futsal: heart rate per game, four tiles, and the games, named after their
// calendar events. A run or a game opens its card, with its note. The numbers come from domain/cardio.ts, the
// range's windows from chartMath.ts, the charts' touch from ProgressChart.tsx.
import { type ReactNode, useMemo, useState } from "react";
import { formatDate, formatTime } from "../../domain/dates.ts";
import {
  type ActivityNote, type Game, type Tally, RUN_TYPE_NAMES, fastest5k, finishedAverage, gameNote, gameSeconds, gameStats, gameVenue, gameWatch, longestRun, perWeek, playedGames, recordFor, runEntry,
  runNote, runSeconds, runTypeName, tally, tallyHours, typeStats,
} from "../../domain/cardio.ts";
import type { Run, RunType } from "../../domain/trends.ts";
import { type LoadedPlan, type Training, saveGameNote, saveRunNote } from "../../store/training.ts";
import { type TimeWindow, type WindowKey, WINDOWS, allWindows, barLabels, dayMonth, hasEarlier, rangeWindow } from "./chartMath.ts";
import { EmptyHint, MIcon, Segmented } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { type Pan, Chart, FUTSAL, GREY, PanBar, RUN, RangeMenu, RangeSwitch, Spark } from "./ProgressChart.tsx";
import { Switch, TextButton } from "./m3.tsx";
import { ChartCard, Head, from, join, kmFixed, mmss, tapProps, Tile } from "./progressParts.tsx";
import { kindIcon } from "./trainingParts.tsx";
import { fmtSteps } from "../../domain/body.ts";
import { fmtSleep } from "../../domain/sleep.ts";
import { hhmm } from "./WatchRuns.tsx";

type View = "runs" | "futsal";
const VIEWS: [View, string][] = [["runs", "Runs"], ["futsal", "Futsal"]];
type Metric = "Distance" | "Time";
const METRICS: [Metric, string][] = [["Distance", "Distance"], ["Time", "Time"]];
/** Whether futsal counts in the totals, kept on this device. */
const COUNT_KEY = "cardioCountFutsal";

// The view and the range stay until the app restarts, for this tab and the cards it opens.
let keptView: View = "runs";
let keptRange: WindowKey = "3M";
let keptMetric: Metric = "Distance";

/** Opens the tab on this view: the overview's Runs and Futsal tiles (301). */
export const showCardio = (v: View) => { keptView = v; };

export interface CardioState {
  view: View; setView: (v: View) => void; range: WindowKey; setRange: (k: WindowKey) => void; metric: Metric; setMetric: (m: Metric) => void; count: boolean; setCount: (v: boolean) => void;
  /** How many windows back the charts, the tiles and the lists are (302). */
  back: number; setBack: (n: number) => void;
}

export function useCardio(): CardioState {
  const [view, setV] = useState(keptView);
  const [range, setR] = useState(keptRange);
  const [metric, setM] = useState(keptMetric);
  const [count, setC] = useState(() => localStorage.getItem(COUNT_KEY) === "1");
  const [back, setBack] = useState(0);
  return {
    back, setBack,
    view, setView: (v) => { keptView = v; setV(v); }, range, setRange: (k) => { keptRange = k; setR(k); setBack(0); }, metric, setMetric: (m) => { keptMetric = m; setM(m); },
    count, setCount: (v) => { localStorage.setItem(COUNT_KEY, v ? "1" : "0"); setC(v); },
  };
}

/** The first day anything happened, for All; today when nothing has. */
const firstDay = (tr: Training, games: readonly Game[], t: number) => Math.min(t, tr.runs[0]?.day ?? t, games[0]?.day ?? t);

function useWindow(tr: Training, st: CardioState, t: number): { win: TimeWindow; games: Game[]; first: number; pan: Pan } {
  const games = useMemo(() => playedGames(tr.games, t), [tr, t]);
  const first = firstDay(tr, games, t), win = rangeWindow(st.range, t, first, st.back);
  const pan: Pan = {
    id: st.range, label: win.label, back: st.back, canBack: hasEarlier(st.range, t, first, st.back), canFwd: st.back > 0,
    step: (d) => st.setBack(Math.max(0, st.back + d)), now: () => st.setBack(0),
  };
  return { win, games, first, pan };
}

/** How many rows a list shows until "Show all". */
const LATEST = 4, LATEST_GAMES = 6;
const runsWord = (n: number) => (n === 1 ? "1 run" : `${n} runs`);
const gamesWord = (n: number) => (n === 1 ? "1 game" : `${n} games`);
const pace = (s: number | null) => (s === null ? "" : `${mmss(s)} / km`);
const hours = (h: number) => fmtSleep(h * 60);

// ---------- Cards' routes ----------

const typeOf = (id: string) => id.slice("type:".length) as RunType;

export function cardioTitle(id: string): string {
  if (id.startsWith("type:")) return `${runTypeName(typeOf(id))} runs`;
  if (id.startsWith("game:")) return "Game";
  if (id.startsWith("run:")) return "Run";
  return "Cardio";
}

export function CardioCards({ tr, id, t, st, onOpen }: { tr: Training; id: string; t: number; st: CardioState; onOpen: (id: string) => void }) {
  if (id.startsWith("type:")) return <TypeCards tr={tr} type={typeOf(id)} t={t} st={st} onOpen={onOpen} />;
  if (id.startsWith("run:")) {
    const r = tr.runs.find((x) => x.id === id.slice(4));
    return r ? <RunCard key={r.id} tr={tr} r={r} /> : <EmptyHint>This run isn't here any more.</EmptyHint>;
  }
  if (id.startsWith("game:")) {
    const g = tr.games.find((x) => x.id === id.slice(5));
    return g ? <GameCard key={g.id} tr={tr} g={g} t={t} /> : <EmptyHint>This game isn't here any more.</EmptyHint>;
  }
  return null;
}

// ---------- The tab ----------

export function CardioList({ tr, lp, t, st, sel, onOpen }: { tr: Training; lp: LoadedPlan; t: number; st: CardioState; sel: string | null; onOpen: (id: string) => void }) {
  const { win, games, first, pan } = useWindow(tr, st, t);
  const now = useMemo(() => tally(tr.runs, games, win.from, win.to), [tr, games, win.from, win.to]);
  return <>
    <div className="pg-toprow">
      <div className="pg-view"><Segmented value={st.view} options={VIEWS} onChange={(v) => { feel("tick"); st.setView(v); }} /></div>
      <RangeMenu value={st.range} onChange={st.setRange} />
    </div>
    {st.view === "runs"
      ? <>
        <TotalsChart tr={tr} games={games} win={win} now={now} st={st} t={t} first={first} pan={pan} />
        <RunTiles tr={tr} lp={lp} win={win} now={now} count={st.count} t={t} />
        <div className="pg-setrow">
          <div className="tx">Count futsal in the totals<small>{st.count ? `Adds ${gamesWord(now.games.length)} to time and sessions. Km stay runs only.` : "Totals are runs only."}</small></div>
          <Switch checked={st.count} label="Count futsal in the totals" onChange={(v) => { feel("tick"); st.setCount(v); }} />
        </div>
        <RunsPage tr={tr} lp={lp} runs={now.runs} t={t} sel={sel} onOpen={onOpen} />
      </>
      : <FutsalPage pan={pan} list={now.games} notes={tr.notes} t={t} sel={sel} onOpen={onOpen} />}
    <div className="p-endspace" />
  </>;
}

/**
 * The chart on top: distance or time in the window, a bar per day, week or month as the range picks. The
 * still-filling bar is paler and the finished ones' average a dashed line. With futsal counted, games join
 * the time in the same colour; reading a bar shows how it splits. Its scale is the highest bar of any window at
 * this range, so one window compares fairly with the next.
 */
function TotalsChart({ tr, games, win, now, st, t, first, pan }: { tr: Training; games: readonly Game[]; win: TimeWindow; now: Tally; st: CardioState; t: number; first: number; pan: Pan }) {
  const [at, setAt] = useState<number | null>(null);
  const time = st.metric === "Time";
  const per = useMemo(() => win.bars.map((b) => tally(tr.runs, games, b.from, b.to)), [tr, games, win]);
  const value = (x: Tally) => (time ? tallyHours(x, st.count) : x.km);
  const vals = per.map(value);
  const top = useMemo(
    () => Math.max(0, ...allWindows(st.range, t, first).flatMap((w) => w.bars.map((b) => value(tally(tr.runs, games, b.from, b.to))))),
    [tr, games, st.range, st.metric, st.count, t, first], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const avg = win.unit === "day" ? null : finishedAverage(win.bars, vals);
  const live = win.bars.flatMap((b, i) => (b.future ? [] : [i]));
  const unit = win.unit === "week" ? "wk" : "mo";
  const i = at !== null ? live[at] : null, b = i !== null ? win.bars[i] : null, x = i !== null ? per[i] : null;
  const total = time ? hours(tallyHours(now, st.count)) : kmFixed(now.km);
  const read: [string, ReactNode] | null = b && x
    ? [join(b.title, b.now && "so far"), time
      ? <>{hours(tallyHours(x, st.count))} <small>{st.count && x.games.length ? `runs ${hours(x.runS / 3600)} + futsal ${hours(x.gameS / 3600)}` : ""}</small></>
      : <>{kmFixed(x.km)} km <small>{runsWord(x.runs.length)}</small></>]
    : null;
  return (
    <ChartCard title={st.metric} read={read} pan={pan}
      side={<span className="pg-metric"><Segmented value={st.metric} options={METRICS} onChange={(m) => { feel("tick"); setAt(null); st.setMetric(m); }} /></span>}
      head={<Head value={total} unit={time ? "" : "km"} chip={avg !== null ? `avg ${time ? hours(avg) : `${Math.round(avg)} km`} / ${unit}` : null} />}
      foot={<div className="pg-leg">
        <span><i className="bx" style={{ background: RUN }} />{time && st.count ? "Runs + futsal" : "Runs"}, per {win.unit}</span>
        {avg !== null && <span><i className="ln" style={{ background: GREY }} />Average</span>}
      </div>}>
      <Chart series={[{ kind: "bars", color: RUN, maxW: 18, pts: live.map((k) => ({ day: win.bars[k].from, v: vals[k], span: win.bars[k].to - win.bars[k].from, dim: win.bars[k].now && win.unit !== "day" })) }]}
        zero top={top} pan={pan} domain={[win.from, win.to]} today={t} height={150} xLabels={barLabels(win.bars)} avg={avg} fmt={time ? (v) => `${v} h` : undefined}
        reads={live.map((k) => win.bars[k].from)} onRead={setAt} />
    </ChartCard>
  );
}

/** The four tiles under the chart: sessions, time, the longest run and the fastest 5 km in the window. */
function RunTiles({ tr, lp, win, now, count, t }: { tr: Training; lp: LoadedPlan; win: TimeWindow; now: Tally; count: boolean; t: number }) {
  const long = longestRun(now.runs), ever = longestRun(tr.runs), fast = fastest5k(now.runs), rec = recordFor(lp.plan.records.runs, "5 km");
  const games = now.games.length, n = now.runs.length;
  return (
    <div className="pg-tiles">
      <Tile a={count ? "Sessions" : "Runs"} b={String(n + (count ? games : 0))}
        c={count ? `${runsWord(n)} + ${gamesWord(games)}` : `${perWeek(n, win.from, win.to, t).toFixed(1)} a week`} />
      <Tile a="Time" b={hours(tallyHours(now, count))} c={count ? `with ${hours(now.gameS / 3600)} of futsal` : "runs only"} />
      <Tile a="Longest run" b={long ? <>{kmFixed(long.distanceKm!)} <small>km</small></> : "—"} c={long ? join(formatDate(long.day), ever && `ever ${kmFixed(ever.distanceKm!)}`) : "none in this range"} />
      <Tile a="Fastest 5 km" b={fast ? mmss(fast.s) : "—"} c={fast ? join(dayMonth(fast.run.day, t), rec && `record ${rec.time}`) : "none in this range"} />
    </div>
  );
}

/** The latest of a list, newest first, with "Show all" under them. */
function Latest<T>({ list, shown, row }: { list: readonly T[]; shown: number; row: (x: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  const newest = [...list].reverse();
  return <>
    {(all ? newest : newest.slice(0, shown)).map(row)}
    {!all && list.length > shown && <button className="pg-link" onClick={() => { feel("tick"); setAll(true); }}>Show all {list.length}</button>}
  </>;
}

function Group({ title, right }: { title: string; right?: string }) {
  return <div className="pg-group pg-gr"><span>{title}</span>{right && <span className="r">{right}</span>}</div>;
}

/** A row's one line of its note. */
const NoteLine = ({ note }: { note: string }) => (note ? <span className="nt"><MIcon name="oDescription" size={14} /><em>{note}</em></span> : null);

function RunRow({ r, note, sel, onOpen }: { r: Run; note: string; sel: string | null; onOpen: (id: string) => void }) {
  const id = `run:${r.id}`;
  return (
    <div className={`pg-row ${sel === id ? "sel" : ""}`} {...tapProps(() => onOpen(id))}>
      <span className="tr-bub k-run"><MIcon name={kindIcon("run")} size={20} /></span>
      <div className="n"><b>{r.title}</b><span>{join(formatDate(r.day), r.distanceKm !== null && `${kmFixed(r.distanceKm)} km`, pace(r.paceSPerKm))}</span><NoteLine note={note} /></div>
      <div className="v">{fmtSleep(runSeconds(r) / 60)}<span>{r.avgHr !== null ? `${Math.round(r.avgHr)} bpm` : ""}</span></div>
    </div>
  );
}

function RunsPage({ tr, lp, runs, t, sel, onOpen }: { tr: Training; lp: LoadedPlan; runs: Run[]; t: number; sel: string | null; onOpen: (id: string) => void }) {
  const stored = [...tr.entries.values()];
  return <>
    <Group title="By type" right="tap one for its stats" />
    {RUN_TYPE_NAMES.map(([type, name]) => {
      const rs = runs.filter((r) => r.type === type), st = typeStats(rs), id = `type:${type}`;
      if (!rs.length && (type === "race" || type === "other")) return null;
      const paced = rs.filter((r) => r.paceSPerKm !== null).slice(-12);
      return (
        <div key={type} className={`pg-row ${sel === id ? "sel" : ""}`} {...tapProps(() => onOpen(id))}>
          <div className="n"><b>{name}</b><span>{rs.length ? join(runsWord(rs.length), pace(st.paceS), st.hr !== null && `${Math.round(st.hr)} bpm`) : "none in this range"}</span></div>
          {paced.length > 1 && <Spark invert values={paced.map((r) => r.paceSPerKm!)} color={RUN} />}
          <div className="v">{rs.length ? kmFixed(st.km) : "—"}<span>{rs.length ? "km" : ""}</span></div>
        </div>
      );
    })}
    <Group title="Runs" right={runs.length > LATEST ? `latest of ${runs.length}` : undefined} />
    {runs.length ? <Latest key={runs.length} list={runs} shown={LATEST} row={(r) => <RunRow key={r.id} r={r} note={runNote(r, stored, tr.notes)} sel={sel} onOpen={onOpen} />} /> : <div className="pg-hint">No runs in this range.</div>}
    {lp.plan.records.runs.length > 0 && <Group title="Records" />}
    {lp.plan.records.runs.map((r, i) => (
      <div key={i} className="pg-row still"><div className="n"><b>{r.distance}</b><span>{join(r.day !== null && dayMonth(r.day, t), r.note)}</span></div><div className="v">{r.time}</div></div>
    ))}
  </>;
}

function GameRow({ g, note, sel, onOpen }: { g: Game; note: string; sel: string | null; onOpen: (id: string) => void }) {
  const id = `game:${g.id}`, w = gameWatch(g), s = gameSeconds(g);
  return (
    <div className={`pg-row ${sel === id ? "sel" : ""}`} {...tapProps(() => onOpen(id))}>
      <span className="tr-bub k-futsal"><MIcon name={kindIcon("futsal")} size={20} /></span>
      <div className="n"><b>{g.title}</b><span>{join(formatDate(g.day), s > 0 && `${Math.round(s / 60)} min`, w?.distanceKm != null && `${w.approx ? "≈ " : ""}${kmFixed(w.distanceKm)} km`, !g.fromEvent && "no event")}</span><NoteLine note={note} /></div>
      <div className="v">{w?.avgHr != null ? Math.round(w.avgHr) : "—"}<span>{w?.avgHr != null ? "avg bpm" : ""}</span></div>
    </div>
  );
}

function FutsalPage({ pan, list, notes, t, sel, onOpen }: { pan: Pan; list: Game[]; notes: ReadonlyMap<string, ActivityNote>; t: number; sel: string | null; onOpen: (id: string) => void }) {
  const [at, setAt] = useState<number | null>(null);
  if (!list.length) return <><PanBar pan={pan} /><div className="pg-hint">No games in this range.</div></>;
  const st = gameStats(list);
  const beat = list.filter((g) => g.session?.avgHr), last = beat[beat.length - 1], r = at !== null ? beat[at] : null;
  const days = beat.map((g) => g.day), a = days[0], z = days[days.length - 1];
  return <>
    {!last && <PanBar pan={pan} />}
    {last && (
      <ChartCard title="Heart rate per game" pan={pan}
        read={r ? [join(dayMonth(r.day, t), r.title), <>{Math.round(r.session!.avgHr!)} <small>{join("avg", !!r.session!.maxHr && `max ${Math.round(r.session!.maxHr)} bpm`)}</small></>] : null}
        head={<Head value={String(Math.round(last.session!.avgHr!))} unit={`bpm avg, ${formatDate(last.day).split(",")[0]}`} chip={last.session!.maxHr ? `max ${Math.round(last.session!.maxHr)}` : null} />}
        foot={<div className="pg-leg"><span><i className="ln" style={{ background: FUTSAL }} />Average heart rate in each game</span></div>}>
        <Chart series={[{ kind: "line", color: FUTSAL, pts: beat.map((g) => ({ day: g.day, v: g.session!.avgHr! })) }]} domain={a === z ? [a - 1, a + 1] : [a, z]} today={t} height={130} pan={pan}
          xLabels={a === z ? [{ day: a, text: dayMonth(a, t), anchor: "middle" }] : [{ day: a, text: dayMonth(a, t), anchor: "start" }, { day: z, text: dayMonth(z, t), anchor: "end" }]}
          reads={days} onRead={setAt} />
      </ChartCard>
    )}
    <div className="pg-tiles">
      <Tile a="Games" b={String(st.count)} c={hours(st.seconds / 3600)} />
      <Tile a="A usual game" b={st.usualMin !== null ? <>{Math.round(st.usualMin)} <small>min</small></> : "—"} c={st.avgHr !== null ? `avg ${Math.round(st.avgHr)} bpm` : ""} />
      <Tile a="Hardest" b={st.hardest ? <>{Math.round(st.hardest.session!.maxHr!)} <small>bpm</small></> : "—"} c={st.hardest ? `max · ${formatDate(st.hardest.day)}` : ""} />
      <Tile a="Calories" b={st.kcal ? fmtSteps(st.kcal) : "—"} c="kcal in this range" />
    </div>
    <Group title="Games" right={list.length > LATEST_GAMES ? `latest of ${list.length}` : undefined} />
    <Latest key={list.length} list={list} shown={LATEST_GAMES} row={(g) => <GameRow key={g.id} g={g} note={gameNote(g, notes)} sel={sel} onOpen={onOpen} />} />
  </>;
}

// ---------- A run type's own stats ----------

function TypeCards({ tr, type, t, st, onOpen }: { tr: Training; type: RunType; t: number; st: CardioState; onOpen: (id: string) => void }) {
  const { win, games, pan } = useWindow(tr, st, t);
  const rs = useMemo(() => tally(tr.runs, games, win.from, win.to).runs.filter((r) => r.type === type), [tr, games, win.from, win.to, type]);
  const [at, setAt] = useState<[string, number] | null>(null);
  const switcher = <RangeSwitch value={st.range} options={WINDOWS} onChange={(k) => { setAt(null); st.setRange(k); }} />;
  const name = runTypeName(type);
  if (!rs.length) return <>{switcher}<PanBar pan={pan} /><div className="pg-hint">No {name.toLowerCase()} runs in this range. Try a longer one.</div></>;
  const s = typeStats(rs), n = rs.length;
  const faster = s.faster === null ? "one run" : `${Math.abs(Math.round(s.faster))} s ${s.faster >= 0 ? "faster" : "slower"} in ${st.range}`;
  const hrMove = s.hrChange === null ? "one run" : `${s.hrChange > 0 ? "+" : s.hrChange < 0 ? "−" : ""}${Math.abs(Math.round(s.hrChange))} bpm in ${st.range}`;
  /** A trend card: a line of the runs that have the value, read with its day. */
  const trend = (key: string, title: string, side: string, list: Run[], v: (r: Run) => number, read: (r: Run) => string, opts: { fmt?: (x: number) => string; invert?: boolean } = {}) => {
    if (!list.length) return null;
    const a = list[0].day, b = list[list.length - 1].day, r = at?.[0] === key ? list[at[1]] : null;
    return (
      <div className="pg-card">
        <div className="pg-ct"><span>{title}</span><span className={r ? "pg-ct-read" : ""}>{r ? read(r) : side}</span></div>
        <Chart series={[{ kind: "line", color: RUN, dots: list.length <= 40, pts: list.map((x) => ({ day: x.day, v: v(x) })) }]} domain={[a, b]} today={t} height={120}
          xLabels={a === b ? [{ day: a, text: dayMonth(a, t), anchor: "middle" }] : [{ day: a, text: dayMonth(a, t), anchor: "start" }, { day: b, text: dayMonth(b, t), anchor: "end" }]}
          fmt={opts.fmt} invert={opts.invert} pan={pan} reads={list.map((x) => x.day)} onRead={(i) => setAt(i === null ? null : [key, i])} />
      </div>
    );
  };
  const when = (r: Run) => dayMonth(r.day, t);
  return <>
    {switcher}
    <PanBar pan={pan} />
    <div className="pg-tiles pg-gap">
      <Tile a="Pace" b={s.paceS !== null ? <>{mmss(s.paceS)} <small>/ km</small></> : "—"} c={faster} />
      <Tile a="Heart rate" b={s.hr !== null ? <>{Math.round(s.hr)} <small>bpm</small></> : "—"} c={hrMove} />
      <Tile a="Distance" b={<>{kmFixed(s.km)} <small>km</small></>} c={`avg ${kmFixed(s.km / n)} km a run`} />
      <Tile a="Runs" b={String(n)} c={s.longestKm !== null ? `longest ${kmFixed(s.longestKm)} km` : ""} />
    </div>
    {trend("pace", "Pace trend", "higher is faster", rs.filter((r) => r.paceSPerKm !== null), (r) => r.paceSPerKm!, (r) => join(when(r), `${mmss(r.paceSPerKm!)} / km`, r.distanceKm !== null && `${kmFixed(r.distanceKm)} km`), { fmt: mmss, invert: true })}
    {trend("hr", "Heart rate trend", "on the same runs", rs.filter((r) => r.avgHr !== null), (r) => r.avgHr!, (r) => join(when(r), `${Math.round(r.avgHr!)} bpm`, r.paceSPerKm !== null && `at ${pace(r.paceSPerKm)}`))}
    {trend("cad", "Cadence", "steps a minute", rs.filter((r) => r.cadenceSpm !== null), (r) => r.cadenceSpm!, (r) => join(when(r), `${Math.round(r.cadenceSpm!)} steps/min`, from(r.source)))}
    <Group title="Runs" right={n > LATEST ? `latest of ${n}` : undefined} />
    <Latest key={n} list={rs} shown={LATEST} row={(r) => <RunRow key={r.id} r={r} note={runNote(r, [...tr.entries.values()], tr.notes)} sel={null} onOpen={onOpen} />} />
  </>;
}

// ---------- A run's card and a game's card ----------

/** The note on a card: a tap opens it to write or change it; Save or Cancel, or Ctrl+Enter and Esc. */
function NoteCard({ note, onSave }: { note: string; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => { if (draft !== null) onSave(draft); feel("settle"); setDraft(null); };
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") setDraft(null);
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
  };
  if (draft !== null) return (
    <div className="pg-card">
      <div className="pg-ct"><span>Note</span></div>
      <textarea className="pg-notebox" autoFocus placeholder="How did it go?" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} />
      <div className="pg-btns"><TextButton onClick={() => setDraft(null)}>Cancel</TextButton><button className="p-filled-btn" onClick={save}>Save</button></div>
    </div>
  );
  return (
    <div className="pg-card">
      <div className="pg-ct"><span>Note</span></div>
      <div className="pg-note" {...tapProps(() => { feel("tick"); setDraft(note); })}>
        {note ? <><div className="bd">{note}</div><MIcon name="fEdit" size={20} /></> : <div className="bd add">Add a note</div>}
      </div>
    </div>
  );
}

/** What was logged: effort and pain, each as far as it was. */
function LogCard({ e }: { e: { effort: number | null; pain: number | null } }) {
  return (
    <div className="pg-card pg-mini">
      <div className="pg-ct"><span>From your log</span></div>
      <div className="r"><span>Effort</span><span>{e.effort !== null ? `${e.effort} of 10` : "not logged"}</span></div>
      <div className="r"><span>Pain</span><span>{e.pain === null ? "not logged" : e.pain === 0 ? "none" : `${e.pain} of 10`}</span></div>
    </div>
  );
}

function RunCard({ tr, r }: { tr: Training; r: Run }) {
  const stored = [...tr.entries.values()], log = runEntry(r, stored);
  return <>
    <div className="pg-hd">
      <div className="k"><span className="tr-bub k-run"><MIcon name={kindIcon("run")} size={16} /></span>Run · {runTypeName(r.type)}</div>
      <div className="t">{r.title}</div>
      <div className="s">{join(formatDate(r.day), r.time && hhmm(r.time))}</div>
    </div>
    <div className="pg-tiles pg-gap">
      <Tile a="Distance" b={r.distanceKm !== null ? <>{kmFixed(r.distanceKm)} <small>km</small></> : "—"} c={from(r.source)} />
      <Tile a="Time" b={fmtSleep(runSeconds(r) / 60)} c={r.movingS ? "moving time" : "time"} />
      <Tile a="Pace" b={r.paceSPerKm !== null ? <>{mmss(r.paceSPerKm)} <small>/ km</small></> : "—"} c="average" />
      <Tile a="Heart rate" b={r.avgHr !== null ? <>{Math.round(r.avgHr)} <small>bpm</small></> : "—"} c={r.maxHr !== null ? `max ${Math.round(r.maxHr)} bpm` : "average"} />
    </div>
    <NoteCard note={runNote(r, stored, tr.notes)} onSave={(v) => saveRunNote(r, v)} />
    {log && <LogCard e={log} />}
    <div className="pg-foot">{sourceLine(r.source)}</div>
  </>;
}

const sourceLine = (source: string | null) => (source === "health_connect" ? "From Garmin, through Health Connect." : source ? `${from(source).replace(/^f/, "F")}.` : "");

/** "9:02 PM – 10:01 PM": the watch's times, else the event's. */
function gameTimes(g: Game): string {
  if (g.session) return `${hhmm(g.session.time)}${g.session.endTime ? ` – ${hhmm(g.session.endTime)}` : ""}`;
  if (g.startMin === null) return "";
  return `${formatTime(g.startMin)}${g.endMin !== null ? ` – ${formatTime(g.endMin)}` : ""}`;
}

function GameCard({ tr, g, t }: { tr: Training; g: Game; t: number }) {
  const w = gameWatch(g), venue = gameVenue(g), s = gameSeconds(g);
  const usual = useMemo(() => gameStats(playedGames(tr.games, t)), [tr, t]);
  const [at, setAt] = useState<number | null>(null);
  // The heart rate every 15 s; 0 where there was no reading.
  const hr = g.session?.hr ?? [];
  const pts = hr.flatMap((v, i) => (v > 0 ? [{ day: i, v }] : []));
  const clockAt = (i: number) => { const b = g.session!, m = Number(b.time.slice(0, 2)) * 60 + Number(b.time.slice(3, 5)) + Math.floor(i / 4); return formatTime(m % 1440); };
  const avg = pts.length ? pts.reduce((a, p) => a + p.v, 0) / pts.length : null;
  const read = at !== null ? pts[at] : null;
  const last = hr.length - 1, mid = Math.floor(last / 2);
  return <>
    <div className="pg-hd">
      <div className="k"><span className="tr-bub k-futsal"><MIcon name={kindIcon("futsal")} size={16} /></span>{venue === "indoor" ? "Futsal · indoor" : venue === "outdoor" ? "Football · outdoor" : "Futsal"}</div>
      <div className="t">{g.title}</div>
      <div className="s">{join(formatDate(g.day), gameTimes(g))}</div>
      {g.fromEvent && <div className="ev"><MIcon name="oToday" size={14} />Title from your calendar event</div>}
    </div>
    <div className="pg-tiles pg-gap">
      <Tile a="Time" b={s > 0 ? <>{Math.round(s / 60)} <small>min</small></> : "—"} c={usual.usualMin !== null ? `your usual: ${Math.round(usual.usualMin)}` : ""} />
      <Tile a="Calories" b={w?.kcal != null ? <>{Math.round(w.kcal)} <small>kcal</small></> : "—"} c={usual.usualKcal !== null ? `usual ${Math.round(usual.usualKcal)}` : ""} />
      <Tile a="Heart rate" b={w?.avgHr != null ? <>{Math.round(w.avgHr)} <small>avg</small></> : "—"} c={w?.maxHr != null ? `max ${Math.round(w.maxHr)} bpm` : ""} />
      <Tile a="Distance" b={w?.distanceKm != null ? <>{w.approx ? "≈ " : ""}{kmFixed(w.distanceKm)} <small>km</small></> : "—"}
        c={w?.distanceKm != null ? (w.approx ? "indoors or out isn't known" : "from GPS") : venue === "indoor" ? "indoors: no GPS" : ""} />
    </div>
    <NoteCard note={gameNote(g, tr.notes)} onSave={(v) => saveGameNote(g, v)} />
    {pts.length > 1 && (
      <div className="pg-card">
        <div className="pg-ct"><span>Heart rate</span><span className={read ? "pg-ct-read" : ""}>{read ? `${clockAt(read.day)} · ${read.v} bpm` : "every 15 s"}</span></div>
        <Chart series={[{ kind: "line", area: true, dots: false, gap: 1, color: FUTSAL, pts }]} domain={[0, last]} today={t} height={130} avg={avg} reads={pts.map((p) => p.day)} onRead={setAt}
          xLabels={[{ day: 0, text: clockAt(0), anchor: "start" }, { day: mid, text: clockAt(mid), anchor: "middle" }, { day: last, text: clockAt(last), anchor: "end" }]} />
        <div className="pg-leg"><span><i className="ln" style={{ background: FUTSAL }} />Heart rate</span><span><i className="ln" style={{ background: GREY }} />Game average</span></div>
      </div>
    )}
    {g.entry && <LogCard e={g.entry} />}
    {g.session && <div className="pg-foot">From Garmin, through Health Connect.</div>}
  </>;
}
