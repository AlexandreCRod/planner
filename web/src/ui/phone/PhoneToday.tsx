// Today: the day pager, each day's tasks, schedule and note, and the routines row.
import { memo, useDeferredValue, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDate, formatDateShort, formatTime, today as todayEpoch, weekday, ymd } from "../../domain/dates.ts";
import { type Occurrence, type TaskEntry, completionDay, occurrencesIn, tasksForDay, tasksOnDay, tickedDuring } from "../../domain/schedule.ts";
import { type GlanceRow, dayGlance, eventOver, foldDone, foldEvents, taskOver, weekAhead } from "../../domain/todayPlan.ts";
import { carryOver } from "../../store/prefs.ts";
import { type NoteLine, noteLines } from "../../domain/text.ts";
import { isRoutineItem, routineList, routineSeriesOf, routineStreak, routinesOnDay, withoutRoutines as skipRoutines } from "../../domain/routines.ts";
import { type Snapshot, toggleCompletion, useSnapshot } from "../../store/store.ts";
import { useWide } from "../../platform.ts";
import { showStreaks, streakSymbol } from "../../store/routines.ts";
import { EventRow, TaskRow, go, openItem, showDoneOnToday, useCheckedHold, useNow } from "../shared/common.tsx";
import { AppBarActions, IconButton, MIcon } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { useSwipePager } from "./pager.ts";
import { mouseMenu } from "./desk.ts";
import { openTodoTab } from "./PhoneLists.tsx";
import { canHoldEvent, canPostpone, moveEvent, moveTask, postponeTask, setEventEnd } from "./eventTime.ts";
import { HeldTime } from "./TimeWheel.tsx";
import { BottomSheet } from "./m3.tsx";
import { DayPickerSheet } from "./pickers.tsx";
import { count } from "../../domain/plural.ts";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Identifies a task row on Today: the task and the occurrence it ticks. */
const rowKey = (e: TaskEntry) => `${e.item.id}_${e.day}`;

// The day being looked at, kept while moving around the app; null follows the real today.
let viewed: number | null = null;
/** Turns the phone's Today to a day (set while it's shown; the Tomorrow glance's "+3 more" uses it). */
let showDayOnPhone: ((day: number) => void) | null = null;

/** Tomorrow at a glance on the phone's Today: its first few items in time order, and how many more. */
const GLANCE_ROWS = 3;
/** Items named in each box of the wide Today's Next 7 days. */
const WEEK_ROWS = 3;
/** The day Today shows (the phone's + button adds to it). */
export const todayViewedDay = () => viewed ?? todayEpoch();
/** Back to the real today (a tap on the Today tab while it shows). */
export const resetToday = () => { viewed = null; };
/** Turns Today to [day] (the T key), at once, like its own "Back to today" button. */
export function showTodayDay(day: number) {
  if (showDayOnPhone) showDayOnPhone(day);
  else viewed = day === todayEpoch() ? null : day;
}

type Hold = ReturnType<typeof useCheckedHold>;

/** On the phone, the times of events and tasks can be held to change them (a drum opens on the digits). */
const eventTime = (o: Occurrence, which: "start" | "end") => {
  if (!canHoldEvent(o)) return null;
  return which === "start"
    ? <HeldTime min={o.startMin!} onChange={(t) => moveEvent(o, t)} />
    : <HeldTime min={o.endMin!} onChange={(t) => setEventEnd(o, t)} />;
};
const taskTime = (e: TaskEntry) => (e.item.startMin !== null && e.day !== null ? <HeldTime min={e.item.startMin} onChange={(t) => moveTask(e, t)} /> : null);

