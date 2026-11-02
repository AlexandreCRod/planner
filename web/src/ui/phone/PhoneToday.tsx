// Today: the day pager, each day's tasks, schedule and note, and the routines row.
import { memo, useDeferredValue, useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { dayShort, formatDate, formatDateShort, formatTime, today as todayEpoch, weekday, ymd } from "../../domain/dates.ts";
import { type Occurrence, type TaskEntry, completionDay, occurrencesIn, tasksForDay, tasksOnDay, tickedDuring } from "../../domain/schedule.ts";
import { type GlanceRow, dayGlance, eventOver, foldDone, foldEvents, overdueCount, taskOver, tasksProgressText, weekAhead } from "../../domain/todayPlan.ts";
import { carryOver } from "../../store/prefs.ts";
import { type NoteLine, noteLines } from "../../domain/text.ts";
import { isRoutineItem, routineList, routineProgress, routineSeriesOf, routineStreak, routinesOnDay, withoutRoutines as skipRoutines } from "../../domain/routines.ts";
import { type Snapshot, toggleCompletion, useSnapshot } from "../../store/store.ts";
import { useWide } from "../../platform.ts";
import { todoNumber } from "../../domain/todoNumber.ts";
import { PRIORITIES, priorityColor } from "../../domain/types.ts";
import { clearTodoNumber, showTodoNumber, todosCleared } from "../../store/todoNumber.ts";
import { useHold } from "./hold.ts";
import { showStreaks, streakSymbol } from "../../store/routines.ts";
import { EventRow, TaskRow, go, openItem, useCheckedHold, useNow } from "../shared/common.tsx";
import { AppBarActions, DoneFold, DropdownMenu, FoldLine, IconButton, MIcon, type MenuItem, TestChip } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { swipeTabs, turnerSwipe, turners, useSwipePager } from "./pager.ts";
import { useHorizontalSwipe } from "./gesture.ts";
import { mouseMenu } from "./desk.ts";
import { TodosSheet, openTodos } from "./PhoneLists.tsx";
import { sheetBack } from "./todoSheetReturn.ts";
import { StreaksSheet } from "./StreaksSheet.tsx";
import { useLook } from "./looks.ts";
import { canHoldEvent, canPostpone, moveEvent, moveTask, postponeTask, setEventEnd } from "./eventTime.ts";
import { HeldTime } from "./TimeWheel.tsx";
import { BottomSheet, showSnackbar } from "./m3.tsx";
import { DayPickerSheet } from "./pickers.tsx";
import { count } from "../../domain/plural.ts";
import { TrainingLine } from "./PhoneTraining.tsx";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Identifies a task row on Today: the task and the occurrence it ticks. */
const rowKey = (e: TaskEntry) => `${e.item.id}_${e.day}`;

// The day being looked at, kept while moving around the app; null follows the real today.
let viewed: number | null = null;
/** Turns the phone's Today to a day (set while it's shown; the Tomorrow glance's "3 more" uses it). */
let showDayOnPhone: ((day: number) => void) | null = null;

/** Tomorrow at a glance on the phone's Today: its first few items in time order, and how many more. */
const GLANCE_ROWS = 3;
/** Items named in each box of the wide Today's Next 7 days. */
const WEEK_ROWS = 3;
/** The day Today shows (the phone's + button adds to it). */
export const todayViewedDay = () => viewed ?? todayEpoch();
/** Back to the real today (a tap on the Today tab while it shows). */
export const resetToday = () => { viewed = null; };
/** Turns Today to [day] (the T key), at once, like its own Today button. */
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
  // The events already over fold into one line on the phone; a tap shows them.
  const [earlierOpen, setEarlierOpen] = useState(false);
  // Routines: their own checklist, out of the task lists below, never overdue.
  const routines = routinesOnDay(s.items, s.done, day, t);
  // With routines but none on this day, the row still holds the button to list them all.
  const anyRoutine = s.items.some(isRoutineItem);
  const withoutRoutines = skipRoutines;
  let overdue: TaskEntry[] = [], dayTasks: TaskEntry[];
  // The days ahead don't repeat the overdue list (281): one line says how many wait on today.
  const overdueOnToday = day > t ? overdueCount(s.items, s.done, t, carryOver()) : 0;
  if (isToday) {
    const tasks = withoutRoutines(tasksForDay(s.items, s.done, t, carryOver()));
    overdue = tasks.filter((e) => e.status === "OVERDUE");
    dayTasks = tasks.filter((e) => e.status === "DUE" || e.status === "CARRIED" || e.status === "DONE");
  } else {
    dayTasks = withoutRoutines(tasksOnDay(s.items, s.done, day, t));
  }
  const shownOverdue = hold.arrange(`o${day}`, overdue, rowKey);
  // Ticked tasks fold into one line at the end of the tasks ("2 done ⌄", 284), once they've stayed where
  // they were for the time Settings says.
  const shownTasks = hold.arrange(`t${day}`, dayTasks.filter((e) => e.status !== "DONE"), rowKey);
  // Ticked during this day but not listed above: overdue ones, undated ones, early ticks...
  const listed = new Set([...shownOverdue, ...shownTasks].map(rowKey));
  for (const r of routines) listed.add(rowKey(r));
  const alsoDone = withoutRoutines(tickedDuring(s.items, s.completions, day)).filter((e, i, all) => !listed.has(rowKey(e)) && all.findIndex((x) => rowKey(x) === rowKey(e)) === i);
  const doneFold = foldDone(dayTasks, alsoDone, listed, rowKey);
  const events = occurrencesIn(s.items.filter((i) => i.type === "EVENT"), s.done, day, day + 7);
  const dayEvents = events.filter((o) => o.day <= day && o.endDay >= day);
  // On the phone, today's events already over fold too ("2 earlier ⌄"); the wide window has room for them.
  const { earlier, rest: laterEvents } = isToday && !wide ? foldEvents(dayEvents, now) : { earlier: [], rest: dayEvents };
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
  const rows = (list: TaskEntry[], listId: string, showDay: boolean, underOverdue = false) => list.map((e, index) => (
    <TaskRow key={`${listId}_${rowKey(e)}`} entry={e} s={s} now={now} showDay={showDay} underOverdue={underOverdue} heldTime={taskTime}
      past={isToday && taskOver(e, now)} onToggle={(done) => hold.onToggle(listId, rowKey(e), e, index, done)} actions={quick(e, listId, index)} />
  ));
  const eventRow = (o: Occurrence) => <EventRow key={`e${o.item.id}-${o.day}`} o={o} s={s} heldTime={eventTime} past={isToday && eventOver(o, now)} />;
  // The phone keeps Today to about one screen: sections only when they have something, one line when
  // the day is empty, a folded line for what's behind us, no week ahead; a glance at tomorrow instead.
  const nothing = shownOverdue.length === 0 && dayTasks.length === 0 && dayEvents.length === 0 && doneFold.length === 0;
  const nothingText = isToday ? "Nothing planned today. Tap + to add something." : day < t ? `Nothing was planned ${dayWord}.` : `Nothing planned ${dayWord}.`;

  const top = <>
    {(routines.length > 0 || anyRoutine) && <RoutinesLine list={routines} s={s} day={day} t={t} />}
    <TrainingLine day={day} t={t} />
    {nothing && <div className="hint empty p-nothing">{nothingText}</div>}
  </>;
  const tasks = <>
    {overdueOnToday > 0 && (
      <button className="p-fold" onClick={() => showDayOnPhone?.(t)}>
        <span>{overdueOnToday} overdue · on today</span>
        <MIcon name="fKeyboardArrowRight" size={18} />
      </button>
    )}
    {shownOverdue.length > 0 && <>
      <div className="section">Overdue</div>
      {rows(shownOverdue, `o${day}`, true, true)}
    </>}
    {(shownTasks.length > 0 || doneFold.length > 0 || (wide && !nothing)) && <TasksHead done={doneCount} total={dayTasks.length} />}
    {rows(shownTasks, `t${day}`, false)}
    {wide && !nothing && dayTasks.length === 0 && doneFold.length === 0 && <div className="hint empty">No tasks {dayWord}.</div>}
    <DoneFold count={doneFold.length} rows={() => doneFold.map((e) => <TaskRow key={`d${rowKey(e)}`} entry={e} s={s} now={now} showDay={e.day !== day} />)} />
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
          {rows.length > WEEK_ROWS && <span className="p-weekday-more">{rows.length - WEEK_ROWS} more</span>}
        </button>
      ))}
    </div>
  </>;
}

