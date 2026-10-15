import { useEffect, useState } from "react";
import { epochOf, formatDate, formatDateShort, today as todayEpoch, weekday, ymd } from "../domain/dates.ts";
import { type TaskEntry, occurrencesIn, streak, tasksForDay, tasksOnDay, tickedDuring } from "../domain/schedule.ts";
import { preview } from "../domain/text.ts";
import { isRecurring } from "../domain/types.ts";
import { useSnapshot } from "../store/store.ts";
import { animated, useSpring } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import type { ReactNode } from "react";
import { EventRow, Icon, TaskRow, go, showDoneOnToday, useCheckedHold, useNow } from "./common.tsx";
import { AppBarActions } from "./phone/chrome.tsx";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const toInput = (e: number) => { const { y, m, d } = ymd(e); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };

/** Identifies a task row on Today: the task and the occurrence it ticks. */
const rowKey = (e: TaskEntry) => `${e.item.id}_${e.day}`;

// The day being looked at, kept while moving around the app; null follows the real today.
let viewed: number | null = null;
/** The day Today shows (the phone's + button adds to it). */
export const todayViewedDay = () => viewed ?? todayEpoch();

export function TodayView({ phone }: { phone?: boolean }) {
  const s = useSnapshot();
  const now = useNow();
  const t = todayEpoch();
  const [view, setView] = useState<number | null>(viewed);
  const day = view ?? t;
  const isToday = day === t;
  const show = (d: number) => { viewed = d === t ? null : d; setView(viewed); };
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

  let overdue: TaskEntry[] = [], dayTasks: TaskEntry[], anytime = 0;
  if (isToday) {
    const tasks = tasksForDay(s.items, s.done, t);
    overdue = tasks.filter((e) => e.status === "OVERDUE");
    dayTasks = tasks.filter((e) => e.status === "DUE" || e.status === "CARRIED" || e.status === "DONE");
    anytime = tasks.filter((e) => e.status === "ANYTIME").length;
  } else {
    // Tasks still overdue today carry on to the days ahead until they're ticked.
    if (day > t) overdue = tasksForDay(s.items, s.done, t).filter((e) => e.status === "OVERDUE" || e.status === "CARRIED");
    dayTasks = tasksOnDay(s.items, s.done, day, t);
  }
  const shownOverdue = hold.arrange(`o${day}`, overdue, rowKey);
  // "Show completed tasks on Today" off: ticked tasks leave today's list (after the hold).
  const hideDone = isToday && !showDoneOnToday();
  const shownTasks = hold.arrange(`t${day}`, hideDone ? dayTasks.filter((e) => e.status !== "DONE") : dayTasks, rowKey);
  // Ticked during this day but not listed above: overdue ones, undated ones, early ticks...
  const listed = new Set([...shownOverdue, ...shownTasks].map(rowKey));
  const alsoDone = hideDone ? [] : tickedDuring(s.items, s.completions, day).filter((e, i, all) => !listed.has(rowKey(e)) && all.findIndex((x) => rowKey(x) === rowKey(e)) === i);
  const events = occurrencesIn(s.items.filter((i) => i.type === "EVENT"), s.done, day, day + 7);
  const dayEvents = events.filter((o) => o.day <= day && o.endDay >= day);
  const upcoming = isToday ? events.filter((o) => o.day > day).slice(0, 8) : [];
  const daily = s.items.find((i) => i.type === "NOTE" && i.noteDay === day);
  const doneCount = dayTasks.filter((e) => e.status === "DONE").length;
  const word = day === t ? "Today" : day === t - 1 ? "Yesterday" : day === t + 1 ? "Tomorrow" : null;
  const dayWord = word?.toLowerCase() ?? "that day";
  const weekdayName = WEEKDAYS[weekday(day) - 1];

  const rows = (list: TaskEntry[], listId: string, showDay: boolean) => list.map((e, index) => (
    <TaskRow key={`${listId}_${rowKey(e)}`} entry={e} s={s} now={now} showDay={showDay}
      streakInfo={isRecurring(e.item) && !showDay ? streak(e.item, s.done, day) : undefined}
      onToggle={(done) => hold.onToggle(listId, rowKey(e), e, index, done)} />
  ));

  const sections = <>
      {dayTasks.length > 0 && (
        <div className="row progress-row" style={{ margin: "4px 0 8px" }}>
          <div className="grow progress" style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
            <div style={{ width: `${(doneCount / dayTasks.length) * 100}%`, height: "100%", background: "var(--accent)", transition: "width .3s" }} />
          </div>
          <span className="hint">{doneCount} of {dayTasks.length} done</span>
        </div>
      )}
      {shownOverdue.length > 0 && <>
        <div className="section">Overdue</div>
        {rows(shownOverdue, `o${day}`, true)}
      </>}
      <div className="section">Tasks</div>
      {shownTasks.length === 0 && <div className="hint empty">{isToday ? (phone ? "No tasks due today. Tap + to add one." : "No tasks due today. Use the bar at the top to add one.") : `No tasks were due ${dayWord}.`}</div>}
      {rows(shownTasks, `t${day}`, false)}
      {anytime > 0 && <div className="hint anytime" style={{ marginTop: 6 }}>{anytime} task(s) without a date — see Tasks</div>}
      {alsoDone.length > 0 && <>
        <div className="section">{shownTasks.length || shownOverdue.length ? `Also done ${dayWord}` : `Done ${dayWord}`}</div>
        {alsoDone.map((e) => <TaskRow key={`d${rowKey(e)}`} entry={e} s={s} now={now} showDay={e.day !== day} />)}
      </>}
      <div className="section">Schedule</div>
      {dayEvents.length === 0 && <div className="hint empty">{isToday ? "Nothing scheduled today." : `Nothing scheduled ${dayWord}.`}</div>}
      {dayEvents.map((o) => <EventRow key={`e${o.item.id}-${o.day}`} o={o} s={s} />)}
      <div className="section">{isToday ? "Today's note" : "Note"}</div>
      <div className="card note-preview" onClick={() => go(daily ? `note/${daily.id}` : `note/new?day=${day}`)}>
        {phone && <Icon name="edit" size={22} />}
        {phone
          ? <span className="note-text">{daily ? preview(daily.content, 200) || "Empty — tap to write" : isToday ? "Start today's journal or notes" : "Write a note for this day"}</span>
          : daily ? preview(daily.content, 200) || "Empty — click to write" : isToday ? "Start today's journal or notes" : "Write a note for this day"}
      </div>
      {upcoming.length > 0 && <>
        <div className="section">Next 7 days</div>
        {upcoming.map((o) => <EventRow key={`u${o.item.id}-${o.day}`} o={o} s={s} showDay />)}
      </>}
  </>;

  if (phone) return <PhoneToday day={day} word={word} weekdayName={weekdayName} isToday={isToday} show={show} t={t}>{sections}</PhoneToday>;

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

      {sections}
    </div>
  );
}

