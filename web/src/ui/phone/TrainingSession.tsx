// One training session opened from the Training page: what it is and its day, Done / Skip / Move, how it
// went (effort, pain, a note), its card from the plan's documents and, for a gym session, the exercises.
// Sets come pre-filled (the target, else last time's numbers): one tap marks a set done, a tap on a
// number changes it. RPE is asked once per exercise, after its last set. A new rep best gets a quiet
// mark, never a prompt (the plan says never to chase numbers).
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, today as todayEpoch } from "../../domain/dates.ts";
import { sectionAt } from "../../domain/markdown.ts";
import { untickedEntry } from "../../domain/healthRuns.ts";
import {
  type Entry, type Lift, type Session, type SessionExercise, dayOfSession, entryFor, entryId, lastLift, liftId,
  newBestsIn, prefillSets, sessionsOf, targetLine,
} from "../../domain/training.ts";
import { type LoadedPlan, type Training, saveEntry, saveLift, training } from "../../store/training.ts";
import { go } from "../shared/common.tsx";
import { Dialog, DropdownMenu, EmptyHint, IconButton, MIcon, Scaffold, SectionHeader } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { SlideStepper } from "./SlideStepper.tsx";
import { BottomSheet, OutlinedButton, TextButton, showSnackbar } from "./m3.tsx";
import { MarkdownView, allExercises, docRoute } from "./TrainingDocs.tsx";
import { KIND_LABEL, Scale, fmtKg, kindIcon, phaseNames, planQ, setsText } from "./trainingParts.tsx";

/** Saves a session's entry: the latest copy, the plan's title and detail kept with it, then [patch]. */
export function patchEntry(lp: LoadedPlan, s: Session, patch: Partial<Entry>) {
  const e = entryFor(lp.plan, s, training().entries);
  saveEntry({ ...e, title: s.title, detail: s.detail, ...patch });
}

/** Done (on its own day if that's passed, else today), back to planned, or skipped. */
export function setSessionStatus(lp: LoadedPlan, s: Session, status: Entry["status"], t: number) {
  const e = entryFor(lp.plan, s, training().entries);
  const day = dayOfSession(s, training().entries.get(e.id));
  if (status === "done") {
    const doneDay = day !== null && day <= t ? day : t;
    patchEntry(lp, s, { status, doneDay, day: s.locked ? e.day : doneDay });
  } else patchEntry(lp, s, { status, doneDay: null, ...untickedEntry(e) });   // a watch run that ticked it never does again
}

/** The phase's days to move a session to, with what's on each, and To place. */
/** [onMoved]: after a move onto a day, opens the placement sheet if it breaks a rule there (true then: no snackbar). */
export function MoveSheet({ lp, s, onMoved, onClose }: {
  lp: LoadedPlan; s: Session; onMoved?: (sid: string, day: number, undo: () => void) => boolean; onClose: () => void;
}) {
  const tr = training();
  const ph = lp.plan.phases[s.phase];
  const cur = dayOfSession(s, tr.entries.get(entryFor(lp.plan, s, tr.entries).id));
  const days = Array.from({ length: ph.end - ph.start + 1 }, (_, k) => ph.start + k);
  const on = (d: number) => sessionsOf(lp.plan).filter((x) => x.id !== s.id && x.phase === s.phase && dayOfSession(x, tr.entries.get(entryId(lp.plan.id, x.id))) === d).map((x) => x.title);
  const move = (day: number | null, close: () => void) => {
    const before = entryFor(lp.plan, s, training().entries);
    patchEntry(lp, s, { day });
    feel("settle");
    close();
    // Once this sheet has gone (as the futsal sheet does), the placement sheet if a rule breaks, else the snackbar.
    window.setTimeout(() => {
      if (day !== null && onMoved?.(s.id, day, () => saveEntry(before))) return;
      showSnackbar(day === null ? `${s.title} back in To place` : `${s.title} on ${formatDate(day)}`);
    }, 210);
  };
  return (
    <BottomSheet onClose={onClose}>{(close) => (
      <div className="tr-move">
        <div className="tr-sheet-title t-title-medium">Move {s.title}</div>
        {days.map((d) => (
          <button key={d} className={`tr-move-day ${d === cur ? "on" : ""}`} onClick={() => move(d, close)}>
            <span className="d">{formatDate(d)}</span>
            <span className="what">{on(d).join(" · ") || "Rest"}</span>
          </button>
        ))}
        {cur !== null && <button className="tr-move-day" onClick={() => move(null, close)}><span className="d">To place</span><span className="what">No day yet</span></button>}
      </div>
    )}</BottomSheet>
  );
}

