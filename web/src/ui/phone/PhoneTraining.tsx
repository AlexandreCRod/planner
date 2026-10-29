// The Training page (#/training): the active plan a phase at a time, as the plan session wrote it.
// The phase strip at the top; the phase's summary, notes and placement rules; To place (sessions without a
// day: tap one, then tap a day); then each day with its sessions and futsal. A placed session can be held
// and dragged to another day (or back to To place). The ring on a row ticks it done, and a small "how it
// went" row opens under it and closes by itself. A tap on a row opens the session (TrainingSession.tsx):
// over the week on the phone, beside it in a wide window. Progress (TrainingProgress.tsx) and the documents are
// in the top bar. Placing a session or futsal on a day that breaks one of the phase's rules opens a sheet that
// says so (it's never blocked), and a row shows "⚠ 1 rule" while it breaks one.
// Above the week, the sleep line (last night, the 7-day average, resting HR, HRV; a tap opens Progress on
// Sleep), and two quiet markers: a moon on a key run (quality or long) after a night under 6 h, and a small
// heart on a day whose resting HR is up 7+ on its 7-day average two mornings running (domain/sleep.ts).
// Also here: Today's training line and the calendar's light marks.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { dayShort, formatDate, formatTime, today as todayEpoch, weekday } from "../../domain/dates.ts";
import { type Breach, type ItemRef, breachSummary, breachesOnly, brokenNow, brokenRules, dayFit } from "../../domain/placement.ts";
import { count } from "../../domain/plural.ts";
import {
  type Entry, type Phase, type Plan, type Session, changeKey, dayOfSession, entryFor, entryId, futsalLogId, leftToPlace, phaseIndexAt,
  phaseView, planChanges, seenOf, sessionsOf, sessionsOnDay,
} from "../../domain/training.ts";
import { type ColourKind, type WeekBar, colourKind, fmtKm, runLine, runOf, summaryKm, weekBar } from "../../domain/trainingWeek.ts";
import type { Run } from "../../domain/trends.ts";
import { type SleepNight, fmtSleep, restingHrFlag, shortSleepBefore, sleepAverages } from "../../domain/sleep.ts";
import { type LoadedPlan, type Training, activeOf, saveEntry, saveSeen, training, useTraining } from "../../store/training.ts";
import { type GameRef, addGame, moveGame, removeGame, saveGameLog, tickGame } from "../../store/futsal.ts";
import { snapshot, withUndo } from "../../store/store.ts";
import { useWide } from "../../platform.ts";
import { canUseHealth, cardDismissed, connect, dismissCard, useHealth } from "../../health/healthConnect.ts";
import { go, replaceRoute } from "../shared/common.tsx";
import { ChipRow, EmptyHint, FilterChip, IconButton, MIcon, Scaffold, SectionHeader } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { BottomSheet, OutlinedTextField, TextButton, showSnackbar } from "./m3.tsx";
import { TimePickerDialog } from "./pickers.tsx";
import { TOUCH_SLOP, swallowClick } from "./press.ts";
import { edgeSpeed } from "./selectScroll.ts";
import { ExerciseHistory, TrainingDocs } from "./TrainingDocs.tsx";
import { TrainingFind } from "./TrainingFind.tsx";
import { TrainingProgress } from "./TrainingProgress.tsx";
import { HowItWent, SessionView, patchEntry, setSessionStatus } from "./TrainingSession.tsx";
import { gameIcon, kindIcon, phaseNames, planQ, sessionIcon, trainingLookClass } from "./trainingParts.tsx";
import { useLooks } from "./looks.ts";
import { WatchRunChips, useWatchRunAsks, useWatchRunTicks } from "./WatchRuns.tsx";
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
  const planId = query.get("p");
  const active = activeOf(tr, t);
  const lp = (planId && tr.plans.find((p) => p.plan.id === planId)) || active;
  if (!lp) {
    return (
      <Scaffold title="Training">
        <EmptyHint>No training plan on this device yet. The plan session sends it from the PC, and it arrives with the next sync.</EmptyHint>
      </Scaffold>
    );
  }
  const view = query.get("view");
  const sid = query.get("s");
  const readOnly = lp !== active;
  const d = query.get("d");
  // A session moved from its own page (over the week, on a phone) onto a day that breaks a rule.
  const moved = (sid: string, day: number, undo: () => void) => { const w = checkPlaced(lp, { session: sid }, day, undo); if (w) setMovedWarn(w); return !!w; };
  return <>
    <TrainingWeek tr={tr} lp={lp} t={t} wide={wide} sessionId={view ? null : sid} readOnly={readOnly} planId={planId} focusDay={d ? Number(d) : null} />
    {!wide && sid && !view && (
      <div className="tr-layer"><SessionView key={sid} tr={tr} lp={lp} sessionId={sid} readOnly={readOnly} onClose={() => history.back()} onMoved={moved} /></div>
    )}
    {movedWarn && <PlacementSheet tr={tr} lp={lp} warn={movedWarn} onMoved={setMovedWarn} onClose={() => setMovedWarn(null)} />}
    {view && (
      <div className="tr-layer full">
        {view === "docs" ? <TrainingDocs lp={lp} file={query.get("doc")} anchor={query.get("a")} planId={planId} />
          : view === "progress" || view === "bests" ? <TrainingProgress tr={tr} lp={lp} query={query} planId={planId} />
          : view === "ex" ? <ExerciseHistory tr={tr} lp={lp} id={query.get("x") ?? ""} planId={planId} />
          : view === "find" ? <TrainingFind tr={tr} lp={lp} planId={planId} />
          : null}
      </div>
    )}
  </>;
}

