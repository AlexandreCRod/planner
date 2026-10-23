import { memo, useDeferredValue, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { epochOf, formatDate, formatDateShort, formatTime, toTimestamp, today as todayEpoch, weekday, ymd } from "../domain/dates.ts";
import { type Occurrence, type TaskEntry, occurrencesIn, tasksForDay, tasksOnDay, tickedDuring } from "../domain/schedule.ts";
import { carryOver } from "../store/prefs.ts";
import { type NoteLine, noteLines, preview } from "../domain/text.ts";
import { isRoutineItem, routineList, routineSeriesOf, routineStreak, routinesOnDay, withoutRoutines as skipRoutines } from "../domain/routines.ts";
import { type Snapshot, toggleCompletion, useSnapshot } from "../store/store.ts";
import { showStreaks } from "../store/routines.ts";
import { EventRow, Icon, TaskRow, go, openItem, showDoneOnToday, useCheckedHold, useNow } from "./common.tsx";
import { AppBarActions, IconButton, MIcon } from "./phone/chrome.tsx";
import { feel } from "./phone/haptics.ts";
import { useSwipePager } from "./phone/pager.ts";
import { openTodoTab } from "./phone/PhoneLists.tsx";
import { canHoldEvent, moveEvent, moveTask, setEventEnd } from "./phone/eventTime.ts";
import { HeldTime } from "./phone/TimeWheel.tsx";
import { BottomSheet } from "./phone/m3.tsx";
import { DayPickerSheet } from "./phone/pickers.tsx";
import { count } from "../domain/plural.ts";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const toInput = (e: number) => { const { y, m, d } = ymd(e); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };

/** Identifies a task row on Today: the task and the occurrence it ticks. */
const rowKey = (e: TaskEntry) => `${e.item.id}_${e.day}`;

// The day being looked at, kept while moving around the app; null follows the real today.
let viewed: number | null = null;
/** Turns the phone's Today to a day (set while it's shown; the Tomorrow glance's "+3 more" uses it). */
let showDayOnPhone: ((day: number) => void) | null = null;

/** On today's page, what's behind us: an event that has ended, a timed task ticked once its time came. */
const eventOver = (o: Occurrence, now: number) => o.timed && toTimestamp(o.endDay, o.endMin ?? o.startMin ?? 0) <= now;
const taskOver = (e: TaskEntry, now: number) => e.status === "DONE" && e.day !== null && e.item.startMin !== null && toTimestamp(e.day, e.item.startMin) <= now;

/** Tomorrow at a glance on the phone's Today: its first few items in time order, and how many more. */
const GLANCE_ROWS = 3;
interface GlanceRow { key: string; item: Occurrence["item"]; min: number | null; allDay: boolean }
function tomorrowGlance(s: Snapshot, day: number, today: number): GlanceRow[] {
  const events = occurrencesIn(s.items.filter((i) => i.type === "EVENT"), s.done, day, day)
    .filter((o) => o.day <= day && o.endDay >= day)
    .map((o): GlanceRow => ({ key: `e${o.item.id}`, item: o.item, min: o.timed && o.day === day ? o.startMin : null, allDay: !o.timed || o.day !== day }));
  const tasks = skipRoutines(tasksOnDay(s.items, s.done, day, today)).filter((e) => e.status !== "DONE")
    .map((e): GlanceRow => ({ key: `t${e.item.id}`, item: e.item, min: e.item.startMin, allDay: false }));
  // All-day events first, then by time, then untimed tasks.
  const rank = (g: GlanceRow) => (g.allDay ? -1 : g.min ?? 1e4);
  return [...events, ...tasks].sort((a, b) => rank(a) - rank(b) || a.item.title.localeCompare(b.item.title));
}
/** The day Today shows (the phone's + button adds to it). */
export const todayViewedDay = () => viewed ?? todayEpoch();
/** Back to the real today (a double tap on the phone's Today tab). */
export const resetToday = () => { viewed = null; };

type Hold = ReturnType<typeof useCheckedHold>;

export function TodayView({ phone }: { phone?: boolean }) {
  return phone ? <PhoneToday /> : <PcToday />;
}

function PcToday() {
  const s = useSnapshot();
  const now = useNow();
  const t = todayEpoch();
  const [view, setView] = useState<number | null>(viewed);
  const day = view ?? t;
  const isToday = day === t;
  const show = (d: number) => { viewed = d === t ? null : d; setView(viewed); };
  useEffect(() => { showDayOnPhone = show; return () => { showDayOnPhone = null; }; });
  const hold = useCheckedHold();

  // ← and → change the day when nothing is being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.altKey || e.ctrlKey || e.metaKey || el.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "ArrowLeft") show(day - 1);
      else if (e.key === "ArrowRight") show(day + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const word = day === t ? "Today" : day === t - 1 ? "Yesterday" : day === t + 1 ? "Tomorrow" : null;
  const weekdayName = WEEKDAYS[weekday(day) - 1];

  return (
    <div className="today-page" style={{ maxWidth: 820 }}>
      <div className="day-head">
        <button className="icon-btn" title="Previous day (←)" onClick={() => show(day - 1)}><Icon name="left" /></button>
        <label className="day-title" title="Pick a day">
          <span className="big">{word ?? weekdayName}</span>
          <span className="hint">{word ? `${weekdayName}, ` : ""}{formatDateShort(day)}</span>
          <input type="date" value={toInput(day)} onChange={(e) => {
            const [y, m, d] = e.target.value.split("-").map(Number);
            if (e.target.value) show(epochOf(y, m, d));
          }} onClick={(e) => { try { (e.target as HTMLInputElement).showPicker(); } catch { /* not supported */ } }} />
        </label>
        <button className="icon-btn" title="Next day (→)" onClick={() => show(day + 1)}><Icon name="right" /></button>
        {!isToday && <button className="btn small" onClick={() => show(t)}><Icon name="today" size={14} /> Back to today</button>}
      </div>

      <DaySections day={day} t={t} s={s} now={now} hold={hold} />
    </div>
  );
}

/** On the phone, the times of events and tasks can be held to change them (a drum opens on the digits). */
const eventTime = (o: Occurrence, which: "start" | "end") => {
  if (!canHoldEvent(o)) return null;
  return which === "start"
    ? <HeldTime min={o.startMin!} onChange={(t) => moveEvent(o, t)} />
    : <HeldTime min={o.endMin!} onChange={(t) => setEventEnd(o, t)} />;
};
const taskTime = (e: TaskEntry) => (e.item.startMin !== null && e.day !== null ? <HeldTime min={e.item.startMin} onChange={(t) => moveTask(e, t)} /> : null);

/** One day's tasks, schedule and note: the PC page's body, and each page of the phone's day pager. */
function DaySections({ day, t, s, now, hold, phone }: { day: number; t: number; s: Snapshot; now: number; hold: Hold; phone?: boolean }) {
  const isToday = day === t;
  // Routines: their own checklist, out of the task lists below, never overdue.
  const routines = routinesOnDay(s.items, s.done, day, t);
  // With routines but none on this day, the row still holds the button to list them all.
  const anyRoutine = s.items.some(isRoutineItem);
  const withoutRoutines = skipRoutines;
  let overdue: TaskEntry[] = [], dayTasks: TaskEntry[], anytime = 0;
  if (isToday) {
    const tasks = withoutRoutines(tasksForDay(s.items, s.done, t, carryOver()));
    overdue = tasks.filter((e) => e.status === "OVERDUE");
    dayTasks = tasks.filter((e) => e.status === "DUE" || e.status === "CARRIED" || e.status === "DONE");
    anytime = tasks.filter((e) => e.status === "ANYTIME").length;
  } else {
    // Tasks still overdue today carry on to the days ahead until they're ticked.
    if (day > t) overdue = withoutRoutines(tasksForDay(s.items, s.done, t, carryOver())).filter((e) => e.status === "OVERDUE" || e.status === "CARRIED");
    dayTasks = withoutRoutines(tasksOnDay(s.items, s.done, day, t));
  }
  const shownOverdue = hold.arrange(`o${day}`, overdue, rowKey);
  // "Show completed tasks on Today" off: ticked tasks leave today's list (after the hold).
  const hideDone = isToday && !showDoneOnToday();
  const shownTasks = hold.arrange(`t${day}`, hideDone ? dayTasks.filter((e) => e.status !== "DONE") : dayTasks, rowKey);
  // Ticked during this day but not listed above: overdue ones, undated ones, early ticks...
  const listed = new Set([...shownOverdue, ...shownTasks].map(rowKey));
  for (const r of routines) listed.add(rowKey(r));
  const alsoDone = hideDone ? [] : withoutRoutines(tickedDuring(s.items, s.completions, day)).filter((e, i, all) => !listed.has(rowKey(e)) && all.findIndex((x) => rowKey(x) === rowKey(e)) === i);
  const events = occurrencesIn(s.items.filter((i) => i.type === "EVENT"), s.done, day, day + 7);
  const dayEvents = events.filter((o) => o.day <= day && o.endDay >= day);
  const upcoming = isToday ? events.filter((o) => o.day > day).slice(0, 8) : [];
  const daily = s.items.find((i) => i.type === "NOTE" && i.noteDay === day);
  const doneCount = dayTasks.filter((e) => e.status === "DONE").length;
  const word = day === t ? "Today" : day === t - 1 ? "Yesterday" : day === t + 1 ? "Tomorrow" : null;
  const dayWord = word?.toLowerCase() ?? "that day";

  const rows = (list: TaskEntry[], listId: string, showDay: boolean) => list.map((e, index) => (
    <TaskRow key={`${listId}_${rowKey(e)}`} entry={e} s={s} now={now} showDay={showDay} heldTime={phone ? taskTime : undefined}
      past={phone && isToday && taskOver(e, now)} onToggle={(done) => hold.onToggle(listId, rowKey(e), e, index, done)} />
  ));
  // The phone keeps Today to about one screen: sections only when they have something, one line when
  // the day is empty, no week ahead; a glance at tomorrow instead.
  const nothing = shownOverdue.length === 0 && shownTasks.length === 0 && dayEvents.length === 0;
  const glance = phone && isToday ? tomorrowGlance(s, day + 1, t) : null;

  return <>
      {dayTasks.length > 0 && phone && <PhoneProgress done={doneCount} total={dayTasks.length} />}
      {phone && (routines.length > 0 || anyRoutine) && <RoutineChips list={routines} s={s} day={day} t={t} />}
      {!phone && (routines.length > 0 || anyRoutine) && <PcRoutineChips list={routines} s={s} day={day} t={t} />}
      {dayTasks.length > 0 && !phone && (
        <div className="row progress-row" style={{ margin: "4px 0 8px" }}>
          <div className="grow progress" style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
            <div style={{ width: `${(doneCount / dayTasks.length) * 100}%`, height: "100%", background: "var(--strong)", transition: "width .3s" }} />
          </div>
          <span className="hint">{doneCount} of {dayTasks.length} done</span>
        </div>
      )}
      {shownOverdue.length > 0 && <>
        <div className="section">Overdue</div>
        {rows(shownOverdue, `o${day}`, true)}
      </>}
      {phone && nothing && <div className="hint empty p-nothing">{isToday ? "Nothing planned today. Tap + to add something." : day < t ? `Nothing was planned ${dayWord}.` : `Nothing planned ${dayWord}.`}</div>}
      {(!phone || shownTasks.length > 0) && <div className="section">Tasks</div>}
      {!phone && shownTasks.length === 0 && <div className="hint empty">{isToday ? "No tasks due today. Use the bar at the top to add one." : `No tasks were due ${dayWord}.`}</div>}
      {rows(shownTasks, `t${day}`, false)}
      {anytime > 0 && (phone
        ? <button className="hint anytime p-anytime" onClick={openTodoTab}>{count(anytime, "task")} without a date — see Tasks</button>
        : <button className="hint anytime link-btn" style={{ marginTop: 6 }} onClick={openTodoTab}>{count(anytime, "task")} without a date — see Tasks</button>)}
      {alsoDone.length > 0 && <>
        <div className="section">{shownTasks.length || shownOverdue.length ? `Also done ${dayWord}` : `Done ${dayWord}`}</div>
        {alsoDone.map((e) => <TaskRow key={`d${rowKey(e)}`} entry={e} s={s} now={now} showDay={e.day !== day} />)}
      </>}
      {(!phone || dayEvents.length > 0) && <div className="section">Schedule</div>}
      {!phone && dayEvents.length === 0 && <div className="hint empty">{isToday ? "Nothing scheduled today." : `Nothing scheduled ${dayWord}.`}</div>}
      {dayEvents.map((o) => <EventRow key={`e${o.item.id}-${o.day}`} o={o} s={s} heldTime={phone ? eventTime : undefined} past={phone && isToday && eventOver(o, now)} />)}
      {glance && <TomorrowGlance rows={glance} s={s} day={day + 1} />}
      {phone ? <div className="p-note-gap" /> : <div className="section">{isToday ? "Today's note" : "Note"}</div>}
      <div className="card note-preview" onClick={() => go(daily ? `note/${daily.id}` : `note/new?day=${day}`)}>
        {phone && <MIcon name="oEditNote" />}
        {phone
          ? <PhoneNotePreview html={daily?.content ?? null} isToday={isToday} />
          : daily ? preview(daily.content, 200) || "Empty — click to write" : isToday ? "Start today's journal or notes" : "Write a note for this day"}
      </div>
      {!phone && upcoming.length > 0 && <>
        <div className="section">Next 7 days</div>
        {upcoming.map((o) => <EventRow key={`u${o.item.id}-${o.day}`} o={o} s={s} showDay heldTime={phone ? eventTime : undefined} />)}
      </>}
  </>;
}

/** Tomorrow's first few items (time, colour, title) and "+3 more", which turns the page to tomorrow. */
function TomorrowGlance({ rows, s, day }: { rows: GlanceRow[]; s: Snapshot; day: number }) {
  const more = rows.length - GLANCE_ROWS;
  const toTomorrow = () => showDayOnPhone?.(day);
  return <>
    <button className="section p-glance-head" onClick={toTomorrow}>Tomorrow</button>
    {rows.length === 0 && <div className="hint empty">Nothing planned yet.</div>}
    {rows.slice(0, GLANCE_ROWS).map((g) => (
      <button key={g.key} className="p-glance-row" onClick={() => openItem(g.item, day)}>
        <span className="p-glance-time">{g.allDay ? "All day" : g.min !== null ? formatTime(g.min) : ""}</span>
        <span className="p-glance-dot" style={{ background: s.colorOf(g.item) }} />
        <span className="p-glance-title">{g.item.title || "Untitled"}</span>
      </button>
    ))}
    {more > 0 && <button className="p-glance-more" onClick={toTomorrow}>+{more} more</button>}
  </>;
}

/**
 * Today's routines as one row of small chips under the progress bar: a ring (a tick once done) and the
 * name. A tap ticks it (the chip fades and is struck through), a long press opens the routine. The row
 * scrolls sideways when it doesn't fit (it wins over the day swipe then). A routine missed on an
 * earlier day isn't carried here; it only ends the streak.
 */
function RoutineChips({ list, s, day, t }: { list: TaskEntry[]; s: Snapshot; day: number; t: number }) {
  const streaks = showStreaks() && day >= t;
  const [all, setAll] = useState(false);
  return (
    <div className="p-rchips" role="list">
      {list.map((e) => {
        const ticked = e.status === "DONE";
        const st = streaks ? routineStreak(routineSeriesOf(e.item, s.byId), s.done, t) : null;
        return (
          <RoutineChip key={e.item.id} title={e.item.title || "Untitled"} ticked={ticked} missed={e.status === "MISSED"}
            streak={st && st.current > 1 ? st.current : 0}
            onToggle={() => { if (!ticked) feel("confirm"); toggleCompletion(e.item.id, day, !ticked); }} onOpen={() => openItem(e.item, e.day)} />
        );
      })}
      <button className="p-rchip p-rchip-all" aria-label="All routines" onClick={() => setAll(true)}>
        <MIcon name="fFormatListBulleted" size={18} />
      </button>
      {all && createPortal(<RoutineListSheet s={s} t={t} onClose={() => setAll(false)} />, document.body)}
    </div>
  );
}

/** Every routine in a sheet: name, how it repeats, today's state and its streak. A tap opens it. */
function RoutineListSheet({ s, t, onClose }: { s: Snapshot; t: number; onClose: () => void }) {
  const rows = routineList(s.items, s.done, t);
  const streaks = showStreaks();
  return (
    <BottomSheet onClose={onClose} className="p-rlist-sheet">{(close) => (
      <div className="p-rlist">
        <div className="p-rlist-head t-title-medium">Routines</div>
        {rows.length === 0 && <div className="p-rlist-empty muted">No routines yet</div>}
        <div className="p-rlist-rows">
          {rows.map((r) => (
            <button key={r.item.id} className={`p-rlist-row ${r.today}`} onClick={() => { close(); window.setTimeout(() => openItem(r.item, r.today === "off" ? r.next : t), 210); }}>
              <span className="ring">{r.today === "done" && <MIcon name="fCheck" size={14} />}</span>
              <span className="text">
                <span className="name">{r.item.title || "Untitled"}</span>
                <span className="sub">{[r.repeat, r.today === "done" ? "Done today" : r.today === "due" ? "Due today" : r.next !== null ? `Next ${formatDateShort(r.next)}` : "Not today"].join(" · ")}</span>
              </span>
              {streaks && r.streak.current > 0 && <span className="streak"><MIcon name="fLocalFireDepartment" size={14} />{r.streak.current}</span>}
            </button>
          ))}
        </div>
      </div>
    )}</BottomSheet>
  );
}

/**
 * The PC's routines row: the same chips, for a mouse. A click on the ring ticks it, a click on the name
 * opens it (like a task row's box and title); the last chip lists every routine.
 */
function PcRoutineChips({ list, s, day, t }: { list: TaskEntry[]; s: Snapshot; day: number; t: number }) {
  const streaks = showStreaks() && day >= t;
  const [all, setAll] = useState(false);
  return (
    <div className="rchips" role="list">
      {list.map((e) => {
        const ticked = e.status === "DONE";
        const st = streaks ? routineStreak(routineSeriesOf(e.item, s.byId), s.done, t) : null;
        const title = e.item.title || "Untitled";
        return (
          <span key={e.item.id} role="listitem" className={`rchip ${ticked ? "done" : ""} ${e.status === "MISSED" ? "missed" : ""}`}>
            <button className="ring" aria-pressed={ticked} title={ticked ? "Done — click to untick" : "Tick"}
              onClick={() => toggleCompletion(e.item.id, day, !ticked)}>{ticked && <Icon name="check" size={13} />}</button>
            <button className="name" title={`Open ${title}`} onClick={() => openItem(e.item, e.day)}>{title}</button>
            {st && st.current > 1 && <span className="streak" title={`${st.current} in a row`}><MIcon name="fLocalFireDepartment" size={12} />{st.current}</span>}
          </span>
        );
      })}
      <button className="rchip all" title="All routines" onClick={() => setAll(true)}><MIcon name="fFormatListBulleted" size={16} />{list.length === 0 && <span className="name">Routines</span>}</button>
      {all && createPortal(<PcRoutineList s={s} t={t} onClose={() => setAll(false)} />, document.body)}
    </div>
  );
}

/** Every routine in a small dialog (the phone's sheet): name, how it repeats, today, streak. A click opens it. */
function PcRoutineList({ s, t, onClose }: { s: Snapshot; t: number; onClose: () => void }) {
  const rows = routineList(s.items, s.done, t);
  const streaks = showStreaks();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="panel-backdrop center" onClick={onClose}>
      <div className="card dialog rlist" role="dialog" aria-label="Routines" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b className="grow" style={{ fontSize: 16 }}>Routines</b><button className="icon-btn" title="Close (Esc)" onClick={onClose}><Icon name="close" /></button></div>
        {rows.length === 0 && <div className="hint">No routines yet. Turn on Routine in a repeating task's editor.</div>}
        {rows.map((r) => (
          <button key={r.item.id} className={`rlist-row ${r.today}`} onClick={() => { onClose(); openItem(r.item, r.today === "off" ? r.next : t); }}>
            <span className="ring">{r.today === "done" && <Icon name="check" size={13} />}</span>
            <span className="grow">
              <span className="name ellipsis">{r.item.title || "Untitled"}</span>
              <span className="sub ellipsis">{[r.repeat, r.today === "done" ? "Done today" : r.today === "due" ? "Due today" : r.next !== null ? `Next ${formatDateShort(r.next)}` : "Not today"].join(" · ")}</span>
            </span>
            {streaks && r.streak.current > 0 && <span className="streak"><MIcon name="fLocalFireDepartment" size={14} />{r.streak.current}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

const CHIP_HOLD_MS = 450;
function RoutineChip({ title, ticked, missed, streak, onToggle, onOpen }: { title: string; ticked: boolean; missed: boolean; streak: number; onToggle: () => void; onOpen: () => void }) {
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const clear = () => { if (hold.current) clearTimeout(hold.current.timer); };
  return (
    <button role="listitem" className={`p-rchip ${ticked ? "done" : ""} ${missed ? "missed" : ""}`} aria-pressed={ticked}
      aria-label={`${title}${ticked ? ", done" : ""}. Hold to open`}
      onPointerDown={(e) => {
        clear();
        const h = { timer: 0, x: e.clientX, y: e.clientY, fired: false };
        h.timer = window.setTimeout(() => { h.fired = true; feel("pickup"); onOpen(); }, CHIP_HOLD_MS);
        hold.current = h;
      }}
      onPointerMove={(e) => { const h = hold.current; if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) { clear(); hold.current = null; } }}
      onPointerUp={clear} onPointerCancel={() => { clear(); hold.current = null; }}
      onClick={() => { const h = hold.current; hold.current = null; if (!h?.fired) onToggle(); }}>
      <span className="ring">{ticked && <MIcon name="fCheck" size={14} />}</span>
      <span className="name">{title}</span>
      {streak > 0 && <span className="streak"><MIcon name="fLocalFireDepartment" size={12} />{streak}</span>}
    </button>
  );
}

/** Lines shown of the day's note on Today; more ends in "…". */
const NOTE_PREVIEW_LINES = 4;

/** The start of the day's note with its shape kept (TodayScreen.kt's NotePreview): bullets, numbers, boxes. */
function PhoneNotePreview({ html, isToday }: { html: string | null; isToday: boolean }) {
  const lines: NoteLine[] = html ? noteLines(html) : [];
  if (!lines.length) {
    return <span className="note-text">{html !== null ? "Empty — tap to write" : isToday ? "Start today's journal or notes" : "Write a note for this day"}</span>;
  }
  return (
    <div className="note-lines">
      {lines.slice(0, NOTE_PREVIEW_LINES).map((l, i) => {
        const more = i === NOTE_PREVIEW_LINES - 1 && lines.length > NOTE_PREVIEW_LINES;
        const ticked = l.kind === "CHECK" && l.checked;
        return (
          <div key={i} className="note-line" style={{ paddingLeft: l.level * 14 }}>
            {l.kind === "BULLET" && <span className="mark b">•</span>}
            {l.kind === "NUMBER" && <span className="mark n">{l.number}.</span>}
            {l.kind === "CHECK" && <span className="mark c"><MIcon name={l.checked ? "oCheckBox" : "oCheckBoxOutlineBlank"} size={16} /></span>}
            <span className={`txt ${ticked ? "ticked" : ""}`}>{l.text}{more ? " …" : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Material 3's linear progress indicator as the native Today draws it: 4 dp, a 4 dp gap, a stop dot. */
function PhoneProgress({ done, total }: { done: number; total: number }) {
  const f = total ? done / total : 0;
  return (
    <div className="p-progress-row">
      <div className="p-progress">
        {f > 0 && <span className="active" style={{ width: `${f * 100}%` }} />}
        {f < 1 && <span className="track" style={{ marginLeft: f > 0 ? 4 : 0 }}><span className="stop" /></span>}
      </div>
      <span className="p-progress-label">{done} of {total} done</span>
    </div>
  );
}

/** One page of the phone's day pager: its own scrolling list. Memoised, so turning days redraws only the newcomer. */
const DayPage = memo(function DayPage({ day, t, s, now, hold }: { day: number; t: number; s: Snapshot; now: number; hold: Hold }) {
  return (
    <div className="today-page">
      <DaySections day={day} t={t} s={s} now={now} hold={hold} phone />
      <div style={{ height: 88 }} />
    </div>
  );
});

/**
 * Today on the phone, laid out like the native TodayScreen in HomeScreen's top app bar: the day switcher
 * (arrows and a two-line title that opens a date picker) as the bar's title, search and settings as its
 * actions. Below, the days sit side by side like a ViewPager: a sideways drag moves them with the
 * finger, the day before or after sliding in beside it, and letting go settles on a day.
 */
function PhoneToday() {
  const s = useSnapshot();
  const now = useNow();
  const t = todayEpoch();
  const [view, setView] = useState<number | null>(viewed);
  const day = view ?? t;
  const dayRef = useRef(day);
  dayRef.current = day;
  const isToday = day === t;
  const show = (d: number) => { viewed = d === t ? null : d; setView(viewed); };
  const hold = useCheckedHold();
  const word = day === t ? "Today" : day === t - 1 ? "Yesterday" : day === t + 1 ? "Tomorrow" : null;
  // The neighbours are drawn a moment after the day changes, so turning a day (by swipe or arrow)
  // only has to move pages that are already there; the new neighbour follows in the background.
  const [picking, setPicking] = useState(false);
  const near = useDeferredValue(day);
  const days = [...new Set([near - 1, near, near + 1, day])].sort((a, b) => a - b);
  const track = useRef<HTMLDivElement>(null);
  const pager = useSwipePager<HTMLDivElement>({
    layers: () => [track.current],
    onStep: (dir) => show(dayRef.current + dir),
    // The routines row scrolls sideways itself when it overflows; there it wins over the day swipe.
    allow: (el) => { const row = el.closest<HTMLElement>(".p-rchips"); return !row || row.scrollWidth <= row.clientWidth + 1; },
  });

  return (
    <div className="p-scaffold">
      <header className="p-appbar tall">
        <div className="p-dayrow">
          <IconButton className="title-icon" icon="fKeyboardArrowLeft" label="Previous day" onClick={() => show(day - 1)} />
          <button className="p-dayswitch" aria-label="Go to a day" onClick={() => setPicking(true)}>
            <span className="big">{word ?? WEEKDAYS[weekday(day) - 1]}</span>
            <span className="small">{word ? formatDate(day) : formatDateShort(day)}</span>
          </button>
          <IconButton className="title-icon" icon="fKeyboardArrowRight" label="Next day" onClick={() => show(day + 1)} />
        </div>
        <span className="grow" />
        {!isToday && <IconButton icon="oToday" label="Back to today" onClick={() => show(t)} />}
        <AppBarActions />
      </header>
      {/* On the page root, so it covers the + button like the other sheets. */}
      {picking && createPortal(<DayPickerSheet value={day} onPick={show} onClose={() => setPicking(false)} />, document.body)}
      <div className="p-daypager" ref={pager}>
        <div className="p-daytrack" ref={track}>
          {days.map((d) => (
            <div key={d} className="p-content today-list p-daypage" style={{ left: `${(d - day) * 100}%` }} aria-hidden={d !== day}>
              <DayPage day={d} t={t} s={s} now={now} hold={hold} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