export function SessionView({ tr, lp, sessionId, readOnly, onClose, closeIcon, onMoved }: {
  tr: Training; lp: LoadedPlan; sessionId: string; readOnly: boolean; onClose: () => void; closeIcon?: boolean;
  onMoved?: (sid: string, day: number, undo: () => void) => boolean;
}) {
  const { plan } = lp;
  const t = todayEpoch();
  const s = sessionsOf(plan).find((x) => x.id === sessionId);
  const [moving, setMoving] = useState(false);
  const nav = closeIcon ? <IconButton icon="fClose" label="Close" onClick={onClose} /> : undefined;
  if (!s) {
    return <Scaffold title="Session" back={!closeIcon} actions={nav}><EmptyHint>This session isn't in the plan any more.</EmptyHint></Scaffold>;
  }
  const e = entryFor(plan, s, tr.entries);
  const day = dayOfSession(s, tr.entries.get(e.id));
  const ph = plan.phases[s.phase];
  const [short, long] = phaseNames(ph.name);
  const gym = s.exercises.length > 0;
  const status = (st: Entry["status"]) => {
    if (st === "done") feel("confirm");
    setSessionStatus(lp, s, st, t);
  };
  return (
    <Scaffold title={s.title} back={!closeIcon} flush actions={<>
      <IconButton icon="oMenuBook" label="Guides" onClick={() => { const f = guideDocOf(lp, s); go(f ? docRoute(f, null, plan.id) : `training?view=docs${planQ(plan.id)}`); }} />
      {nav}
    </>}>
      <div className="p-content tr-session">
        <div className="tr-shead">
          <div className="tr-kindline"><MIcon name={kindIcon(s.kind)} size={18} /><span>{KIND_LABEL[s.kind]} · {long ? `${short}, ${long}` : short}</span></div>
          {s.detail && <div className="tr-detail">{s.detail}</div>}
          <div className="tr-dayline">
            <span>{s.locked ? `${formatDate(day ?? s.defaultDay ?? ph.start)} · fixed` : day !== null ? formatDate(day) : "No day yet"}{s.optional ? " · optional" : ""}</span>
            {!readOnly && !s.locked && <TextButton onClick={() => setMoving(true)}>{day === null ? "Place" : "Move"}</TextButton>}
          </div>
          {s.extra.map((x, i) => <div key={i} className="tr-extra">{x}</div>)}
        </div>

        <div className="tr-status">
          {e.status === "planned" && !readOnly && <>
            <button className="p-filled-btn" onClick={() => status("done")}>Done</button>
            <OutlinedButton onClick={() => status("skipped")}>Skip</OutlinedButton>
          </>}
          {e.status === "done" && <><span className="tr-statustext done"><MIcon name="fCheck" size={18} />Done{e.doneDay !== null ? ` · ${formatDate(e.doneDay)}` : ""}</span>
            {!readOnly && <TextButton onClick={() => status("planned")}>Undo</TextButton>}</>}
          {e.status === "skipped" && <><span className="tr-statustext">Skipped</span>{!readOnly && <TextButton onClick={() => status("planned")}>Undo</TextButton>}</>}
        </div>

        {gym && <GymLog tr={tr} lp={lp} s={s} e={e} day={day} t={t} readOnly={readOnly} />}
        <HowItWent lp={lp} s={s} e={e} readOnly={readOnly} />
        {s.card && <CardSection lp={lp} card={s.card} openAtStart={!gym} />}
        <div className="p-endspace" />
      </div>
      {moving && <MoveSheet lp={lp} s={s} onMoved={onMoved} onClose={() => setMoving(false)} />}
    </Scaffold>
  );
}