// The phase looked at and the list's scroll, kept while the page is away (a document, the session).
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
  // What breaks a placement rule now, by session id or futsal entry id: the rows' markers.
  const broken = useMemo(() => (readOnly ? new Map<string, Breach[]>() : brokenNow(plan, tr.entries)), [plan, tr.entries, readOnly]);
  const check = (item: ItemRef, day: number, undo: () => void) => checkPlaced(lp, item, day, undo);
  const place = (sid: string, day: number | null) => {
    const s = sessions.get(sid);
    if (!s || s.locked) return;
    const before = entryFor(plan, s, training().entries);
    if (dayOfSession(s, training().entries.get(before.id)) === day) { setPicked(null); return; }
    patchEntry(lp, s, { day });
    feel("settle");
    setPicked(null);
    // On a day that breaks a rule, the sheet says so (and can undo it); else the usual snackbar.
    const w = day === null ? null : check({ session: sid }, day, () => saveEntry(before));
    if (w) setWarn(w);
    else showSnackbar(day === null ? `${s.title} back in To place` : `${s.title} on ${formatDate(day)}`, "Undo", () => saveEntry(before));
  };
  const drag = useDayDrag(scroller, place);
  useWatchRunTicks(readOnly);
  const watchAsks = useWatchRunAsks(tr, lp, t, readOnly);

  if (!plan.phases.length) return <Scaffold title="Training"><EmptyHint>This plan has no phases yet.</EmptyHint></Scaffold>;
  const ph = plan.phases[phase];
  const v = phaseView(plan, phase, tr.entries, tr.entries.values());
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
    if (e.status !== "done") feel("confirm");
    tickGame({ itemId: e.itemId, day: e.day }, e.status !== "done");
  };
  const pickedSession = picked ? sessions.get(picked) : undefined;
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
          <SectionHeader>To place</SectionHeader>
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
          {items.length === 0 && <div className="tr-rest">{picked ? "Tap to put it here" : "Rest"}</div>}
          {items.map(({ session: s, entry: e }) => s ? (
            <div key={s.id}>
              <SessionRow s={s} e={e} run={s.kind === "run" && e.status === "done" ? runOf(tr.runs, s.id) : null} selected={wide && sessionId === s.id} lifted={drag.lifted === s.id}
                slept={keyRun(s) && day <= t ? shortSleepBefore(tr.sleep, day) : null} lastNight={day === t}
                warn={broken.get(s.id)?.length ?? 0} onWarn={() => setWarn({ item: { session: s.id }, day, undo: null })}
                onTick={() => tick(s, e)} onOpen={() => open(s.id)} dragProps={readOnly || s.locked ? undefined : drag.props(s.id)} />
              {asked === e.id && e.status === "done" && <AskRow lp={lp} s={s} e={e} onDone={() => setAsked(null)} />}
            </div>
          ) : (
            <FutsalRow key={e.id} e={e} warn={broken.get(e.id)?.length ?? 0} onWarn={() => setWarn({ item: { futsal: e.id }, day, undo: null })} onTick={() => tickFutsal(e)} onOpen={() => !readOnly && setFutsal(e)} />
          ))}
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
    <Scaffold title={<span className="tr-title">Training<span className="sub">{plan.name}</span></span>} flush actions={<>
      <IconButton icon="oSearch" label="Search training" onClick={() => go(`training?view=find${planQ(planId)}`)} />
      <IconButton icon="fShowChart" label="Progress" onClick={() => go(`training?view=progress${planQ(planId)}`)} />
      <IconButton icon="oMenuBook" label="Documents" onClick={() => go(`training?view=docs${planQ(planId)}`)} />
    </>}>
      {wide ? (
        <div className="tr-split">
          {week}
          <div className="tr-side">
            {sessionId
              ? <SessionView key={sessionId} tr={tr} lp={lp} sessionId={sessionId} readOnly={readOnly} closeIcon
                  onMoved={(sid, day, undo) => { const w = check({ session: sid }, day, undo); if (w) setWarn(w); return !!w; }}
                  onClose={() => replaceRoute(`training${planId ? `?p=${encodeURIComponent(planId)}` : ""}`)} />
              : <div className="tr-side-hint"><MIcon name="oDirectionsRun" size={40} /><span>Open a session to see its card and log it here</span></div>}
          </div>
        </div>
      ) : week}
      {futsal && <FutsalSheet plan={plan} ph={ph} entry={futsal === "new" ? null : futsal} t={t}
        onPlaced={(g, undo) => { warnNext.current = check({ futsal: futsalLogId(g.itemId, g.day) }, g.day, undo); }}
        onClose={() => { setFutsal(null); if (warnNext.current) { setWarn(warnNext.current); warnNext.current = null; } }} />}
      {warn && <PlacementSheet tr={tr} lp={lp} warn={warn} onMoved={setWarn} onClose={() => setWarn(null)} />}
    </Scaffold>
  );
}