/** Tomorrow's first few items (time, colour, title) and "3 more", which turns the page to tomorrow. */
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
    {more > 0 && <button className="p-glance-more" onClick={toTomorrow}>{more} more</button>}
  </>;
}

/**
 * Today's routines on their own line (225): "Routines 1/3", then a row of small chips: a ring (a tick once
 * done) and the name. A tap on a chip ticks it (the chip fades and is struck through), a long press opens
 * the routine. The row scrolls sideways when it doesn't fit (it wins over the day swipe then) and fades at
 * its end. "Routines 1/3" and the list button at the end open the list of every routine. A routine missed
 * on an earlier day isn't carried here; it only ends the streak.
 */
function RoutinesLine({ list, s, day, t }: { list: TaskEntry[]; s: Snapshot; day: number; t: number }) {
  const streaks = showStreaks() && day >= t;
  const [all, setAll] = useState(false);
  const { done, total } = routineProgress(list);
  return (
    <div className="p-routines">
      <button className="p-routines-head" aria-label={total ? `Routines, ${done} of ${total} done. All routines` : "All routines"} onClick={() => setAll(true)}>
        Routines{total > 0 && <span className="n">{done}/{total}</span>}
      </button>
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
      </div>
      <RoutineSheets s={s} t={t} open={all} onClose={() => setAll(false)} />
    </div>
  );
}