/** Effort, pain and a note for the whole session. The note saves as it's written (after a pause) and on leaving. */
export function HowItWent({ lp, s, e, readOnly, compact }: { lp: LoadedPlan; s: Session; e: Entry; readOnly: boolean; compact?: boolean }) {
  const [note, setNote] = useState(e.note);
  const timer = useRef(0);
  const pending = useRef<string | null>(null);
  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current !== null) { patchEntry(lp, s, { note: pending.current }); pending.current = null; }
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const write = (v: string) => {
    setNote(v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 700);
  };
  return (
    <div className={`tr-howwent ${compact ? "compact" : ""}`}>
      {!compact && <SectionHeader>How it went</SectionHeader>}
      <Scale label="Effort" hint="1 very easy · 10 all-out" from={1} to={10} value={e.effort} disabled={readOnly} onPick={(v) => patchEntry(lp, s, { effort: v })} />
      <Scale label="Pain" hint="0 none · 10 worst" from={0} to={10} value={e.pain} disabled={readOnly} onPick={(v) => patchEntry(lp, s, { pain: v })} />
      <textarea className="tr-notefield" placeholder="Note (knee 2/10, felt heavy…)" value={note} readOnly={readOnly} rows={compact ? 1 : 2}
        onChange={(ev) => write(ev.target.value)} onBlur={flush} />
    </div>
  );
}