/** One day's tasks, schedule and note: each page of the day pager. In a wide window, in two columns. */
function DaySections({ day, t, s, now, hold, wide }: { day: number; t: number; s: Snapshot; now: number; hold: Hold; wide: boolean }) {
  const isToday = day === t;
  // On the phone, today's ticked tasks and the events already over fold into one line each; a tap shows them.
  const [doneOpen, setDoneOpen] = useState(false);
  const [earlierOpen, setEarlierOpen] = useState(false);
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
  // "Show completed tasks on Today" off: ticked tasks leave today's list (after the hold). On, the phone
  // folds them into one line under the tasks; the wide window has room to leave them in place.
  const hideDone = isToday && !showDoneOnToday();
  const fold = isToday && !wide;
  const shownTasks = hold.arrange(`t${day}`, hideDone || fold ? dayTasks.filter((e) => e.status !== "DONE") : dayTasks, rowKey);
  // Ticked during this day but not listed above: overdue ones, undated ones, early ticks...
  const listed = new Set([...shownOverdue, ...shownTasks].map(rowKey));
  for (const r of routines) listed.add(rowKey(r));
  const alsoDone = hideDone ? [] : withoutRoutines(tickedDuring(s.items, s.completions, day)).filter((e, i, all) => !listed.has(rowKey(e)) && all.findIndex((x) => rowKey(x) === rowKey(e)) === i);
  const doneFold = fold && !hideDone ? foldDone(dayTasks, alsoDone, listed, rowKey) : [];
  const events = occurrencesIn(s.items.filter((i) => i.type === "EVENT"), s.done, day, day + 7);
  const dayEvents = events.filter((o) => o.day <= day && o.endDay >= day);
  const { earlier, rest: laterEvents } = fold ? foldEvents(dayEvents, now) : { earlier: [], rest: dayEvents };
  const daily = s.items.find((i) => i.type === "NOTE" && i.noteDay === day);
  const doneCount = dayTasks.filter((e) => e.status === "DONE").length;
  const word = day === t ? "Today" : day === t - 1 ? "Yesterday" : day === t + 1 ? "Tomorrow" : null;
  const dayWord = word?.toLowerCase() ?? "that day";

  /** Wide: hovering a task shows Done, Move to the next day and Open over the end of its row. */
  const quick = (e: TaskEntry, listId: string, index: number) => (wide && e.status !== "DONE" ? <>
    <button className="p-icon" aria-label="Done" title="Done" onClick={() => {
      feel("confirm"); hold.onToggle(listId, rowKey(e), e, index, true); toggleCompletion(e.item.id, completionDay(e), true);
    }}><MIcon name="fCheck" size={20} /></button>
    {canPostpone(e) && <button className="p-icon" aria-label="Move to the next day" title="Move to the next day" onClick={() => postponeTask(e, t)}><MIcon name="fArrowForward" size={20} /></button>}
    <button className="p-icon" aria-label="Open" title="Open" onClick={() => openItem(e.item, e.day)}><MIcon name="oOpenInNew" size={20} /></button>
  </> : undefined);
  const rows = (list: TaskEntry[], listId: string, showDay: boolean) => list.map((e, index) => (
    <TaskRow key={`${listId}_${rowKey(e)}`} entry={e} s={s} now={now} showDay={showDay} heldTime={taskTime}
      past={isToday && taskOver(e, now)} onToggle={(done) => hold.onToggle(listId, rowKey(e), e, index, done)} actions={quick(e, listId, index)} />
  ));
  const eventRow = (o: Occurrence) => <EventRow key={`e${o.item.id}-${o.day}`} o={o} s={s} heldTime={eventTime} past={isToday && eventOver(o, now)} />;
  // The phone keeps Today to about one screen: sections only when they have something, one line when
  // the day is empty, a folded line for what's behind us, no week ahead; a glance at tomorrow instead.
  const nothing = shownOverdue.length === 0 && dayTasks.length === 0 && dayEvents.length === 0 && doneFold.length === 0 && alsoDone.length === 0;
  const nothingText = isToday ? "Nothing planned today. Tap + to add something." : day < t ? `Nothing was planned ${dayWord}.` : `Nothing planned ${dayWord}.`;
  // Every task ticked and the setting hides them: say so, rather than "nothing planned".
  const allHidden = shownTasks.length === 0 && doneFold.length === 0 && dayTasks.length > 0;

  const top = <>
    {dayTasks.length > 0 && <PhoneProgress done={doneCount} total={dayTasks.length} />}
    {(routines.length > 0 || anyRoutine) && <RoutineChips list={routines} s={s} day={day} t={t} />}
    {nothing && <div className="hint empty p-nothing">{nothingText}</div>}
  </>;
  const tasks = <>
    {shownOverdue.length > 0 && <>
      <div className="section">Overdue</div>
      {rows(shownOverdue, `o${day}`, true)}
    </>}
    {(shownTasks.length > 0 || doneFold.length > 0 || allHidden || (wide && !nothing)) && <div className="section">Tasks</div>}
    {rows(shownTasks, `t${day}`, false)}
    {allHidden && <div className="hint empty">All done {dayWord}.</div>}
    {wide && !nothing && dayTasks.length === 0 && <div className="hint empty">No tasks {dayWord}.</div>}
    {doneFold.length > 0 && <>
      <FoldLine open={doneOpen} onToggle={() => setDoneOpen(!doneOpen)} text={`${doneFold.length} done`} />
      {doneOpen && doneFold.map((e) => <TaskRow key={`d${rowKey(e)}`} entry={e} s={s} now={now} showDay={e.day !== day} />)}
    </>}
    {anytime > 0 && <button className="hint anytime p-anytime" onClick={openTodoTab}>{count(anytime, "task")} without a date — see Tasks</button>}
    {!fold && alsoDone.length > 0 && <>
      <div className="section">{shownTasks.length || shownOverdue.length ? `Also done ${dayWord}` : `Done ${dayWord}`}</div>
      {alsoDone.map((e) => <TaskRow key={`d${rowKey(e)}`} entry={e} s={s} now={now} showDay={e.day !== day} />)}
    </>}
  </>;
  const schedule = <>
    {(dayEvents.length > 0 || (wide && !nothing)) && <div className="section">Schedule</div>}
    {wide && !nothing && dayEvents.length === 0 && <div className="hint empty">No events {dayWord}.</div>}
    {earlier.length > 0 && <>
      <FoldLine open={earlierOpen} onToggle={() => setEarlierOpen(!earlierOpen)} text={`${earlier.length} earlier`} />
      {earlierOpen && earlier.map(eventRow)}
    </>}
    {laterEvents.map(eventRow)}
  </>;
  const note = <>
    <div className="p-note-gap" />
    <div className="card note-preview" onClick={() => go(daily ? `note/${daily.id}` : `note/new?day=${day}`)}>
      <MIcon name="oEditNote" />
      <PhoneNotePreview html={daily?.content ?? null} isToday={isToday} />
    </div>
  </>;

  if (wide) {
    return <>
      {top}
      <div className="p-today-cols">
        <div className="p-today-col">{tasks}</div>
        <div className="p-today-col">
          {schedule}
          <WeekAhead s={s} day={day} t={t} />
          {note}
        </div>
      </div>
    </>;
  }
  const glance = isToday ? dayGlance(s.items, s.done, day + 1, t) : null;
  return <>
    {top}
    {tasks}
    {schedule}
    {glance && <TomorrowGlance rows={glance} s={s} day={day + 1} />}
    {note}
  </>;
}