/**
 * The list of every routine, and Streaks from it: opened by "Routines 1/3" on Today and in the calendar.
 * Kept in place while [open] is off, so Streaks can open as the list closes.
 */
function RoutineSheets({ s, t, open, onClose }: { s: Snapshot; t: number; open: boolean; onClose: () => void }) {
  const [streaksOpen, setStreaksOpen] = useState(false);
  return <>
    {open && createPortal(<RoutineListSheet s={s} t={t} onClose={onClose} onStreaks={() => setStreaksOpen(true)} />, document.body)}
    {streaksOpen && <StreaksSheet onClose={() => setStreaksOpen(false)} />}
  </>;
}

/**
 * The calendar's line for a day's routines (224), under Month's grid and at the top of the Day view, where
 * routines are left out (only those set to "Show in calendar" are blocks in the Day view): "Routines 1/3 ›",
 * as on Today; a tap opens the list of every routine. Nothing on a day without routines.
 */
export function RoutinesDayLine({ s, day }: { s: Snapshot; day: number }) {
  const t = todayEpoch();
  const [open, setOpen] = useState(false);
  const { done, total } = routineProgress(routinesOnDay(s.items, s.done, day, t));
  if (!total) return null;
  return <>
    <button className="p-routines-line" aria-label={`Routines, ${done} of ${total} done. All routines`} onClick={() => setOpen(true)}>
      Routines<span className="n">{done}/{total}</span><span className="grow" />
      <MIcon name="fKeyboardArrowRight" size={20} />
    </button>
    <RoutineSheets s={s} t={t} open={open} onClose={() => setOpen(false)} />
  </>;
}

/**
 * Every routine in a sheet (85, laid out like the app's other sheets): a title with today's count, then
 * today's routines and the ones on other days under small headings. Each row: its ring (done, due, or
 * dashed when it isn't today), name, how it repeats and when it's next, and its streak. A tap opens it;
 * Streaks at the end (241).
 */