/** The session's card from the plan's documents, folded open or shut; a link opens the document there. */
function CardSection({ lp, card, openAtStart }: { lp: LoadedPlan; card: { doc: string; anchor: string }; openAtStart: boolean }) {
  const [open, setOpen] = useState(openAtStart);
  const md = lp.docs.get(card.doc);
  const section = useMemo(() => (md ? (card.anchor ? sectionAt(md, card.anchor) : md) : null), [md, card.anchor]);
  const follow = (file: string | null, anchor: string | null) => go(docRoute(file ?? card.doc, anchor, null));
  return <>
    <SectionHeader onClick={() => setOpen(!open)} expanded={open}>Card</SectionHeader>
    {open && (section
      ? <div className="tr-card"><MarkdownView md={section} onDocLink={follow} />
          <TextButton className="tr-cardlink" onClick={() => go(docRoute(card.doc, card.anchor || null, null))}>Open in the document</TextButton></div>
      : <div className="tr-hint">The card isn't on this device yet.</div>)}
  </>;
}

/** The document the session's exercises are explained in (the one most of their cards are in), else its own card's. */
function guideDocOf(lp: LoadedPlan, s: Session): string | null {
  const n = new Map<string, number>();
  for (const x of s.exercises) {
    const doc = lp.plan.exercises.find((e) => e.id === x.exercise)?.card?.doc;
    if (doc && lp.docs.has(doc)) n.set(doc, (n.get(doc) ?? 0) + 1);
  }
  const best = [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ?? (s.card && lp.docs.has(s.card.doc) ? s.card.doc : null);
}

const GROUPS: [string, string][] =[["warm-up", "Warm-up"], ["main", "Main"], ["filler", "Fillers"]];

/** A gym session's exercises: warm-up, main work and fillers; ticks or sets as the plan says. */
function GymLog({ tr, lp, s, e, day, t, readOnly }: { tr: Training; lp: LoadedPlan; s: Session; e: Entry; day: number | null; t: number; readOnly: boolean }) {
  const exs = useMemo(() => allExercises(tr), [tr]);
  // Sets count on the day they were done: the session's done day, its own day once passed, else today.
  const liftDay = e.status === "done" && e.doneDay !== null ? e.doneDay : day !== null && day <= t ? day : t;
  const groupOf = (x: SessionExercise) => (GROUPS.some(([g]) => g === x.group) ? x.group : "main");
  const tick = (planned: string, on: boolean) => {
    const cur = entryFor(lp.plan, s, training().entries);
    if (on) feel("tick");
    patchEntry(lp, s, { ticks: on ? [...new Set([...cur.ticks, planned])] : cur.ticks.filter((x) => x !== planned) });
  };
  return <>
    {GROUPS.map(([g, label]) => {
      const list = s.exercises.filter((x) => groupOf(x) === g);
      if (!list.length) return null;
      return (
        <div key={g} className="tr-group">
          <SectionHeader>{label}</SectionHeader>
          {list.map((x, k) => {
            const lift = tr.liftById.get(liftId(lp.plan.id, s.id, x.exercise));
            const doing = lift?.exercise ?? x.exercise;
            const ex = exs.get(doing);
            return ex?.log === "tick" || (!ex && g !== "main")
              ? <TickRow key={`${x.exercise}${k}`} name={ex?.name ?? doing} x={x} ticked={e.ticks.includes(x.exercise)} readOnly={readOnly} onTick={(on) => tick(x.exercise, on)} />
              : <SetsBlock key={`${x.exercise}${k}`} tr={tr} lp={lp} s={s} x={x} lift={lift} liftDay={liftDay} readOnly={readOnly} />;
          })}
        </div>
      );
    })}
  </>;
}

function TickRow({ name, x, ticked, readOnly, onTick }: { name: string; x: SessionExercise; ticked: boolean; readOnly: boolean; onTick: (on: boolean) => void }) {
  return (
    <label className={`tr-tick ${ticked ? "done" : ""}`}>
      <input type="checkbox" className="p-checkbox" checked={ticked} disabled={readOnly} onChange={(ev) => onTick(ev.target.checked)} />
      <span className="text">
        <span className="name">{name}</span>
        <span className="sub">{[setsText(x.sets, x.reps), x.note].filter(Boolean).join(" · ")}</span>
      </span>
    </label>
  );
}

/** One weighted (or bodyweight) exercise: the target, the sets, then RPE and pain once its sets are done. */
function SetsBlock({ tr, lp, s, x, lift, liftDay, readOnly }: {
  tr: Training; lp: LoadedPlan; s: Session; x: SessionExercise; lift: Lift | undefined; liftDay: number; readOnly: boolean;
}) {
  const { plan } = lp;
  const exs = useMemo(() => allExercises(tr), [tr]);
  const id = liftId(plan.id, s.id, x.exercise);
  const doing = lift?.exercise ?? x.exercise;
  const ex = exs.get(doing);
  const last = useMemo(() => lastLift(tr.lifts, doing, { day: liftDay, id }), [tr.lifts, doing, liftDay, id]);
  const sets = lift?.sets ?? prefillSets(x, last);
  const [editing, setEditing] = useState<{ k: number; what: "kg" | "reps" } | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [showPain, setShowPain] = useState(false);
  const [guide, setGuide] = useState(false);

  /** Writes the lift, made from what's shown when there isn't one yet. */
  const write = (patch: Partial<Lift>) => {
    const cur = training().liftById.get(id);
    const base: Lift = cur ?? {
      id, planId: plan.id, sessionId: s.id, planned: x.exercise, exercise: doing, day: liftDay, sets, rpe: null, pain: null, note: "",
      name: ex?.name ?? doing, target: targetLine(x), updatedAt: 0,
    };
    saveLift({ ...base, day: liftDay, ...patch });
  };
  const toggle = (k: number) => {
    if (readOnly) return;
    const done = !sets[k].done;
    feel(done ? "confirm" : "tick");
    write({ sets: sets.map((st, j) => (j === k ? { ...st, done } : st)) });
  };
  /** A changed weight carries on to the later sets not done yet that had the same one. */
  const setNumber = (k: number, what: "kg" | "reps", v: number | null) => {
    const old = sets[k][what];
    write({ sets: sets.map((st, j) => (j === k || (j > k && !st.done && st[what] === old) ? { ...st, [what]: v } : st)) });
  };
  const swapTo = (to: string) => {
    const prev = lastLift(training().lifts, to, { day: liftDay, id });
    const keep = lift?.sets.some((st) => st.done);
    write({ exercise: to, name: exs.get(to)?.name ?? to, sets: keep ? sets : prefillSets(to === x.exercise ? x : { ...x, targetKg: null }, prev) });
  };
  /** Takes the last set off, with Undo (one set always stays; any set can also go from its number's dialog). */
  const removeLast = () => {
    const before = sets;
    feel("tick");
    write({ sets: sets.slice(0, -1) });
    showSnackbar(`Set ${before.length} removed`, "Undo", () => write({ sets: before }));
  };
  const allDone = sets.length > 0 && sets.every((st) => st.done);
  const tracked = useMemo(() => new Set([...exs.values()].filter((e) => e.trackBests).map((e) => e.id)), [exs]);
  const bests = lift ? newBestsIn(lift, tr.lifts, tracked, plan.bestsSince) : [];
  const bodyweight = ex?.type === "bodyweight";

  return (
    <div className={`tr-ex ${allDone ? "done" : ""}`}>
      <div className="tr-ex-head">
        <button className="tr-ex-name" onClick={() => setGuide(true)}>{ex?.name ?? doing}</button>
        {x.swaps.length > 0 && !readOnly && (
          <div className="p-menu-anchor">
            <TextButton onClick={() => setSwapOpen(true)}><MIcon name="fSwapHoriz" size={18} />Swap</TextButton>
            <DropdownMenu open={swapOpen} onClose={() => setSwapOpen(false)} items={[
              { label: `${exs.get(x.exercise)?.name ?? x.exercise} (planned)`, checked: doing === x.exercise, onClick: () => swapTo(x.exercise) },
              ...x.swaps.map((w) => ({ label: `${exs.get(w.exercise)?.name ?? w.exercise}: ${w.when}`, checked: doing === w.exercise, onClick: () => swapTo(w.exercise) })),
            ]} />
          </div>
        )}
      </div>
      {doing !== x.exercise && <div className="tr-ex-sub">In place of {exs.get(x.exercise)?.name ?? x.exercise}</div>}
      <div className="tr-ex-target">{targetLine(x).replace("×", " × ")}</div>
      {(x.targetText || x.note) && <div className="tr-ex-sub">{[x.targetText, x.note].filter(Boolean).join(" ")}</div>}
      {bests.length > 0 && <div className="tr-newbest"><MIcon name="oEmojiEvents" size={14} />New best · {bests.at(-1) === 1 ? "1 rep" : `${bests.at(-1)} reps`}</div>}
      <div className="tr-sets">
        {sets.map((st, k) => (
          <div key={k} className={`tr-set ${st.done ? "done" : ""}`} role="button" aria-pressed={st.done} aria-label={`Set ${k + 1}`} onClick={() => toggle(k)}>
            <span className="n">{k + 1}</span>
            <button className="tr-num" disabled={readOnly} onClick={(ev) => { ev.stopPropagation(); setEditing({ k, what: "kg" }); }}>
              {st.kg !== null ? `${fmtKg(st.kg)} kg` : bodyweight ? "Body weight" : "– kg"}
            </button>
            <span className="x">×</span>
            <button className="tr-num" disabled={readOnly} onClick={(ev) => { ev.stopPropagation(); setEditing({ k, what: "reps" }); }}>{st.reps ?? "–"}</button>
            <span className="grow" />
            <span className="tr-check"><MIcon name="fCheck" size={20} /></span>
          </div>
        ))}
        {!readOnly && (
          <div className="tr-setbtns">
            <TextButton className="tr-addset" onClick={() => write({ sets: [...sets, { ...(sets[sets.length - 1] ?? { kg: null, reps: null }), done: false }] })}>+ Set</TextButton>
            {sets.length > 1 && <TextButton onClick={removeLast}>− Set</TextButton>}
          </div>
        )}
      </div>
      {(allDone || lift?.rpe != null) && <>
        <Scale label="How hard (RPE)" from={1} to={10} value={lift?.rpe ?? null} disabled={readOnly} onPick={(v) => write({ rpe: v })} />
        {showPain || lift?.pain != null
          ? <Scale label="Pain" hint="0 none · 10 worst" from={0} to={10} value={lift?.pain ?? null} disabled={readOnly} onPick={(v) => write({ pain: v })} />
          : !readOnly && <TextButton className="tr-addpain" onClick={() => setShowPain(true)}>Something hurt?</TextButton>}
      </>}
      {editing && (
        <NumberDialog what={editing.what} set={editing.k + 1} value={sets[editing.k]?.[editing.what] ?? null}
          canRemove={sets.length > 1} onClose={() => setEditing(null)}
          onSave={(v) => setNumber(editing.k, editing.what, v)}
          onRemove={() => write({ sets: sets.filter((_, j) => j !== editing.k) })} />
      )}
      {guide && <ExerciseSheet lp={lp} id={doing} name={ex?.name ?? doing} onClose={() => setGuide(false)} />}
    </div>
  );
}

/** How to do an exercise (its card from the guide), and a way to its history. */
export function ExerciseSheet({ lp, id, name, onClose }: { lp: LoadedPlan; id: string; name: string; onClose: () => void }) {
  const ex = lp.plan.exercises.find((e) => e.id === id);
  const md = ex?.card ? lp.docs.get(ex.card.doc) : undefined;
  const section = md && ex?.card ? (ex.card.anchor ? sectionAt(md, ex.card.anchor) : md) : null;
  return (
    <BottomSheet onClose={onClose} className="tr-exsheet">{(close) => (
      <div className="tr-exsheet-body">
        <div className="tr-sheet-title t-title-medium">{name}</div>
        {section ? <MarkdownView md={section} onDocLink={(f, a) => { close(); window.setTimeout(() => go(docRoute(f ?? ex!.card!.doc, a, null)), 210); }} />
          : <div className="tr-hint">No guide for this one.</div>}
        <div className="tr-sheet-actions">
          <TextButton onClick={() => { close(); window.setTimeout(() => go(`training?view=ex&x=${encodeURIComponent(id)}`), 210); }}>History</TextButton>
        </div>
      </div>
    )}</BottomSheet>
  );
}

/** A set's weight or reps: slid in steps (2.5 kg, 1 rep), − and +, or typed after a tap on the number. */
function NumberDialog({ what, set, value, canRemove, onSave, onRemove, onClose }: {
  what: "kg" | "reps"; set: number; value: number | null; canRemove: boolean;
  onSave: (v: number | null) => void; onRemove: () => void; onClose: () => void;
}) {
  const kg = what === "kg";
  const [num, setNum] = useState(value);
  const save = () => { onSave(num); onClose(); };
  return (
    <Dialog title={`Set ${set}: ${kg ? "weight" : "reps"}`} onClose={onClose} actions={<>
      {canRemove && <TextButton onClick={() => { onRemove(); onClose(); }}>Remove set</TextButton>}
      <span className="grow" />
      <TextButton onClick={onClose}>Cancel</TextButton>
      <TextButton onClick={save}>Save</TextButton>
    </>}>
      <SlideStepper value={num} onChange={setNum} step={kg ? 2.5 : 1} max={999} format={fmtKg} unit={kg ? "kg" : "reps"}
        decimal={kg} clearable buttons label={kg ? "Weight" : "Reps"} />
    </Dialog>
  );
}

