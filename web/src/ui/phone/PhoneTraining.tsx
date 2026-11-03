// The Training page (#/training) opens on the overview (TrainingOverview.tsx, 301); the week plan is one tap
// deeper (?view=week, and the routes a session or a day opens): the active plan a phase at a time, as the plan
// session wrote it. The phase strip at the top; the phase's summary, notes and placement rules; To place (sessions without a
// day: tap one, then tap a day); then each day with its sessions and futsal. A placed session can be held
// and dragged to another day (or back to To place). The ring on a row ticks it done, and a small "how it
// went" row opens under it and closes by itself. A tap on a row opens the session (TrainingSession.tsx):
// over the week on the phone, beside it in a wide window. Progress (TrainingProgress.tsx) and the documents are
// in the top bar. Placing a session or futsal on a day that breaks one of the phase's rules opens a sheet that
// says so (it's never blocked), and a row shows "⚠ 1 rule" while it breaks one.
// Above the week plan, the sleep line (last night, the 7-day average, resting HR, HRV; a tap opens Progress on
// Sleep), and two quiet markers: a moon on a key run (quality or long) after a night under 6 h, and a small
// heart on a day whose resting HR is up 7+ on its 7-day average two mornings running (domain/sleep.ts).
// Also here: Today's training line and the calendar's light marks.
import { flushSync } from "react-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { dayShort, formatDate, formatTime, today as todayEpoch, weekday } from "../../domain/dates.ts";
import { type Breach, type ItemRef, breachSummary, breachesOnly, brokenNow, brokenRules, dayFit, ruleWords } from "../../domain/placement.ts";
import { count } from "../../domain/plural.ts";
import { freeDayLine } from "../../domain/todayPlan.ts";
import {
  type Entry, type Phase, type Plan, type Session, changeKey, dayOfSession, entryFor, entryId, futsalLogId, leftToPlace, phaseIndexAt,
  phaseView, planChanges, seenOf, sessionsOf, sessionsOnDay,
} from "../../domain/training.ts";
import { type TodayCard, todayCard, todayRows } from "../../domain/trainingToday.ts";
import { type ColourKind, colourKind, runLine, runOf, summaryKm, weekBar } from "../../domain/trainingWeek.ts";
import type { Run } from "../../domain/trends.ts";
import { type SleepNight, fmtSleep, nightsOf7, restingHrFlag, shortSleepBefore, sleepAverages } from "../../domain/sleep.ts";
import { type LoadedPlan, type Training, activeOf, saveDayOrder, saveEntry, saveSeen, training, useTraining } from "../../store/training.ts";
import { dayOrderId, droppedOrder, inDayOrder, orderWithout } from "../../domain/dayOrder.ts";
import { type GameRef, addGame, moveGame, removeGame, saveGameLog, tickGame } from "../../store/futsal.ts";
import { snapshot, withUndo } from "../../store/store.ts";
import { useWide } from "../../platform.ts";
import { canUseHealth, cardDismissed, connect, dismissCard, useHealth } from "../../health/healthConnect.ts";
import { go, replaceRoute } from "../shared/common.tsx";
import { AppBarActions, ChipRow, EmptyState, FilterChip, HeadCount, IconButton, MIcon, Scaffold, SectionHeader } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { BottomSheet, OutlinedTextField, TextButton, showSnackbar } from "./m3.tsx";
import { TimePickerDialog } from "./pickers.tsx";
import { TOUCH_SLOP, swallowClick } from "./press.ts";
import { type Animation, GLIDE_SPRING, animateSpring } from "./motion.ts";
import { edgeSpeed } from "./selectScroll.ts";
import { ExerciseHistory, TrainingDocs } from "./TrainingDocs.tsx";
import { TrainingFind } from "./TrainingFind.tsx";
import { OverviewTiles, TodayRow, WeekBarView } from "./TrainingOverview.tsx";
import { TrainingProgress } from "./TrainingProgress.tsx";
import { HowItWent, SessionView, patchEntry, setSessionStatus } from "./TrainingSession.tsx";
import { Scale, gameIcon, kindIcon, phaseNames, planQ, sessionIcon, trainingLookClass } from "./trainingParts.tsx";
import { useLooks } from "./looks.ts";
import { EstimateStats, LooseWatchRow, WatchRunChips, WatchStatsGrid, useWatchRunAsks, useWatchRunTicks, watchHead } from "./WatchRuns.tsx";
import type { HealthSession } from "../../domain/health.ts";
import { sessionStats, statLine, venueOf } from "../../domain/watchActivities.ts";
import { type Estimate, estimateLine, runEstimate } from "../../domain/estimate.ts";
import "./training.css";

/** Held this long, a placed session lifts to be dragged to another day (as a note card does). */
const LONG_PRESS = 450;
/** The "how it went" row after a tick closes by itself after this long untouched. */
const ASK_MS = 8000;

/** The placement sheet's subject: what's on [day], and how to take it back (null when opened from a row's marker). */
interface Warn { item: ItemRef; day: number; undo: (() => void) | null }

/** The sheet's subject when [item], just put on [day], breaks a rule there; else null. */
function checkPlaced(lp: LoadedPlan, item: ItemRef, day: number, undo: () => void): Warn | null {
  if (!breachesOnly(brokenRules(lp.plan, training().entries, item, day)).length) return null;
  return { item, day, undo };
}

export function PhoneTraining({ query }: { query: URLSearchParams }) {
  const tr = useTraining();
  useLooks();
  const t = todayEpoch();
  const wide = useWide();
  const [movedWarn, setMovedWarn] = useState<Warn | null>(null);
  // Back on the overview the week is put away: the next time it opens on this week, not where it was left.
  const home = !query.get("view") && !query.get("s") && !query.get("d");
  useEffect(() => { if (home) kept = null; }, [home]);
  const planId = query.get("p");
  const active = activeOf(tr, t);
  const lp = (planId && tr.plans.find((p) => p.plan.id === planId)) || active;
  if (!lp) {
    return (
      <Scaffold title="Training">
        <EmptyState icon="tRunner" title="No training plan" hint="The plan comes from the PC and arrives with the next sync" />
      </Scaffold>
    );
  }
  const view = query.get("view");
  /** A page over the rest; "week" isn't one, it's the plan itself. */
  const over = view && view !== "week" ? view : null;
  const sid = query.get("s");
  const readOnly = lp !== active;
  const d = query.get("d");
  // A session moved from its own page (over the week, on a phone) onto a day that breaks a rule.
  const moved = (sid: string, day: number, undo: () => void) => { const w = checkPlaced(lp, { session: sid }, day, undo); if (w) setMovedWarn(w); return !!w; };
  const deep = view === "week" || !!sid || !!d;
  const week = <TrainingWeek tr={tr} lp={lp} t={t} wide={wide} sessionId={over ? null : sid} readOnly={readOnly} planId={planId} focusDay={d ? Number(d) : null} />;
  return <>
    {readOnly ? week : <>
      <TrainingHome tr={tr} lp={lp} t={t} planId={planId} />
      {deep && !over && <div className="tr-layer tr-plan">{week}</div>}
    </>}
    {!wide && sid && !over && (
      <div className="tr-layer"><SessionView key={sid} tr={tr} lp={lp} sessionId={sid} readOnly={readOnly} onClose={() => history.back()} onMoved={moved} /></div>
    )}
    {movedWarn && <PlacementSheet tr={tr} lp={lp} warn={movedWarn} onMoved={setMovedWarn} onClose={() => setMovedWarn(null)} />}
    {over && (
      <div className="tr-layer full">
        {over === "docs" ? <TrainingDocs lp={lp} file={query.get("doc")} anchor={query.get("a")} planId={planId} />
          : over === "progress" || over === "bests" ? <TrainingProgress tr={tr} lp={lp} query={query} planId={planId} />
          : over === "ex" ? <ExerciseHistory tr={tr} lp={lp} id={query.get("x") ?? ""} planId={planId} />
          : over === "find" ? <TrainingFind tr={tr} lp={lp} planId={planId} />
          : null}
      </div>
    )}
  </>;
}