/** One line standing for what's folded away ("2 done · hidden"); a tap shows them, another hides them. */
function FoldLine({ open, onToggle, text }: { open: boolean; onToggle: () => void; text: string }) {
  return (
    <button className="p-fold" aria-expanded={open} onClick={onToggle}>
      <span>{text} · {open ? "shown" : "hidden"}</span>
      <MIcon name={open ? "fExpandLess" : "fExpandMore"} size={18} />
    </button>
  );
}

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The wide Today's Next 7 days: a box per day (weekday, date, its first items or how many); a click turns there. */
function WeekAhead({ s, day, t }: { s: Snapshot; day: number; t: number }) {
  const week = weekAhead(s.items, s.done, day, t);
  return <>
    <div className="section">Next 7 days</div>
    <div className="p-week">
      {week.map(({ day: d, rows }) => (
        <button key={d} className={`p-weekday ${d === t ? "today" : ""}`} onClick={() => showDayOnPhone?.(d)}
          aria-label={`${formatDate(d)}: ${rows.length ? count(rows.length, "item") : "nothing planned"}`}>
          <span className="p-weekday-head"><span className="wd">{SHORT_DAYS[weekday(d) - 1]}</span><span className="num">{ymd(d).d}</span></span>
          {rows.length === 0 && <span className="p-weekday-free">Free</span>}
          {rows.slice(0, WEEK_ROWS).map((g) => (
            <span key={g.key} className="p-weekday-row">
              <span className="p-glance-dot" style={{ background: s.colorOf(g.item) }} />
              <span className="p-weekday-title">{g.min !== null && !g.allDay ? `${formatTime(g.min)} ` : ""}{g.item.title || "Untitled"}</span>
            </span>
          ))}
          {rows.length > WEEK_ROWS && <span className="p-weekday-more">+{rows.length - WEEK_ROWS} more</span>}
        </button>
      ))}
    </div>
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
        <span className="p-glance-bar" style={{ background: s.colorOf(g.item) }} />
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
              {streaks && r.streak.current > 0 && <span className="streak">{streakSymbol() ? <MIcon name="fLocalFireDepartment" size={14} /> : null}{r.streak.current}{streakSymbol() ? "" : " in a row"}</span>}
            </button>
          ))}
        </div>
      </div>
    )}</BottomSheet>
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
      onContextMenu={(e) => { e.preventDefault(); if (mouseMenu(e)) { clear(); hold.current = null; onOpen(); } }}
      onClick={() => { const h = hold.current; hold.current = null; if (!h?.fired) onToggle(); }}>
      <span className="ring">{ticked && <MIcon name="fCheck" size={14} />}</span>
      <span className="name">{title}</span>
      {streak > 0 && <span className="streak">{streakSymbol() && <MIcon name="fLocalFireDepartment" size={12} />}{streak}{!streakSymbol() && "×"}</span>}
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
const DayPage = memo(function DayPage({ day, t, s, now, hold, wide }: { day: number; t: number; s: Snapshot; now: number; hold: Hold; wide: boolean }) {
  return (
    <div className="today-page">
      <DaySections day={day} t={t} s={s} now={now} hold={hold} wide={wide} />
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
export function PhoneToday() {
  const s = useSnapshot();
  const now = useNow();
  const t = todayEpoch();
  const [view, setView] = useState<number | null>(viewed);
  const day = view ?? t;
  const dayRef = useRef(day);
  dayRef.current = day;
  const isToday = day === t;
  const show = (d: number) => { viewed = d === t ? null : d; setView(viewed); };
  useEffect(() => { showDayOnPhone = show; return () => { showDayOnPhone = null; }; });
  const hold = useCheckedHold();
  const wide = useWide();
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
              <DayPage day={d} t={t} s={s} now={now} hold={hold} wide={wide} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