function RoutineListSheet({ s, t, onClose, onStreaks }: { s: Snapshot; t: number; onClose: () => void; onStreaks: () => void }) {
  const rows = routineList(s.items, s.done, t);
  const streaks = showStreaks();
  const todays = rows.filter((r) => r.today !== "off"), others = rows.filter((r) => r.today === "off");
  const done = todays.filter((r) => r.today === "done").length;
  /** "Tomorrow", "Sun", or the date further off. */
  const nextText = (d: number | null) => (d === null ? "Not planned" : d === t + 1 ? "Next tomorrow" : d - t < 7 ? `Next ${dayShort(weekday(d))}` : `Next ${formatDateShort(d)}`);
  const row = (r: (typeof rows)[number], close: () => void) => (
    <button key={r.item.id} className={`p-rlist-row ${r.today}`} onClick={() => { close(); window.setTimeout(() => openItem(r.item, r.today === "off" ? r.next : t), 210); }}>
      <span className="ring">{r.today === "done" && <MIcon name="fCheck" size={14} />}</span>
      <span className="text">
        <span className="name">{r.item.title || "Untitled"}</span>
        <span className="sub">{[r.repeat, r.today === "done" ? "Done" : r.today === "due" ? "To do" : nextText(r.next)].join(" · ")}</span>
      </span>
      {streaks && r.streak.current > 0 && <span className="streak">{streakSymbol() ? <MIcon name="fLocalFireDepartment" size={14} /> : null}{r.streak.current}{streakSymbol() ? "" : " in a row"}</span>}
    </button>
  );
  return (
    <BottomSheet onClose={onClose} className="p-rlist-sheet">{(close) => (
      <div className="p-rlist">
        <div className="p-sheet-title">Routines</div>
        {todays.length > 0 && <div className="p-rlist-count">{done === todays.length ? `All ${todays.length} done today` : `${done} of ${todays.length} done today`}</div>}
        {rows.length === 0 && <div className="p-rlist-empty muted">No routines yet. Turn on Routine in a repeating task or event.</div>}
        <div className="p-rlist-rows">
          {todays.length > 0 && others.length > 0 && <div className="p-rlist-group">Today</div>}
          {todays.map((r) => row(r, close))}
          {others.length > 0 && <div className="p-rlist-group">{todays.length ? "Other days" : "Not today"}</div>}
          {others.map((r) => row(r, close))}
        </div>
        {rows.length > 0 && (
          <button className="p-rlist-streaks" onClick={() => { close(); window.setTimeout(onStreaks, 210); }}>
            <MIcon name="fLocalFireDepartment" size={20} /><span>Streaks</span><MIcon name="fKeyboardArrowRight" size={20} />
          </button>
        )}
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

/**
 * The Tasks heading with the day's progress (225): "Tasks · 1 of 2 done" ("All done" once every one is
 * ticked), and under it Material 3's linear progress indicator, full width: 4 dp, a 4 dp gap, a stop dot.
 */
function TasksHead({ done, total }: { done: number; total: number }) {
  const f = total ? done / total : 0;
  const text = tasksProgressText(done, total);
  return <>
    <div className="section p-tasks-head">Tasks{text && <span className="n"> · {text}</span>}</div>
    {total > 0 && (
      <div className={`p-progress p-taskbar ${f >= 1 ? "all" : ""}`} role="progressbar" aria-label="Tasks done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        {f > 0 && <span className="active" style={{ width: `${f * 100}%` }} />}
        {f < 1 && <span className="track" style={{ marginLeft: f > 0 ? 4 : 0 }}><span className="stop" /></span>}
      </div>
    )}
  </>;
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
 * The to-dos button in Today's top bar (271): a tap opens them. The badge on its corner is the number of
 * domain/todoNumber.ts, in its priority's colour. A long press, a right-click or the keyboard's menu key
 * offers clearing it, and while it's cleared, showing it again.
 */
function TodosButton({ s, onClick }: { s: Snapshot; onClick: () => void }) {
  const cleared = todosCleared();
  const number = todoNumber(openTodos(s).map((e) => e.item), cleared);
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const items: MenuItem[] = [
    ...(number ? [{ label: "Clear the number", onClick: () => showSnackbar("Number cleared", "Undo", clearTodoNumber()) }] : []),
    ...(cleared ? [{ label: "Show the number", onClick: showTodoNumber }] : []),
  ];
  const offer = () => setMenu(true);
  const { fired, ...press } = useHold(items.length ? offer : undefined);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key !== "ContextMenu" && !(e.key === "F10" && e.shiftKey)) || !items.length) return;
    e.preventDefault();
    flushSync(offer);
    anchor.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  };
  return (
    <span className="p-menu-anchor" ref={anchor}>
      <button className="p-icon p-badged" aria-label={number ? `To-dos, ${number.count} ${PRIORITIES[number.level].toLowerCase()}` : "To-dos"}
        data-no-tip={items.length ? "" : undefined} {...press} onKeyDown={onKeyDown} onClick={() => { if (!fired()) onClick(); }}>
        <MIcon name="oTaskAlt" />
        {number && <span className="p-badge" aria-hidden="true" style={{ background: priorityColor(number.level) }}>{number.count > 99 ? "99+" : number.count}</span>}
      </button>
      <DropdownMenu open={menu} onClose={() => setMenu(false)} items={items} />
    </span>
  );
}

/**
 * Today on the phone, laid out like the native TodayScreen in HomeScreen's top app bar: the day switcher
 * (arrows and a two-line title that opens a date picker) as the bar's title, search and settings as its
 * actions. Below, the days sit side by side like a ViewPager: a sideways drag moves them with the
 * finger, the day before or after sliding in beside it, and letting go settles on a day.
 */
export function PhoneToday() {
  const tasksB = useLook("tasks");
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
  // The to-dos (tasks with no date) aren't on Today's list (271): a button in the bar opens them in a sheet.
  const [todosOpen, setTodosOpen] = useState(false);
  // Back from a to-do opened in the sheet: the sheet is there as it was, with no entrance (319).
  const [todosBack, setTodosBack] = useState<number | null>(null);
  useEffect(() => {
    const on = (e: HashChangeEvent) => {
      const top = sheetBack(location.hash, !!e.oldURL);
      if (top !== null) { setTodosBack(top); setTodosOpen(true); }
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const near = useDeferredValue(day);
  const days = [...new Set([near - 1, near, near + 1, day])].sort((a, b) => a - b);
  const track = useRef<HTMLDivElement>(null);
  const pager = useSwipePager<HTMLDivElement>({
    layers: () => [track.current],
    onStep: (dir) => show(dayRef.current + dir),
    // The routines row scrolls sideways itself when it overflows; there it wins over the day swipe.
    allow: (el) => { const row = el.closest<HTMLElement>(".p-rchips"); return !row || row.scrollWidth <= row.clientWidth + 1; },
    // The pages change tab (300): the day changes on the top bar, unless Settings says otherwise.
    pages: () => !swipeTabs(),
    turner: turners.today,
  });
  /** One day that way, with the swipe's slide. */
  const turn = (dir: 1 | -1) => { if (turners.today.current) turners.today.current.turn(dir); else show(day + dir); };
  const head = useHorizontalSwipe<HTMLElement>(turnerSwipe("today", turn, () => window.innerWidth));

  return (
    <div className="p-scaffold">
      <header className="p-appbar tall" ref={head}>
        <div className="p-dayrow">
          <IconButton className="title-icon" icon="fKeyboardArrowLeft" label="Previous day" onClick={() => turn(-1)} />
          <button className="p-dayswitch" aria-label="Go to a day" onClick={() => setPicking(true)}>
            <span className="big">{word ?? WEEKDAYS[weekday(day) - 1]}</span>
            <span className="small">{word ? formatDate(day) : formatDateShort(day)}</span>
          </button>
          <IconButton className="title-icon" icon="fKeyboardArrowRight" label="Next day" onClick={() => turn(1)} />
        </div>
        <span className="grow" />
        <TestChip />
        {!isToday && <IconButton icon="oToday" label="Today" onClick={() => show(t)} />}
        {tasksB === "B" && <IconButton icon="oTaskAlt" label="Tasks" onClick={() => go("tasks")} />}
        {/* On another day, Today takes its place (the bar has no room for both beside a long weekday). */}
        {isToday && <TodosButton s={s} onClick={() => setTodosOpen(true)} />}
        <AppBarActions />
      </header>
      {todosOpen && createPortal(<TodosSheet back={todosBack} onClose={() => { setTodosOpen(false); setTodosBack(null); }} />, document.body)}
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