/**
 * What the tab opens on (301): today's row, the week's bar that leads to the plan, and the tiles. Log ticks what's
 * waiting and asks how it went under the row, as a tick on the week does; Start opens the session, where it's logged.
 */
function TrainingHome({ tr, lp, t, planId }: { tr: Training; lp: LoadedPlan; t: number; planId: string | null }) {
  const { plan } = lp;
  const [asked, setAsked] = useState<string | null>(null);
  useWatchRunTicks(false);
  const scaffold = (children: ReactNode) => (
    // The page's own icons, then search and settings in their usual last two spots (285). Training's own search
    // stays until the one search (292) takes it in.
    <Scaffold title={<span className="tr-title">Training<span className="sub">{plan.name}</span></span>} flush actions={<>
      <IconButton icon="oSearch" label="Search training" onClick={() => go(`training?view=find${planQ(planId)}`)} />
      <IconButton icon="fShowChart" label="Progress" onClick={() => go(`training?view=progress${planQ(planId)}`)} />
      <IconButton icon="oMenuBook" label="Documents" onClick={() => go(`training?view=docs${planQ(planId)}`)} />
      <AppBarActions />
    </>}>{children}</Scaffold>
  );
  if (!plan.phases.length) return scaffold(<EmptyState icon="tRunner" title="No weeks yet" hint="This plan has no phases yet" />);
  const phase = phaseIndexAt(plan, t), ph = plan.phases[phase];
  const bar = weekBar(phaseView(plan, phase, tr.entries, tr.entries.values()).days, tr.runs);
  const card = todayCard(plan, tr.entries, t, tr.orders);
  const openWeek = () => { feel("tick"); go(`training?view=week${planQ(planId)}`); };
  const openToday = (c: TodayCard) => {
    feel("tick");
    if (c.kind === "session" || (c.kind === "done" && c.session)) go(`training?s=${encodeURIComponent((c.kind === "session" ? c.session : c.session!).id)}${planQ(planId)}`);
    else if (c.kind === "game" || c.kind === "done") go(`training?d=${t}${planQ(planId)}`);
    else openWeek();
  };
  const log = () => {
    feel("confirm");
    if (card.kind === "session") { setAsked(card.entry.id); setSessionStatus(lp, card.session, "done", t); }
    else if (card.kind === "game" && card.game.itemId !== undefined && card.game.day !== null) { setAsked(card.game.id); tickGame({ itemId: card.game.itemId, day: card.game.day }, true); }
  };
  // What was just logged, once it's done, asks how it went.
  const askedS = sessionsOnDay(plan, t, tr.entries).find((x) => x.entry.id === asked && x.entry.status === "done");
  const askedG = asked ? tr.entries.get(asked) : undefined;
  const askedGame = askedG?.kind === "futsal" && askedG.status === "done" ? askedG : undefined;
  // The box stays under what it rates: with two sessions a day, Log moves on to the second (todayRows).
  const { rated, row } = todayRows(card, askedS ?? (askedGame ? { session: null, entry: askedGame } : null));
  const todayRow = (c: TodayCard) => <TodayRow tr={tr} card={c} t={t} onOpen={() => openToday(c)} onStart={() => openToday(c)} onLog={log} />;
  return scaffold(
    <div className={`p-content tr-home ${trainingLookClass()}`}>
      <UpdateNotice tr={tr} lp={lp} readOnly={false} />
      <HealthCard />
      <div className="tr-home-in">
        {rated && todayRow(rated)}
        {askedS ? <AskRow lp={lp} s={askedS.session} e={askedS.entry} onDone={() => setAsked(null)} />
          : askedGame ? <GameAskRow plan={plan} e={askedGame} onDone={() => setAsked(null)} /> : null}
        {row && todayRow(row)}
        <button className="tr-wk" onClick={openWeek}>
          <span className="top"><span>{t >= ph.start && t <= ph.end ? "This week" : phaseNames(ph.name)[0]}</span><MIcon name="fKeyboardArrowRight" size={20} /></span>
          {bar.segments.length > 0 ? <WeekBarView bar={bar} totalKm={summaryKm(ph.summary)} /> : <span className="tr-bar-text"><span>Nothing placed yet</span></span>}
        </button>
        <OverviewTiles tr={tr} t={t} onOpen={(q) => { feel("tick"); go(`training?view=progress&${q}${planQ(planId)}`); }} />
      </div>
      <div className="p-endspace" />
    </div>,
  );
}

// The phase looked at and the list's scroll, kept while a page is open over the week (a document, Progress).
let kept: { plan: string; phase: number; scroll: number } | null = null;