/**
 * Today on the phone: the day switcher in a Material top app bar (like the native app), and the list
 * below, where a sideways swipe moves a day back or forward.
 */
function PhoneToday({ day, word, weekdayName, isToday, show, t, children }: {
  day: number; word: string | null; weekdayName: string; isToday: boolean; show: (d: number) => void; t: number; children: ReactNode;
}) {
  const [{ x, o }, api] = useSpring(() => ({ x: 0, o: 1, config: { tension: 500, friction: 44 } }));
  const change = (dir: number) => {
    show(day + dir);
    // The new day comes in from the side the finger went towards.
    api.start({ from: { x: dir * 56, o: 0.2 }, to: { x: 0, o: 1 } });
  };
  const bind = useDrag(({ last, tap, movement: [mx], velocity: [vx], direction: [dx] }) => {
    if (tap) return;
    if (!last) { api.start({ x: mx * 0.4, o: 1 - Math.min(0.5, Math.abs(mx) / 600), immediate: true }); return; }
    const fling = vx > 0.6;
    if (mx > 72 || (fling && dx > 0)) change(-1);
    else if (mx < -72 || (fling && dx < 0)) change(1);
    else api.start({ x: 0, o: 1 });
  }, { axis: "x", filterTaps: true, threshold: 12 });
  return (
    <div className="p-scaffold">
      <header className="p-appbar today">
        <button className="p-icon" aria-label="Previous day" onClick={() => change(-1)}><Icon name="left" size={24} /></button>
        <label className="p-dayswitch">
          <span className="big">{word ?? weekdayName}</span>
          <span className="small">{word ? formatDate(day) : formatDateShort(day)}</span>
          <input type="date" value={toInput(day)} onChange={(e) => {
            const [y, m, d] = e.target.value.split("-").map(Number);
            if (e.target.value) show(epochOf(y, m, d));
          }} />
        </label>
        <button className="p-icon" aria-label="Next day" onClick={() => change(1)}><Icon name="right" size={24} /></button>
        <span className="grow" />
        {!isToday && <button className="p-icon" aria-label="Back to today" onClick={() => show(t)}><Icon name="today" size={24} /></button>}
        <AppBarActions />
      </header>
      <div className="p-content today-list" {...bind()}>
        <animated.div className="today-page" style={{ transform: x.to((v) => `translate3d(${v}px,0,0)`), opacity: o }}>
          {children}
          <div style={{ height: 96 }} />
        </animated.div>
      </div>
    </div>
  );
}