/**
 * Under the week's title: a short bar per session or futsal game on its days, filling in its kind's colour
 * when done, then how many are done and the km run so far (of the week's planned km, when it has one).
 */
function WeekBarView({ bar, totalKm }: { bar: WeekBar; totalKm: string | null }) {
  const km = totalKm ? `${fmtKm(bar.km)} of ${totalKm}` : bar.km > 0 ? `${fmtKm(bar.km)} km` : "";
  return <>
    <div className="tr-bar" aria-hidden="true">
      {bar.segments.map((g, i) => <i key={i} className={`${g.kind ? `k-${g.kind}` : ""} ${g.done ? "done" : ""}`} />)}
    </div>
    <div className="tr-bar-text"><span>{bar.done} of {bar.segments.length} done</span><span>{km}</span></div>
  </>;
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
 * "Slept 7 h 12 · 7-day average 7 h 05 · resting HR 51 · HRV 52": the latest morning, when it's today's or
 * yesterday's (else nothing shows); parts without data are left out. A tap opens the Sleep tab.
 */
function SleepLine({ nights, t, onOpen }: { nights: readonly SleepNight[]; t: number; onOpen: () => void }) {
  const n = nights[nights.length - 1];
  if (!n || n.day < t - 1) return null;
  const avg = sleepAverages(nights, n.day);
  const title = n.totalMin !== null ? `Slept ${fmtSleep(n.totalMin)}` : "Last night";
  const parts = [
    avg.sleepMin !== null && `7-day avg ${fmtSleep(avg.sleepMin)}`, n.restingHr !== null && `resting HR ${n.restingHr}`, n.hrvMs !== null && `HRV ${Math.round(n.hrvMs)}`,
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

function SessionRow({ s, e, run, selected, lifted, slept, lastNight, warn, onWarn, onTick, onOpen, dragProps }: {
  s: Session; e: Entry; run: Run | null; selected: boolean; lifted: boolean; slept: number | null; lastNight: boolean; warn: number; onWarn: () => void; onTick: () => void; onOpen: () => void;
  dragProps?: { onPointerDown: (ev: React.PointerEvent<HTMLElement>) => void; onContextMenu: (ev: React.MouseEvent) => void };
}) {
  const kind = colourKind({ session: s, entry: e });
  // A done run matched to one from the watch shows how it went instead of the plan's text.
  const ran = run ? runLine(run) : "";
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

/** A game (futsal or another sport, 267): its event's title, then its time, how long it was and the note. */
function FutsalRow({ e, warn, onWarn, onTick, onOpen }: { e: Entry; warn: number; onWarn: () => void; onTick: () => void; onOpen: () => void }) {
  const item = e.itemId !== undefined ? snapshot().byId.get(e.itemId) : undefined;
  const at = item && !item.allDay && item.startMin !== null ? formatTime(item.startMin) : "";
  return (
    <div className={`tr-row ${e.status} k-futsal`} role="button" onClick={onOpen}>
      <Ring kind="futsal" done={e.status === "done"} label={e.status === "done" ? `${e.title}: done. Tap to undo` : `Mark ${e.title} done`} onTick={onTick} />
      <KindIcon kind="futsal" icon={gameIcon(e)} />
      <span className="tr-row-text">
        <span className="title">{e.title}</span>
        <span className="detail">{[at, e.durationMin ? `${e.durationMin} min` : "", e.note].filter(Boolean).join(" · ")}</span>
      </span>
      {warn > 0 && <RuleMark n={warn} onOpen={onWarn} />}
    </div>
  );
}

/** Under a session just ticked: effort, pain and a note, all optional. Closes by itself once left alone. */
function AskRow({ lp, s, e, onDone }: { lp: LoadedPlan; s: Session; e: Entry; onDone: () => void }) {
  const timer = useRef(0);
  const focused = useRef(false);
  const arm = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (!focused.current) onDone(); }, ASK_MS); };
  useEffect(() => { arm(); return () => clearTimeout(timer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tr-ask" onPointerDown={arm} onKeyDown={arm}
      onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; arm(); }}>
      <HowItWent lp={lp} s={s} e={e} readOnly={false} compact />
    </div>
  );
}

/**
 * Adds or changes a futsal game (a futsal event's day, item 240): its day (in the phase shown), its time
 * when the event has one, how long, a note. A new one is an untimed event "Futsal"; Event opens the event
 * itself (its place, reminders, repeat). Remove takes that day off (the event, if it doesn't repeat).
 */
function FutsalSheet({ plan, ph, entry, t, onPlaced, onClose }: {
  plan: Plan; ph: Phase; entry: Entry | null; t: number; onPlaced: (g: GameRef, undo: () => void) => void; onClose: () => void;
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
        <div className="tr-label">Day</div>
        <ChipRow>{days.map((d) => <FilterChip key={d} selected={d === day} onClick={() => setDay(d)}>{formatDate(d)}</FilterChip>)}</ChipRow>
        {timed && min !== null && <>
          <div className="tr-label">Time</div>
          <ChipRow><FilterChip selected onClick={() => setPicking(true)}>{formatTime(min)}</FilterChip></ChipRow>
        </>}
        <div className="tr-label">How long</div>
        <ChipRow>{[45, 60, 75, 90, 120].map((m) => <FilterChip key={m} selected={dur === m} onClick={() => setDur(dur === m ? null : m)}>{m} min</FilterChip>)}</ChipRow>
        <div className="tr-futsal-note"><OutlinedTextField label="Note" value={note} onChange={setNote} onEnter={() => save(close)} /></div>
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
            <span className="text"><span className="x">{b.rule.text}</span>{b.rule.why && <span className="why">{b.rule.why}</span>}</span>
          </div>
        ))}
        {all.filter((b) => b.rule.level === "note").map((b) => (
          <div key={`${b.phase}|${b.rule.id}`} className="tr-place-note"><MIcon name="oLightbulb" size={14} /><span>{b.rule.text}</span></div>
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

/**
 * Holding a placed session lifts it; dragged over a day (or To place) and let go, it goes there. The list
 * doesn't scroll under the finger while one is held, but does near its top and bottom edges.
 */
function useDayDrag(scroller: RefObject<HTMLElement>, onDrop: (sid: string, day: number | null) => void) {
  const [lifted, setLifted] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const g = useRef<{ sid: string; id: number; x0: number; y0: number; fy: number; el: HTMLElement; held: boolean; timer: number;
    ghost: HTMLElement | null; over: string | null; raf: number; stop: () => void } | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const hover = (d: NonNullable<typeof g.current>) => {
    const el = document.elementFromPoint(d.x0, d.fy)?.closest<HTMLElement>("[data-drop]");
    const key = el?.dataset.drop ?? null;
    if (key !== d.over) { d.over = key; setOver(key); if (key) feel("tick"); }
  };
  const end = () => {
    const d = g.current;
    if (!d) return;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.raf);
    d.ghost?.remove();
    d.stop();
    g.current = null;
    setLifted(null);
    setOver(null);
  };
  useEffect(() => end, []); // eslint-disable-line react-hooks/exhaustive-deps

  const props = (sid: string) => ({
    onPointerDown: (ev: React.PointerEvent<HTMLElement>) => {
      if (g.current || !ev.isPrimary || (ev.pointerType === "mouse" && ev.button !== 0)) return;
      if ((ev.target as Element).closest(".tr-ring, .tr-warn")) return;
      const el = ev.currentTarget;
      const move = (e: PointerEvent) => {
        const d = g.current;
        if (!d || e.pointerId !== d.id) return;
        if (!d.held) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > TOUCH_SLOP) end(); return; }
        d.fy = e.clientY;
        if (d.ghost) d.ghost.style.transform = `translate3d(0,${e.clientY - d.y0}px,0) scale(1.02)`;
        hover(d);
      };
      const up = (e: PointerEvent) => {
        const d = g.current;
        if (!d || e.pointerId !== d.id) return;
        const target = d.held && e.type === "pointerup" ? d.over : null;
        if (d.held) swallowClick(500);
        end();
        if (target !== null) dropRef.current(sid, target === "none" ? null : Number(target));
      };
      const noScroll = (e: TouchEvent) => { if (g.current?.held && e.cancelable) e.preventDefault(); };
      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerup", up, { passive: true });
      window.addEventListener("pointercancel", up, { passive: true });
      document.addEventListener("touchmove", noScroll, { passive: false });
      const d = {
        sid, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, fy: ev.clientY, el, held: false, timer: 0, ghost: null as HTMLElement | null, over: null, raf: 0,
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
        d.held = true;
        feel("pickup");
        // A copy of the row follows the finger; the row itself stays, faded, where it was.
        const r = el.getBoundingClientRect();
        const ghost = el.cloneNode(true) as HTMLElement;
        ghost.classList.add("tr-ghost");
        Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        document.body.appendChild(ghost);
        d.ghost = ghost;
        setLifted(sid);
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
 * Today's training line for the day shown: its session(s), else how many are still to place this week,
 * else a rest day. Only while a plan runs; a tap opens the session or the week.
 */
export function TrainingLine({ day, t }: { day: number; t: number }) {
  const tr = useTraining();
  useLooks();
  const lp = activeOf(tr, t);
  if (!lp || day < lp.plan.start || day > lp.plan.end) return null;
  const { plan } = lp;
  const on = sessionsOnDay(plan, day, tr.entries).filter((x) => x.entry.status !== "skipped");
  // The day's game (futsal, or another sport by its own title, 267).
  const game = [...tr.entries.values()].find((e) => e.planId === plan.id && e.kind === "futsal" && e.deletedAt === null && e.day === day);
  const futsal = game ? (game.sport ? game.title : "Futsal") : "";
  let text: string, icon = "oDirectionsRun", target = `training?d=${day}`, rest = false;
  if (on.length) {
    text = on.length === 1 ? [on[0].session.title, on[0].session.detail].filter(Boolean).join(" · ") : on.map((x) => x.session.title).join(" + ");
    icon = sessionIcon(on[0].session);
    if (on.length === 1) target = `training?s=${encodeURIComponent(on[0].session.id)}&d=${day}`;
  } else {
    const left = day >= t ? leftToPlace(plan, day, tr.entries) : [];
    if (left.length) text = `${count(left.length, "session")} to place this week`;
    else { text = futsal || "Rest day"; rest = !futsal; }
  }
  if (on.length && futsal) text += ` · ${futsal}`;
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