function TrainingWeek({ tr, lp, t, wide, sessionId, readOnly, planId, focusDay }: {
  tr: Training; lp: LoadedPlan; t: number; wide: boolean; sessionId: string | null; readOnly: boolean; planId: string | null; focusDay: number | null;
}) {
  const { plan } = lp;
  const [phase, setPhaseState] = useState(() =>
    focusDay !== null ? phaseIndexAt(plan, focusDay) : kept?.plan === plan.id ? Math.min(kept.phase, plan.phases.length - 1) : phaseIndexAt(plan, t));
  const [picked, setPicked] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [futsal, setFutsal] = useState<Entry | "new" | null>(null);
  const [warn, setWarn] = useState<Warn | null>(null);
  // A futsal game saved onto a day that breaks a rule: the sheet opens once the futsal sheet has gone.
  const warnNext = useRef<Warn | null>(null);
  const [rulesOpen, setRulesOpen] = useState(() => localStorage.getItem("trainingRulesOpen") === "1");
  const scroller = useRef<HTMLDivElement>(null);
  const setPhase = (i: number) => { setPhaseState(i); setPicked(null); if (scroller.current) scroller.current.scrollTop = 0; };
  useLayoutEffect(() => {
    if (kept?.plan === plan.id && focusDay === null && scroller.current) scroller.current.scrollTop = kept.scroll;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { kept = { plan: plan.id, phase, scroll: scroller.current?.scrollTop ?? 0 }; });

  const sessions = useMemo(() => new Map(sessionsOf(plan).map((s) => [s.id, s])), [plan]);
  const sessionByEntry = useMemo(() => new Map(sessionsOf(plan).map((s) => [entryId(plan.id, s.id), s])), [plan]);
  // What breaks a placement rule now, by session id or futsal entry id: the rows' markers.
  const broken = useMemo(() => (readOnly ? new Map<string, Breach[]>() : brokenNow(plan, tr.entries)), [plan, tr.entries, readOnly]);
  const check = (item: ItemRef, day: number, undo: () => void) => checkPlaced(lp, item, day, undo);
  /** Writes [day]'s order, and returns how to put back the order it had. */
  const writeOrder = (day: number, order: string[]) => {
    const was = training().orders.get(dayOrderId(plan.id, day));
    saveDayOrder(plan.id, day, order);
    return () => saveDayOrder(plan.id, day, was ? [...was] : []);
  };
  /** Moves session [sid] to [day] (null: To place); [drop]: let go at a place among that day's rows (324). */
  const place = (sid: string, day: number | null, drop?: { ids: string[]; index: number }) => {
    const s = sessions.get(sid);
    if (!s || s.locked) return;
    const before = entryFor(plan, s, training().entries);
    const from = dayOfSession(s, training().entries.get(before.id));
    if (from === day) { setPicked(null); return; }
    // The day it leaves no longer lists it (review of 2.10.1, finding 7), and a drop keeps its place on the new day.
    const restore: (() => void)[] = [];
    const left = from === null ? null : orderWithout(training().orders.get(dayOrderId(plan.id, from)), before.id);
    if (from !== null && left) restore.push(writeOrder(from, left));
    if (day !== null && drop) restore.push(writeOrder(day, droppedOrder(drop.ids, before.id, drop.index)));
    patchEntry(lp, s, { day });
    feel("settle");
    setPicked(null);
    const undo = () => { saveEntry(before); restore.forEach((r) => r()); };
    // On a day that breaks a rule, the sheet says so (and can undo it); else the usual snackbar.
    const w = day === null ? null : check({ session: sid }, day, undo);
    if (w) setWarn(w);
    else showSnackbar(day === null ? `${s.title} back in To place` : `${s.title} on ${formatDate(day)}`, "Undo", undo);
  };
  // A row let go on a day: its place there is kept as that day's order (324), with Undo (rule 7, review of
  // 2.10.1, finding 6); on another day it moves there too.
  const dropped = (id: string, to: DayDrop) => {
    const s = sessionByEntry.get(id);
    if (s && (to.day === null || !to.ids.includes(id))) { place(s.id, to.day, to.day === null ? undefined : to); return; }
    if (to.day === null) return;
    const undo = writeOrder(to.day, droppedOrder(to.ids, id, to.index));
    showSnackbar("Order changed", "Undo", undo);
  };
  const drag = useDayDrag(scroller, dropped);
  useWatchRunTicks(readOnly);
  const watchAsks = useWatchRunAsks(tr, lp, t, readOnly);

  if (!plan.phases.length) return <Scaffold title="Training"><EmptyState icon="tRunner" title="No weeks yet" hint="This plan has no phases yet" /></Scaffold>;
  const ph = plan.phases[phase];
  const v = phaseView(plan, phase, tr.entries, tr.entries.values(), tr.orders);
  const [short, long] = phaseNames(ph.name);
  const bar = weekBar(v.days, tr.runs);
  // A summary that's only a distance moves from the date line to the bar's km.
  const totalKm = summaryKm(ph.summary);
  const open = (sid: string) => {
    const route = `training?s=${encodeURIComponent(sid)}${planQ(planId)}`;
    // Wide, the open session is swapped in place, so closing it goes back to the week, not through each one.
    if (wide && sessionId) replaceRoute(route); else go(route);
  };
  const tick = (s: Session, e: Entry) => {
    if (readOnly) return;
    const next = e.status === "planned" ? "done" : "planned";
    if (next === "done") { feel("confirm"); setAsked(entryId(plan.id, s.id)); } else setAsked(null);
    setSessionStatus(lp, s, next, t);
  };
  // A game is a futsal event's day (item 240): ticking it ticks that day of the event.
  const tickFutsal = (e: Entry) => {
    if (readOnly || e.itemId === undefined || e.day === null) return;
    if (e.status !== "done") { feel("confirm"); setAsked(e.id); } else setAsked(null);
    tickGame({ itemId: e.itemId, day: e.day }, e.status !== "done");
  };
  const pickedSession = picked ? sessions.get(picked) : undefined;
  // The watch's football sessions no game took (268), on their days.
  const looseOn = (day: number) => tr.watchGames.loose.filter((x) => x.day === day);
  const showToPlace = v.toPlace.length > 0 || drag.lifted !== null;

  const week = (
    <div className={`p-content tr-week ${trainingLookClass()}`} ref={scroller}>
      <UpdateNotice tr={tr} lp={lp} readOnly={readOnly} />
      {!readOnly && <HealthCard />}
      <SleepLine nights={tr.sleep} t={t} onOpen={() => { feel("tick"); go(`training?view=progress&tab=body${planQ(planId)}`); }} />
      {readOnly && <div className="tr-oldplan">An earlier plan: read only.</div>}
      <ChipRow className="tr-phases">
        {plan.phases.map((p, i) => (
          <FilterChip key={i} selected={i === phase} onClick={() => setPhase(i)}>
            {phaseNames(p.name)[0]}{t >= p.start && t <= p.end ? <span className="tr-nowdot" aria-label="now" /> : null}
          </FilterChip>
        ))}
      </ChipRow>
      <div className="tr-phase">
        <div className="tr-phase-name">{long || short}</div>
        <div className="tr-phase-sub">{formatDate(ph.start)} – {formatDate(ph.end)}{ph.summary && !totalKm ? ` · ${ph.summary}` : ""}</div>
        {bar.segments.length > 0 && <WeekBarView bar={bar} totalKm={totalKm} />}
        {ph.notes.map((n, i) => <div key={i} className="tr-phase-note">{n}</div>)}
        {ph.rules.length > 0 && <>
          <button className="tr-rules-head" aria-expanded={rulesOpen}
            onClick={() => { const o = !rulesOpen; setRulesOpen(o); localStorage.setItem("trainingRulesOpen", o ? "1" : "0"); }}>
            <span>Placement rules</span><MIcon name={rulesOpen ? "fExpandLess" : "fExpandMore"} size={18} />
          </button>
          {rulesOpen && <ul className="tr-rules">{ph.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </>}
      </div>

      {showToPlace && (
        <div className={`tr-toplace ${drag.over === "none" ? "over" : ""}`} data-drop="none">
          <SectionHeader>To place{v.toPlace.length > 0 && <HeadCount n={v.toPlace.length} />}</SectionHeader>
          {pickedSession
            ? <div className="tr-placing"><span>Tap a day for <b>{pickedSession.title}</b></span><TextButton onClick={() => setPicked(null)}>Cancel</TextButton></div>
            : !readOnly && v.toPlace.some((s) => (tr.entries.get(entryId(plan.id, s.id))?.status ?? "planned") === "planned") && <div className="tr-hint">Tap a session, then the day it goes on.</div>}
          {v.toPlace.length === 0 && <div className="tr-hint">Drop here to take it off its day.</div>}
          <div className="tr-cards">
            {v.toPlace.map((s) => {
              const e = entryFor(plan, s, tr.entries);
              return (
                <div key={s.id} className={`tr-card-place ${picked === s.id ? "on" : ""} ${picked && picked !== s.id ? "dim" : ""} ${e.status}`}>
                  <button className="main" onClick={() => { if (readOnly || e.status !== "planned") open(s.id); else { feel("tick"); setPicked(picked === s.id ? null : s.id); } }}>
                    <KindIcon kind={colourKind({ session: s, entry: e })} icon={sessionIcon(s)} />
                    <span className="text"><span className="title">{s.title}</span>
                      <span className="detail">{[s.detail, s.optional ? "optional" : "", e.status === "skipped" ? "skipped" : ""].filter(Boolean).join(" · ")}</span></span>
                  </button>
                  <IconButton icon="fKeyboardArrowRight" label={`Open ${s.title}`} onClick={() => open(s.id)} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {v.days.map(({ day, items }) => (
        <div key={day} data-drop={day}
          className={`tr-day ${day === t ? "today" : ""} ${day < ph.start || day > ph.end ? "outside" : ""} ${picked ? "target" : ""} ${drag.over === String(day) ? "over" : ""}`}
          onClickCapture={picked ? (ev) => { ev.stopPropagation(); ev.preventDefault(); place(picked, day); } : undefined}>
          <div className="tr-dayhead"><span>{formatDate(day)}</span>{day === t && <span className="tr-todaytag">Today</span>}
            {day <= t && restingHrFlag(tr.sleep, day) && <span className="tr-hrflag" role="img" aria-label="Resting heart rate up 7 or more on your 7-day average, two mornings running"
              title="Resting heart rate up 7 or more on your 7-day average, two mornings running"><MIcon name="fFavorite" size={12} /></span>}</div>
          <WatchRunChips lp={lp} asks={watchAsks.get(day)} />
          {items.length === 0 && !looseOn(day).length && <div className="tr-rest">{picked ? "Tap to put it here" : "Rest"}</div>}
          {items.map(({ session: s, entry: e }) => s ? (
            <div key={s.id} data-item={e.id}>
              <SessionRow s={s} e={e} run={s.kind === "run" && e.status === "done" ? runOf(tr.runs, s.id) : null}
                est={s.kind === "run" && e.status === "done" && !runOf(tr.runs, s.id) ? runEstimate(s, e, e.doneDay ?? day, tr.runs, tr.healthSessions) : null} selected={wide && sessionId === s.id} lifted={drag.lifted === e.id}
                slept={keyRun(s) && day <= t ? shortSleepBefore(tr.sleep, day) : null} lastNight={day === t}
                warn={broken.get(s.id)?.length ?? 0} onWarn={() => setWarn({ item: { session: s.id }, day, undo: null })}
                onTick={() => tick(s, e)} onOpen={() => open(s.id)} dragProps={readOnly ? undefined : drag.props(e.id, !!s.locked)} />
              {asked === e.id && e.status === "done" && <AskRow lp={lp} s={s} e={e} onDone={() => setAsked(null)} />}
            </div>
          ) : (
            <div key={e.id} data-item={e.id}>
              <FutsalRow e={e} watch={tr.watchGames.byGame.get(e.id)} est={tr.gameEstimates.get(e.id) ?? null} warn={broken.get(e.id)?.length ?? 0} onWarn={() => setWarn({ item: { futsal: e.id }, day, undo: null })} onTick={() => tickFutsal(e)} onOpen={() => !readOnly && setFutsal(e)}
                lifted={drag.lifted === e.id} dragProps={readOnly ? undefined : drag.props(e.id, true)} />
              {asked === e.id && e.status === "done" && <GameAskRow plan={plan} e={e} onDone={() => setAsked(null)} />}
            </div>
          ))}
          {looseOn(day).map((x) => <LooseWatchRow key={x.id} s={x} />)}
        </div>
      ))}
      {!readOnly && (
        <div className="tr-actions">
          <button className="p-assist" onClick={() => setFutsal("new")}><MIcon name={kindIcon("futsal")} size={18} /><span>Futsal</span></button>
        </div>
      )}
      <div className="p-endspace" />
    </div>
  );

  return (
    <Scaffold title={<span className="tr-title">{long || short}<span className="sub">{plan.name}</span></span>} back flush actions={readOnly ? <>
      <IconButton icon="oSearch" label="Search training" onClick={() => go(`training?view=find${planQ(planId)}`)} />
      <IconButton icon="fShowChart" label="Progress" onClick={() => go(`training?view=progress${planQ(planId)}`)} />
      <IconButton icon="oMenuBook" label="Documents" onClick={() => go(`training?view=docs${planQ(planId)}`)} />
    </> : undefined}>
      {wide ? (
        <div className="tr-split">
          {week}
          <div className="tr-side">
            {sessionId
              ? <SessionView key={sessionId} tr={tr} lp={lp} sessionId={sessionId} readOnly={readOnly} closeIcon
                  onMoved={(sid, day, undo) => { const w = check({ session: sid }, day, undo); if (w) setWarn(w); return !!w; }}
                  onClose={() => replaceRoute(`training?view=week${planQ(planId)}`)} />
              : <div className="tr-side-hint"><MIcon name="oDirectionsRun" size={40} /><span>Open a session to see its card and log it here</span></div>}
          </div>
        </div>
      ) : week}
      {futsal && <FutsalSheet plan={plan} ph={ph} entry={futsal === "new" ? null : futsal} t={t} watch={futsal === "new" ? undefined : tr.watchGames.byGame.get(futsal.id)}
        onPlaced={(g, undo) => { warnNext.current = check({ futsal: futsalLogId(g.itemId, g.day) }, g.day, undo); }}
        onClose={() => { setFutsal(null); if (warnNext.current) { setWarn(warnNext.current); warnNext.current = null; } }} />}
      {warn && <PlacementSheet tr={tr} lp={lp} warn={warn} onMoved={setWarn} onClose={() => setWarn(null)} />}
    </Scaffold>
  );
}

/** A session's icon in a soft circle of its kind's colour (other kinds keep the plain icon colour). */
function KindIcon({ kind, icon }: { kind: ColourKind | null; icon: string }) {
  return <span className={`tr-bub ${kind ? `k-${kind}` : ""}`}><MIcon name={icon} size={18} /></span>;
}

/** The ring on a row: the kind's colour, filled with a small pop when ticked done. */
function Ring({ kind, done, label, onTick }: { kind: ColourKind | null; done: boolean; label: string; onTick: () => void }) {
  return (
    <button className={`tr-ring ${kind ? `k-${kind}` : ""}`} aria-pressed={done} aria-label={label}
      onClick={(ev) => {
        ev.stopPropagation();
        // Only a tick pops it, never a row drawn already done.
        const el = ev.currentTarget;
        el.classList.remove("pop");
        if (!done) { void el.offsetWidth; el.classList.add("pop"); }
        onTick();
      }}
      onAnimationEnd={(ev) => ev.currentTarget.classList.remove("pop")}>
      {done && <MIcon name="fCheck" size={16} />}
    </button>
  );
}

/** A key run: a quality session or the long run, the ones a short night before is worth a word on. */
const keyRun = (s: Session) => s.kind === "run" && (s.tags.includes("quality") || s.dayType === "long");

/**
 * "Slept 7 h 12 · 7-day avg 7 h 05 · 5 of 7 nights · resting HR 51 · HRV 52": the latest morning, when it's today's or
 * yesterday's (else nothing shows); parts without data are left out. A tap opens the Sleep tab.
 */
function SleepLine({ nights, t, onOpen }: { nights: readonly SleepNight[]; t: number; onOpen: () => void }) {
  const n = nights[nights.length - 1];
  if (!n || n.day < t - 1) return null;
  const avg = sleepAverages(nights, n.day);
  const title = n.totalMin !== null ? `Slept ${fmtSleep(n.totalMin)}` : "Last night";
  const parts = [
    avg.sleepMin !== null && `7-day avg ${fmtSleep(avg.sleepMin)}`, avg.sleepMin !== null && nightsOf7(avg.nights), n.restingHr !== null && `resting HR ${n.restingHr}`, n.hrvMs !== null && `HRV ${Math.round(n.hrvMs)}`,
  ].filter((x): x is string => !!x);
  const sub = parts.join(" · ");
  return (
    <button className="tr-sleep" onClick={onOpen} aria-label={`${title}${sub ? `, ${sub}` : ""}. Open sleep in Progress`}>
      <MIcon name="fDarkMode" size={20} />
      <span className="text"><span className="title">{title}</span>{/* Each part wraps whole ("HRV 52" never splits at 390 px). */}
        {sub && <span className="detail">{parts.map((x, i) => <span key={i}>{i > 0 && " · "}<span className="part">{x}</span></span>)}</span>}</span>
      <MIcon name="fKeyboardArrowRight" size={20} />
    </button>
  );
}

/** The moon on a key run after a short night: how long was slept, quietly. */
function SleepMark({ min, lastNight }: { min: number; lastNight: boolean }) {
  const text = `Slept under 6 h ${lastNight ? "last night" : "the night before"} (${fmtSleep(min)})`;
  return <span className="tr-slept" role="img" aria-label={text} title={text}><MIcon name="fDarkMode" size={12} /><span>{fmtSleep(min)}</span></span>;
}

/** "⚠ 1 rule" on a row that breaks a placement rule now; a tap opens the rules it breaks. */
function RuleMark({ n, onOpen }: { n: number; onOpen: () => void }) {
  return (
    <button className="tr-warn" onClick={(ev) => { ev.stopPropagation(); onOpen(); }}>
      <MIcon name="oWarningAmber" size={13} /><span>{count(n, "rule")}</span>
    </button>
  );
}

function SessionRow({ s, e, run, est, selected, lifted, slept, lastNight, warn, onWarn, onTick, onOpen, dragProps }: {
  s: Session; e: Entry; run: Run | null; est: Estimate | null; selected: boolean; lifted: boolean; slept: number | null; lastNight: boolean; warn: number; onWarn: () => void; onTick: () => void; onOpen: () => void;
  dragProps?: { onPointerDown: (ev: React.PointerEvent<HTMLElement>) => void; onContextMenu: (ev: React.MouseEvent) => void };
}) {
  const kind = colourKind({ session: s, entry: e });
  // A done run matched to one from the watch shows how it went instead of the plan's text.
  // With none, an estimate from the recorded runs (340), each guessed value with "≈".
  const ran = run ? runLine(run) : est ? estimateLine(est, true, true) : "";
  return (
    <div className={`tr-row ${e.status} ${kind ? `k-${kind}` : ""} ${selected ? "sel" : ""} ${lifted ? "lifted" : ""}`} role="button" onClick={onOpen} {...dragProps}>
      <Ring kind={kind} done={e.status === "done"} label={e.status === "done" ? `${s.title}: done. Tap to undo` : `Mark ${s.title} done`} onTick={onTick} />
      <KindIcon kind={kind} icon={sessionIcon(s)} />
      <span className="tr-row-text">
        <span className="title">{s.title}</span>
        <span className="detail">{ran || [s.detail, s.optional ? "optional" : "", s.locked ? "fixed" : "", e.status === "skipped" ? "skipped" : ""].filter(Boolean).join(" · ")}</span>
      </span>
      {slept !== null && <SleepMark min={slept} lastNight={lastNight} />}
      {warn > 0 && <RuleMark n={warn} onOpen={onWarn} />}
    </div>
  );
}

/**
 * A game (futsal or another sport, 267): its event's title, then its time, how long it was and the note;
 * with the watch's session for it (268), how long, heart rate and calories from the watch instead.
 */
function FutsalRow({ e, watch, est, warn, onWarn, onTick, onOpen, lifted, dragProps }: {
  e: Entry; watch: HealthSession | undefined; est: Estimate | null; warn: number; onWarn: () => void; onTick: () => void; onOpen: () => void; lifted: boolean;
  dragProps?: { onPointerDown: (ev: React.PointerEvent<HTMLElement>) => void; onContextMenu: (ev: React.MouseEvent) => void };
}) {
  const item = e.itemId !== undefined ? snapshot().byId.get(e.itemId) : undefined;
  const at = item && !item.allDay && item.startMin !== null ? formatTime(item.startMin) : "";
  // Marked done with no watch data: its estimate (340), "≈" on each guessed value.
  const fromWatch = watch ? statLine(sessionStats(watch, venueOf(watch, e.title))) : est ? estimateLine(est, true, true) : "";
  return (
    <div className={`tr-row ${e.status} k-futsal ${lifted ? "lifted" : ""}`} role="button" onClick={onOpen} {...dragProps}>
      <Ring kind="futsal" done={e.status === "done"} label={e.status === "done" ? `${e.title}: done. Tap to undo` : `Mark ${e.title} done`} onTick={onTick} />
      <KindIcon kind="futsal" icon={gameIcon(e)} />
      <span className="tr-row-text">
        <span className="title">{e.title}</span>
        <span className="detail">{[at, fromWatch || (e.durationMin ? `${e.durationMin} min` : ""), e.note].filter(Boolean).join(" · ")}</span>
      </span>
      {warn > 0 && <RuleMark n={warn} onOpen={onWarn} />}
    </div>
  );
}

/** Under a session just ticked: effort, pain and a note, all optional. Closes by itself once left alone. */
function AskRow({ lp, s, e, onDone }: { lp: LoadedPlan; s: Session; e: Entry; onDone: () => void }) {
  return <AskBox onDone={onDone}><HowItWent lp={lp} s={s} e={e} readOnly={false} compact /></AskBox>;
}

/** Under a game just ticked: its effort and pain, as a session's, kept in the game's log. */
function GameAskRow({ plan, e, onDone }: { plan: Plan; e: Entry; onDone: () => void }) {
  return <AskBox onDone={onDone}><div className="tr-howwent compact"><GameScales plan={plan} e={e} /></div></AskBox>;
}

/** A game's effort and pain, saved as they're picked. */
function GameScales({ plan, e }: { plan: Plan; e: Entry }) {
  const ref = e.itemId !== undefined && e.day !== null ? { itemId: e.itemId, day: e.day } : null;
  return <>
    <Scale label="Effort" hint="1 very easy · 10 all-out" from={1} to={10} value={e.effort} disabled={!ref} onPick={(v) => { if (ref) saveGameLog(ref, plan.id, { effort: v }); }} />
    <Scale label="Pain" hint="0 none · 10 worst" from={0} to={10} value={e.pain} disabled={!ref} onPick={(v) => { if (ref) saveGameLog(ref, plan.id, { pain: v }); }} />
  </>;
}

/** The box that holds it: it closes by itself once left alone. */
function AskBox({ onDone, children }: { onDone: () => void; children: ReactNode }) {
  const timer = useRef(0);
  const focused = useRef(false);
  const arm = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (!focused.current) onDone(); }, ASK_MS); };
  useEffect(() => { arm(); return () => clearTimeout(timer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tr-ask" onPointerDown={arm} onKeyDown={arm}
      onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; arm(); }}>
      {children}
    </div>
  );
}

/**
 * Adds or changes a futsal game (a futsal event's day, item 240): its day (in the phase shown), its time
 * when the event has one, how long, a note. A new one is an untimed event "Futsal"; Event opens the event
 * itself (its place, reminders, repeat). Remove takes that day off (the event, if it doesn't repeat).
 */
function FutsalSheet({ plan, ph, entry, t, watch, onPlaced, onClose }: {
  plan: Plan; ph: Phase; entry: Entry | null; t: number; watch: HealthSession | undefined; onPlaced: (g: GameRef, undo: () => void) => void; onClose: () => void;
}) {
  const game: GameRef | null = entry && entry.itemId !== undefined && entry.day !== null ? { itemId: entry.itemId, day: entry.day } : null;
  const item = game ? snapshot().byId.get(game.itemId) : undefined;
  const timed = !!item && !item.allDay && item.startMin !== null;
  const [day, setDay] = useState(game?.day ?? Math.min(ph.end, Math.max(ph.start, t)));
  const [min, setMin] = useState<number | null>(timed ? item.startMin : null);
  const [picking, setPicking] = useState(false);
  const [dur, setDur] = useState<number | null>(entry ? entry.durationMin : 60);
  const [note, setNote] = useState(entry?.note ?? "");
  const days = Array.from({ length: ph.end - ph.start + 1 }, (_, k) => ph.start + k);
  if (!days.includes(day)) days.unshift(day);
  const save = (close: () => void) => {
    let now: GameRef = game ?? { itemId: 0, day };
    const undo = withUndo(() => {
      now = game ? moveGame(game, day, min ?? undefined) : addGame(day);
      saveGameLog(now, plan.id, { durationMin: dur, note: note.trim() });
    });
    feel("settle");
    if (!game || game.day !== day) onPlaced(now, undo);
    close();
  };
  return (
    <BottomSheet onClose={onClose}>{(close) => (
      <div className="tr-futsal">
        <div className="tr-sheet-title t-title-medium">{entry ? entry.title : "Add futsal"}</div>
        {watch && entry && <>
          <div className="tr-label">{watchHead(watch)}</div>
          <WatchStatsGrid stats={sessionStats(watch, venueOf(watch, entry.title))} inset />
        </>}
        {!watch && entry && training().gameEstimates.get(entry.id) && <>
          <div className="tr-label">Estimate: no watch data</div>
          <EstimateStats x={training().gameEstimates.get(entry.id)!} what="game" inset />
        </>}
        <div className="tr-label">Day</div>
        <ChipRow>{days.map((d) => <FilterChip key={d} selected={d === day} onClick={() => setDay(d)}>{formatDate(d)}</FilterChip>)}</ChipRow>
        {timed && min !== null && <>
          <div className="tr-label">Time</div>
          <ChipRow><FilterChip selected onClick={() => setPicking(true)}>{formatTime(min)}</FilterChip></ChipRow>
        </>}
        <div className="tr-label">How long</div>
        <ChipRow>{[45, 60, 75, 90, 120].map((m) => <FilterChip key={m} selected={dur === m} onClick={() => setDur(dur === m ? null : m)}>{m} min</FilterChip>)}</ChipRow>
        <div className="tr-futsal-note"><OutlinedTextField label="Note" value={note} onChange={setNote} onEnter={() => save(close)} /></div>
        {entry && game && <div className="tr-futsal-rate"><GameScales plan={plan} e={training().entries.get(entry.id) ?? entry} /></div>}
        <div className="p-sheet-buttons">
          {game && <TextButton onClick={() => { const undo = withUndo(() => removeGame(game)); close(); showSnackbar(`${entry!.title} removed`, "Undo", undo); }}>Remove</TextButton>}
          {game && <TextButton onClick={() => { close(); go(`item/${game.itemId}?occ=${game.day}`); }}>Event</TextButton>}
          <span className="grow" />
          <TextButton onClick={close}>Cancel</TextButton>
          <button className="p-filled-btn" onClick={() => save(close)}>Save</button>
        </div>
        {picking && <TimePickerDialog value={min} onClose={() => setPicking(false)} onPick={(m) => { setMin(m); setPicking(false); }} />}
      </div>
    )}</BottomSheet>
  );
}

/**
 * Placing or moving a session or futsal onto a day that breaks one of the phase's rules (it's done all the
 * same, never blocked), or a tap on a row's marker: the rules it breaks, worst first, and the plan's tips;
 * then the week's days, each with a dot for how it would fit there, so a better day is one tap away. Cancel
 * takes the placement back; moving re-checks the new day, and the sheet stays only if that breaks one too.
 */
function PlacementSheet({ tr, lp, warn, onMoved, onClose }: {
  tr: Training; lp: LoadedPlan; warn: Warn; onMoved: (w: Warn) => void; onClose: () => void;
}) {
  const { plan } = lp;
  const { item, day } = warn;
  const [to, setTo] = useState<number | null>(null);
  const s = "session" in item ? sessionsOf(plan).find((x) => x.id === item.session) : undefined;
  const game = "futsal" in item && item.futsal ? tr.entries.get(item.futsal) : undefined;
  const title = s?.title ?? (game?.sport ? game.title : "Futsal");
  const all = brokenRules(plan, tr.entries, item, day);
  const rules = breachesOnly(all);
  const ph = plan.phases.find((p) => day >= p.start && day <= p.end);
  const days = ph ? Array.from({ length: ph.end - ph.start + 1 }, (_, k) => ph.start + k) : [day];
  const fit = useMemo(() => dayFit(plan, tr.entries, item, days), [plan, tr.entries, item, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (close: () => void) => {
    if (to === null) return;
    // Taking it back goes to where it was before the first placement, or before this move from a marker.
    let undo = warn.undo;
    let moved = item;
    if (s) {
      const before = entryFor(plan, s, training().entries);
      undo ??= () => saveEntry(before);
      patchEntry(lp, s, { day: to });
    } else {
      // A futsal game: its event moves (one day of a repeating one becomes its own), so its key changes.
      const e = "futsal" in item && item.futsal ? training().entries.get(item.futsal) : undefined;
      if (!e || e.itemId === undefined || e.day === null) return;
      let now: GameRef = { itemId: e.itemId, day: e.day };
      const back = withUndo(() => { now = moveGame(now, to); });
      const first = undo;
      undo = first ? () => { back(); first(); } : back;
      moved = { futsal: futsalLogId(now.itemId, now.day) };
    }
    feel("settle");
    setTo(null);
    if (breachesOnly(brokenRules(plan, training().entries, moved, to)).length) onMoved({ item: moved, day: to, undo });
    else { close(); showSnackbar(`${title} on ${formatDate(to)}`, "Undo", undo); }
  };
  return (
    <BottomSheet onClose={onClose}>{(close) => (
      <div className="tr-place">
        <div className="tr-place-title">{title} on {formatDate(day)}</div>
        <div className="tr-place-sub">{breachSummary(rules) || "breaks no rule now"}</div>
        {rules.map((b) => (
          <div key={`${b.phase}|${b.rule.id}`} className="tr-place-rule">
            <span className={`tr-level ${b.rule.level}`}>{b.rule.level === "avoid" ? "Avoid" : "Ideally"}</span>
            <span className="text"><span className="x">{ruleWords(b).text}</span>{b.rule.why && <span className="why">{ruleWords(b).why}</span>}</span>
          </div>
        ))}
        {all.filter((b) => b.rule.level === "note").map((b) => (
          <div key={`${b.phase}|${b.rule.id}`} className="tr-place-note"><MIcon name="oLightbulb" size={14} /><span>{ruleWords(b).text}</span></div>
        ))}
        <div className="tr-place-label">Or move it to</div>
        <div className="tr-place-days" role="radiogroup" aria-label="Move it to">
          {days.map((d) => (
            <button key={d} role="radio" aria-checked={to === d} className={`${d === day ? "cur" : ""} ${to === d ? "on" : ""}`}
              onClick={() => { feel("tick"); setTo(d === day || to === d ? null : d); }}>
              {dayShort(weekday(d))}<i className={`fit-${fit.get(d) ?? "none"}`} />
            </button>
          ))}
        </div>
        <div className="p-sheet-buttons">
          <TextButton className="tr-place-cancel" onClick={() => { warn.undo?.(); close(); }}>{warn.undo ? "Cancel" : "Close"}</TextButton>
          {(warn.undo || to !== null) && (
            <TextButton onClick={() => (to === null ? close() : move(close))}>{to === null ? "Place anyway" : `Move to ${dayShort(weekday(to))}`}</TextButton>
          )}
        </div>
      </div>
    )}</BottomSheet>
  );
}

/**
 * After the plan session pushes an update: the changes that affect a day the user had (a session taken
 * out, a fixed day moved, a day now outside its week), until dismissed. With nothing to say, what was
 * seen is brought up to date quietly.
 */
function UpdateNotice({ tr, lp, readOnly }: { tr: Training; lp: LoadedPlan; readOnly: boolean }) {
  const { plan } = lp;
  const seen = tr.seen.get(plan.id) ?? null;
  const changes = planChanges(plan, seen, tr.entries.values()).filter((c) => !seen?.dismissed?.includes(changeKey(c)));
  const now = seenOf(plan);
  const stale = !seen || JSON.stringify(seen.sessions) !== JSON.stringify(now.sessions);
  useEffect(() => {
    if (!readOnly && changes.length === 0 && stale) saveSeen({ ...now, dismissed: seen?.dismissed ?? [] });
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!changes.length || readOnly) return null;
  const when = (d: number | null | undefined) => (d == null ? "no fixed day" : formatDate(d));
  return (
    <div className="tr-notice" role="status">
      <div className="tr-notice-head"><MIcon name="oUpdate" size={20} /><span>The plan was updated</span></div>
      <ul>
        {changes.map((c) => (
          <li key={changeKey(c)}>
            {c.kind === "removed" ? `${c.title} (${when(c.day)}) was taken out of the plan.`
              : c.kind === "moved" ? `The plan moved ${c.title} from ${when(c.day)} to ${when(c.newDay)}.`
              : `${c.title} is on ${when(c.day)}, outside its week now.`}
          </li>
        ))}
      </ul>
      <div className="tr-notice-actions">
        <TextButton onClick={() => saveSeen({ ...now, dismissed: [...(seen?.dismissed ?? []), ...changes.map(changeKey)] })}>Got it</TextButton>
      </div>
    </div>
  );
}

/**
 * The phone only, once: asks to read the watch's runs and sleep from Health Connect. Connect asks Health
 * Connect's permissions; Not now hides it for good (Settings has the switch).
 */
function HealthCard() {
  const h = useHealth();
  if (!canUseHealth(h) || h.on || cardDismissed()) return null;
  return (
    <div className="tr-notice" role="status">
      <div className="tr-notice-head"><MIcon name="oDirectionsRun" size={20} /><span>Show your watch runs and sleep</span></div>
      <p className="tr-notice-text">Planner reads them from Health Connect, where Garmin Connect puts them after each sync.</p>
      <div className="tr-notice-actions">
        <TextButton onClick={dismissCard}>Not now</TextButton>
        <TextButton onClick={() => void connect()}>Connect</TextButton>
      </div>
    </div>
  );
}

/** Where a held row is let go: a day (null for To place), and its place among what's on that day. */
export interface DayDrop { day: number | null; index: number; ids: string[] }

/** The drop's settle runs on 0..1, so it needs its own (much finer) resting point (as rowDrag.ts). */
const SETTLE = { ...GLIDE_SPRING, restDelta: 0.002, restSpeed: 0.05 };

interface Slot { id: string; el: HTMLElement; top: number; h: number }
interface DayDragState {
  id: string; stay: boolean; pointer: number; x0: number; y0: number; fy: number; el: HTMLElement; held: boolean; timer: number;
  ghost: HTMLElement | null; gTop: number; gH: number; over: string | null; raf: number; stop: () => void;
  /** The row's own day, its rows when lifted (tops from the day's top), its index there, and the place it would land (-1: none yet). */
  home: string | null; dayEl: HTMLElement | null; rows: Slot[]; from: number; to: number; line: HTMLElement | null; lineAfter: boolean;
}

/**
 * Holding a placed session (or a game) lifts it: a copy follows the finger. Over its own day the others slide out
 * of its way, as a to-do's do (rowDrag.ts), and its faded row shows where it lands (324); over another day a line
 * marks the place; over To place it's taken off its day. A game stays on its own day (its event's day moves from
 * the game's sheet), as does a session the plan locked. The list doesn't scroll under the finger while one is held, but does near its top and bottom
 * edges. Rows are the [data-item] elements inside each [data-drop] day, in the order shown.
 */
function useDayDrag(scroller: RefObject<HTMLElement>, onDrop: (id: string, to: DayDrop) => void) {
  const [lifted, setLifted] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const g = useRef<DayDragState | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const settling = useRef<Animation | null>(null);

  /** The copy's middle, on the screen now. */
  const mid = (d: DayDragState) => d.gTop + (d.fy - d.y0) + d.gH / 2;
  const clearLine = (d: DayDragState) => { if (d.line) { delete d.line.dataset.dropline; d.line = null; } };
  const unshift = (d: DayDragState) => { for (const r of d.rows) r.el.style.transform = ""; };

  /** Over its own day: the place under the copy's middle, the others moved out of its way. */
  const reorder = (d: DayDragState) => {
    const m = mid(d) - (d.dayEl?.getBoundingClientRect().top ?? 0);
    let to = 0;
    d.rows.forEach((r, i) => { if (i !== d.from && r.top + r.h / 2 < m) to++; });
    if (to === d.to) return;
    if (d.to !== -1) feel("tick");
    d.to = to;
    const me = d.rows[d.from];
    if (!me) return;
    let gap = 0;
    d.rows.forEach((r, i) => {
      if (i === d.from) return;
      const dy = i > d.from && i <= to ? -me.h : i < d.from && i >= to ? me.h : 0;
      if (dy) gap -= Math.sign(dy) * r.h;
      r.el.style.transform = dy ? `translate3d(0,${dy}px,0)` : "";
    });
    me.el.style.transform = gap ? `translate3d(0,${gap}px,0)` : "";
  };
  /** Over another day: the place among its rows, marked by a line above the row it goes before (or under the last). */
  const placeIn = (d: DayDragState, day: HTMLElement) => {
    const rows = [...day.querySelectorAll<HTMLElement>("[data-item]")];
    const m = mid(d);
    let to = 0;
    for (const r of rows) { const b = r.getBoundingClientRect(); if (b.top + b.height / 2 < m) to++; }
    const el = rows[Math.min(to, rows.length - 1)] ?? null, after = to >= rows.length;
    if (el !== d.line || after !== d.lineAfter) {
      clearLine(d);
      if (el) { el.dataset.dropline = after ? "after" : "before"; d.line = el; d.lineAfter = after; if (d.to !== -1 && d.to !== to) feel("tick"); }
    }
    d.to = to;
  };

  const hover = (d: DayDragState) => {
    const el = document.elementFromPoint(d.x0, d.fy)?.closest<HTMLElement>("[data-drop]") ?? null;
    // A game (or a locked session) stays on its own day.
    const key = el && (!d.stay || el.dataset.drop === d.home) ? el.dataset.drop ?? null : null;
    if (key !== d.over) {
      if (d.over === d.home) unshift(d);
      clearLine(d);
      d.to = -1;
      d.over = key;
      setOver(key);
      if (key && key !== d.home) feel("tick");
    }
    if (!el || key === null || key === "none") return;
    if (key === d.home) reorder(d); else placeIn(d, el);
  };
  const end = () => {
    const d = g.current;
    if (!d) return null;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.raf);
    d.ghost?.remove();
    clearLine(d);
    d.stop();
    if (d.held && d.dayEl) anchor.current = { el: d.dayEl, top: d.dayEl.getBoundingClientRect().top };
    g.current = null;
    setLifted(null);
    setOver(null);
    return d;
  };
  useEffect(() => () => { const d = end(); if (d) unshift(d); settling.current?.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Lifting shows To place above the days (and letting go may hide it): the list scrolls by as much, so the days
  // stay where they were under the finger.
  const anchor = useRef<{ el: HTMLElement; top: number } | null>(null);
  useLayoutEffect(() => {
    const d = g.current, sc = scroller.current, a = anchor.current;
    anchor.current = null;
    if (!sc) return;
    if (lifted && d?.held) {
      const dy = d.el.getBoundingClientRect().top - d.gTop;
      if (Math.abs(dy) > 1) { sc.scrollTop += dy; hover(d); }
    } else if (!lifted && a?.el.isConnected) {
      const dy = a.el.getBoundingClientRect().top - a.top;
      if (Math.abs(dy) > 1) sc.scrollTop += dy;
    }
  }, [lifted]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Lets go of [d] over [key]: the rows are drawn where they go at once, and the row glides from under the finger into its place. */
  const drop = (d: DayDragState, key: string | null) => {
    const was = d.gTop + (d.fy - d.y0);
    const home = key === d.home;
    if (key === null || (home && (d.to === d.from || d.to < 0))) { unshift(d); return; } // back where it was: the others slide back too
    const day = key === "none" ? null : Number(key);
    const ids = home ? d.rows.map((r) => r.id)
      : [...(document.querySelector(`[data-drop="${key}"]`)?.querySelectorAll<HTMLElement>("[data-item]") ?? [])].map((x) => x.dataset.item!);
    const list = scroller.current;
    if (list) list.dataset.reorder = "";
    flushSync(() => dropRef.current(d.id, { day, index: Math.max(0, d.to), ids }));
    unshift(d);
    if (list) delete list.dataset.reorder;
    const row = document.querySelector<HTMLElement>(`[data-item="${CSS.escape(d.id)}"]`);
    if (!row || day === null) return;
    const dy = was - row.getBoundingClientRect().top;
    settling.current?.stop();
    row.style.transform = `translate3d(0,${dy}px,0)`;
    settling.current = animateSpring(1, 0, 0, (k) => { row.style.transform = k ? `translate3d(0,${dy * k}px,0)` : ""; },
      () => { row.style.transform = ""; settling.current = null; }, SETTLE);
  };

  const props = (id: string, stay = false) => ({
    onPointerDown: (ev: React.PointerEvent<HTMLElement>) => {
      if (g.current || !ev.isPrimary || (ev.pointerType === "mouse" && ev.button !== 0)) return;
      if ((ev.target as Element).closest(".tr-ring, .tr-warn")) return;
      const el = ev.currentTarget;
      const move = (e: PointerEvent) => {
        const d = g.current;
        if (!d || e.pointerId !== d.pointer) return;
        if (!d.held) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > TOUCH_SLOP) end(); return; }
        d.fy = e.clientY;
        if (d.ghost) d.ghost.style.transform = `translate3d(0,${e.clientY - d.y0}px,0) scale(1.02)`;
        hover(d);
      };
      const up = (e: PointerEvent) => {
        const d = g.current;
        if (!d || e.pointerId !== d.pointer) return;
        const target = d.held && e.type === "pointerup" ? d.over : null;
        if (d.held) swallowClick(500);
        end();
        if (d.held) drop(d, target);
      };
      const noScroll = (e: TouchEvent) => { if (g.current?.held && e.cancelable) e.preventDefault(); };
      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerup", up, { passive: true });
      window.addEventListener("pointercancel", up, { passive: true });
      document.addEventListener("touchmove", noScroll, { passive: false });
      const d: DayDragState = {
        id, stay, pointer: ev.pointerId, x0: ev.clientX, y0: ev.clientY, fy: ev.clientY, el, held: false, timer: 0, ghost: null, gTop: 0, gH: 0, over: null, raf: 0,
        home: null, dayEl: null, rows: [], from: 0, to: -1, line: null, lineAfter: false,
        stop: () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          document.removeEventListener("touchmove", noScroll);
        },
      };
      g.current = d;
      d.timer = window.setTimeout(() => {
        if (g.current !== d) return;
        settling.current?.stop();
        d.held = true;
        feel("pickup");
        // Its day's rows as they are now, and the row's place among them.
        const day = el.closest<HTMLElement>("[data-drop]");
        d.home = day?.dataset.drop ?? null;
        d.dayEl = day;
        const top0 = day?.getBoundingClientRect().top ?? 0;
        d.rows = [...(day?.querySelectorAll<HTMLElement>("[data-item]") ?? [])].map((x) => {
          x.style.transform = "";
          const b = x.getBoundingClientRect();
          return { id: x.dataset.item!, el: x, top: b.top - top0, h: b.height };
        });
        d.from = Math.max(0, d.rows.findIndex((r) => r.id === id));
        // A copy of the row follows the finger; the row itself stays, faded, where it will land.
        const r = el.getBoundingClientRect();
        d.gTop = r.top; d.gH = r.height;
        const ghost = el.cloneNode(true) as HTMLElement;
        ghost.classList.add("tr-ghost");
        Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        document.body.appendChild(ghost);
        d.ghost = ghost;
        setLifted(id);
        hover(d);
        // Near the top or bottom edge, the list scrolls (the finger stays put, so the day under it changes).
        let last = performance.now();
        const step = (now: number) => {
          if (g.current !== d) return;
          const sc = scroller.current;
          if (sc) {
            const r2 = sc.getBoundingClientRect();
            const vy = edgeSpeed(d.fy, r2.top, r2.bottom) * Math.min(3, Math.max(0.5, (now - last) / 16.7));
            if (vy) { sc.scrollTop += vy; hover(d); }
          }
          last = now;
          d.raf = requestAnimationFrame(step);
        };
        d.raf = requestAnimationFrame(step);
      }, LONG_PRESS);
    },
    // A long press mustn't bring up the browser's own menu.
    onContextMenu: (ev: React.MouseEvent) => ev.preventDefault(),
  });
  return { props, lifted, over };
}

// ---------- Today and the calendar ----------

/**
 * Today's training line for the day shown: its session(s), else, on today, how many are still to place
 * this week, else a rest day (freeDayLine). Only while a plan runs; a tap opens the session or the week.
 */
export function TrainingLine({ day, t }: { day: number; t: number }) {
  const tr = useTraining();
  useLooks();
  const lp = activeOf(tr, t);
  if (!lp || day < lp.plan.start || day > lp.plan.end) return null;
  const { plan } = lp;
  const on = sessionsOnDay(plan, day, tr.entries, tr.orders).filter((x) => x.entry.status !== "skipped");
  // The day's game (futsal, or another sport by its own title, 267).
  const game = [...tr.entries.values()].find((e) => e.planId === plan.id && e.kind === "futsal" && e.deletedAt === null && e.day === day);
  const futsal = game ? (game.sport ? game.title : "Futsal") : "";
  // Put first on the day (324), the game leads the line.
  const gameFirst = !!game && on.length > 0 && inDayOrder([on[0].entry.id, game.id], (x) => x, tr.orders.get(dayOrderId(plan.id, day)))[0] === game.id;
  let text: string, icon = "oDirectionsRun", target = `training?d=${day}`, rest = false;
  if (on.length) {
    text = on.length === 1 ? [on[0].session.title, on[0].session.detail].filter(Boolean).join(" · ") : on.map((x) => x.session.title).join(" + ");
    icon = sessionIcon(on[0].session);
    if (on.length === 1) target = `training?s=${encodeURIComponent(on[0].session.id)}&d=${day}`;
  } else {
    const left = day >= t ? leftToPlace(plan, day, tr.entries).length : 0;
    const line = freeDayLine(left, day, t, !!futsal);
    if (line === "none") return null;
    if (line === "place") text = `${count(left, "session")} to place this week`;
    else { text = futsal || "Rest day"; rest = !futsal; }
  }
  if (on.length && futsal) text = gameFirst ? `${futsal} · ${text}` : `${text} · ${futsal}`;
  const done = on.length > 0 && on.every((x) => x.entry.status === "done");
  return (
    <button className={`tr-todayline ${rest ? "rest" : ""} ${done ? "done" : ""}`} onClick={() => go(target)}>
      <MIcon name={icon} size={18} />
      <span className="label">Training</span>
      <span className="text">{text}</span>
      {done && <MIcon name="fCheck" size={16} />}
      <MIcon name="fKeyboardArrowRight" size={18} />
    </button>
  );
}

/** The days with a session on them (placed, or the plan's own day), each with its icon: the calendar's light marks. */
export function useTrainingDays(): Map<number, string> {
  const tr = useTraining();
  const looks = useLooks();
  return useMemo(() => {
    const out = new Map<number, string>();
    const lp = activeOf(tr);
    if (!lp) return out;
    for (const s of sessionsOf(lp.plan)) {
      const e = tr.entries.get(entryId(lp.plan.id, s.id));
      const day = dayOfSession(s, e);
      if (day !== null && e?.status !== "skipped" && !out.has(day)) out.set(day, sessionIcon(s));
    }
    return out;
  }, [tr, looks]);
}

