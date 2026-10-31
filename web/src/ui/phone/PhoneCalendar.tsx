// The calendar on the phone, as CalendarScreen.kt: the title and its arrow / today / view buttons, a
// view menu (Day, 3 days, Week, Month, Year, Agenda, then Filter, the day's note, Search, Settings),
// and the views themselves. The day / 3-day / week time grid scrolls natively, zooms with two
// fingers, moves an event on long-press-and-drag (snapped to 15 minutes), adds one on a tap on an
// empty slot, and slides sideways like a pager to the days before and after. Month and Year slide the
// same way.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addMonths, epochOf, formatDate, formatDateShort, formatTime, monthLong, monthShort, nowMinutes, relativeDay, startOfWeek, today as todayEpoch, weekday, ymd } from "../../domain/dates.ts";
import { forCalendar, type Occurrence, type TaskEntry } from "../../domain/schedule.ts";
import { carryOver } from "../../store/prefs.ts";
import { type Item, displayTitle, isRecurring } from "../../domain/types.ts";
import { isRoutineItem } from "../../domain/routines.ts";
import { parseDays } from "../../domain/recurrence.ts";
import { type Lane, barsShownOver, lanesOver, spanLanes } from "../../domain/spans.ts";
import { type EditScope, saveItem, saveSeriesEdit, type Snapshot, useSnapshot } from "../../store/store.ts";
import { type Placed, layoutDay } from "../shared/dayLayout.ts";
import { EventRow, TaskRow, go, openItem, useNow } from "../shared/common.tsx";
import { ScopeDialog } from "./PhoneItem.tsx";
import type { SlotPreview } from "./AddPanel.tsx";
import { Checkbox, Dialog, DropdownMenu, FilterChip, IconButton, MIcon, type MenuItem, openSearch } from "./chrome.tsx";
import { type TaskFilter, TaskChips, inCategory } from "./taskChips.tsx";
import { useTrainingDays } from "./PhoneTraining.tsx";
import { feel } from "./haptics.ts";
import { type PageTurner, SWIPE_GAIN, pageTarget, spring, swipeTabs, turnerSwipe, turners, useSwipePager } from "./pager.ts";
import { claimSwipe, useHorizontalSwipe } from "./gesture.ts";
import { VelocityTracker, frameWriter } from "./motion.ts";
import { useLook } from "./looks.ts";
import { TOUCH_SLOP } from "./press.ts";
import { END_ROOM, MAX_HOUR_HEIGHT, openingHourHeight, openingScrollTop, pinchHourHeight, zoomScrollTop } from "./zoom.ts";
import { deskPager, isMouse, mouseMenu } from "./desk.ts";
import { setEventEnd } from "./eventTime.ts";
import { wheelZoom } from "./keys.ts";

type Mode = "day" | "3day" | "week" | "month" | "year" | "agenda";
const MODES: [Mode, string][] = [["day", "Day"], ["3day", "3 days"], ["week", "Week"], ["month", "Month"], ["year", "Year"], ["agenda", "Agenda"]];
const NARROW = ["M", "T", "W", "T", "F", "S", "S"];
const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const mondayFirst = () => localStorage.getItem("weekStartsMonday") !== "false";
const DAY_MIN = 1440;
const LONG_PRESS_MS = 400;
const ZOOM_KEY = "calHourHeight";

// Kept while moving around the app, like the native CalendarState.
let selected = todayEpoch();
let filters = { events: true, tasks: true, hidden: new Set<number>() };
/** The Agenda's own chips after Events and Tasks (the Tasks page's: Show completed, a category; 241). */
let agendaFilter: TaskFilter = { showDone: false, category: null };
let savedHour: number | null = Number(localStorage.getItem(ZOOM_KEY)) || null;
/** The view chosen in the menu (the native app keeps it in its settings); Month to begin with, as there. */
const baseMode = (): Mode => {
  const m = localStorage.getItem("calModePhone") as Mode | null;
  return m && MODES.some(([k]) => k === m) ? m : "month";
};
/** The day the calendar is on (the + button adds there). */
export const calendarSelectedDay = () => selected;
/** Back to the base view (a double tap on the Calendar tab): today, the saved view, no filters, the opening zoom. */
export function resetCalendar() {
  selected = todayEpoch();
  filters = { events: true, tasks: true, hidden: new Set() };
  agendaFilter = { showDone: false, category: null };
  savedHour = null;
  localStorage.removeItem(ZOOM_KEY);
}

let goToday: (() => void) | null = null;
/** The calendar's own Today button (the T key). */
export const calendarGoToday = () => goToday?.();

/** Text on a solid colour, as Compose's contentColor(): dark on light colours, white on the rest. */
export function onColor(c: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.5 ? "#1c1b1f" : "#fff";
}

function openDailyNote(s: Snapshot, day: number) {
  const n = s.items.find((i) => i.type === "NOTE" && i.noteDay === day);
  go(n ? `note/${n.id}` : `note/new?day=${day}`);
}

export function PhoneCalendar({ onNewAt, pending }: { onNewAt: (day: number, min: number) => void; pending: SlotPreview | null }) {
  const s = useSnapshot();
  const [mode, setMode] = useState<Mode>(baseMode);
  const [anchor, setAnchorState] = useState(selected);
  const [menu, setMenu] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [f, setF] = useState(filters);
  // Routines (daily habits) can crowd the calendar: one switch in the menu hides them, on this phone only.
  const [showRoutines, setShowRoutines] = useState(() => localStorage.getItem("calHideRoutines") !== "1");
  const toggleRoutines = () => { const v = !showRoutines; localStorage.setItem("calHideRoutines", v ? "0" : "1"); setShowRoutines(v); };
  const setAnchor = (d: number) => { selected = d; setAnchorState(d); };
  const setFilters = (n: typeof filters) => { filters = n; setF(n); };
  /** Picked in the menu: remembered, like the native calendarView setting. */
  const pickMode = (m: Mode) => { localStorage.setItem("calModePhone", m); setMode(m); };
  useEffect(() => { goToday = () => setAnchor(todayEpoch()); return () => { goToday = null; }; });

  const step = (dir: number) => setAnchor(
    mode === "day" ? anchor + dir : mode === "3day" ? anchor + 3 * dir : mode === "week" || mode === "agenda" ? anchor + 7 * dir
      : mode === "month" ? addMonths(anchor, dir) : addMonths(anchor, 12 * dir));
  /** One range that way, with the swipe's slide (the Agenda has no pager to slide). */
  const turn = (dir: 1 | -1) => { if (turners.calendar.current) turners.calendar.current.turn(dir); else step(dir); };
  const head = useHorizontalSwipe<HTMLElement>(turnerSwipe("calendar", turn, () => window.innerWidth));
  const { y, m } = ymd(anchor);
  const weekStart = startOfWeek(anchor, mondayFirst());
  const title = mode === "year" ? String(y) : mode === "day" ? formatDateShort(anchor) : mode === "month" || mode === "agenda" ? `${monthLong(m)} ${y}`
    : `${monthShort(ymd(mode === "week" ? weekStart : anchor).m)} ${ymd(mode === "week" ? weekStart : anchor).y}`;
  const first = mode === "week" ? weekStart : anchor;
  const count = mode === "day" ? 1 : mode === "3day" ? 3 : 7;
  const items = useMemo(() => s.items.filter((i) =>
    ((i.type === "EVENT" && f.events) || (i.type === "TASK" && f.tasks)) && (i.categoryId === null || !f.hidden.has(i.categoryId))
    && (showRoutines || !isRoutineItem(i))), [s, f, showRoutines]);
  const noteDays = useMemo(() => new Set(s.items.filter((i) => i.type === "NOTE" && i.noteDay !== null).map((i) => i.noteDay!)), [s]);
  // Training days get a light mark by the date (the session itself is on the Training page).
  const trainDays = useTrainingDays();
  const grid = mode === "day" || mode === "3day" || mode === "week";

  const menuItems: MenuItem[] = [
    ...MODES.map(([k, l]): MenuItem => ({ label: l, checked: mode === k, onClick: () => pickMode(k) })),
    { label: "Filter…", icon: "oFilterList", divider: true, onClick: () => setFilterOpen(true) },
    { label: "Show routines", icon: "oTaskAlt", checked: showRoutines, onClick: toggleRoutines },
    { label: "Note for selected day", icon: "oEditNote", onClick: () => openDailyNote(s, anchor) },
    { label: "Search", icon: "oSearch", onClick: openSearch },
    { label: "Settings", icon: "oSettings", onClick: () => go("settings") },
  ];

  return (
    <div className="p-scaffold p-cal">
      <div className="p-statusbar" />
      <header className="p-calhead" ref={head}>
        <h2 className="t-title-medium">{title}</h2>
        <IconButton icon="fArrowBack" label="Previous" onClick={() => turn(-1)} />
        <IconButton icon="oToday" label="Today" onClick={() => setAnchor(todayEpoch())} />
        <IconButton icon="fArrowForward" label="Next" onClick={() => turn(1)} />
        <div className="p-menu-anchor">
          <IconButton icon="oViewAgenda" label="View" onClick={() => setMenu(true)} />
          <DropdownMenu open={menu} onClose={() => setMenu(false)} items={menuItems} />
        </div>
      </header>
      <div className="p-calbody">
        {grid && <TimeGrid s={s} items={items} first={first} count={count} onStep={step} turn={turn} onNewAt={onNewAt} pending={pending} noteDays={noteDays} trainDays={trainDays}
          onDayHeader={(d) => { setAnchor(d); setMode("day"); }} onDayNote={(d) => openDailyNote(s, d)} />}
        {mode === "month" && <MonthView s={s} items={items} anchor={anchor} noteDays={noteDays} trainDays={trainDays} onStep={step}
          onPick={(d) => { if (d === anchor) setMode("day"); else setAnchor(d); }}
          onLong={(d) => { setAnchor(d); onNewAt(d, 9 * 60); }} onDayNote={(d) => openDailyNote(s, d)} />}
        {mode === "year" && <YearView s={s} items={items} anchor={anchor} onStep={step} onMonth={(d) => { setAnchor(d); setMode("month"); }} />}
        {mode === "agenda" && <AgendaView s={s} items={items} from={anchor} f={f} onFilters={setFilters} />}
      </div>
      {filterOpen && <FilterDialog s={s} value={f} onChange={setFilters} onClose={() => setFilterOpen(false)} />}
    </div>
  );
}

/** "Show on calendar": events, tasks, and each category (CalendarScreen.kt's filter dialog). */
function FilterDialog({ s, value, onChange, onClose }: { s: Snapshot; value: typeof filters; onChange: (v: typeof filters) => void; onClose: () => void }) {
  const row = (label: string, checked: boolean, set: (v: boolean) => void) => (
    <label className="p-check-row" key={label}><Checkbox checked={checked} onChange={set} /><span>{label}</span></label>
  );
  return (
    <Dialog title="Show on calendar" onClose={onClose} actions={<button className="p-text-btn" onClick={onClose}>Done</button>}>
      {row("Events", value.events, (v) => onChange({ ...value, events: v }))}
      {row("Tasks", value.tasks, (v) => onChange({ ...value, tasks: v }))}
      <div className="p-divider" />
      {s.categories.map((c) => row(c.name, !value.hidden.has(c.id), (show) => {
        const hidden = new Set(value.hidden);
        if (show) hidden.delete(c.id); else hidden.add(c.id);
        onChange({ ...value, hidden });
      }))}
    </Dialog>
  );
}

// ---------- Rows shared by Month and Agenda (MonthView.kt's DayAgenda, YearAgenda.kt) ----------

/** A calendar occurrence as a list row: tasks get a tick box, events their times. */
function OccurrenceRow({ o, s, now }: { o: Occurrence; s: Snapshot; now: number }) {
  if (o.item.type !== "TASK") return <EventRow o={o} s={s} />;
  const entry: TaskEntry = o.overdue
    ? { item: o.item, day: o.item.startDay, status: "OVERDUE", missed: 1 }
    : { item: o.item, day: o.day, status: o.completed ? "DONE" : "DUE", missed: 0 };
  return <TaskRow entry={entry} s={s} now={now} />;
}

// ---------- Month (MonthView.kt) ----------

const monthOf = (d: number) => { const { y, m } = ymd(d); return epochOf(y, m, 1); };

function MonthView({ s, items, anchor, noteDays, trainDays, onStep, onPick, onLong, onDayNote }: {
  s: Snapshot; items: Item[]; anchor: number; noteDays: Set<number>; trainDays: Map<number, string>; onStep: (dir: number) => void;
  onPick: (d: number) => void; onLong: (d: number) => void; onDayNote: (d: number) => void;
}) {
  const now = useNow();
  const t = todayEpoch();
  const strip = useRef<HTMLDivElement>(null);
  const pager = useSwipePager<HTMLDivElement>({
    layers: () => [strip.current], onStep: (dir) => onStep(dir), pages: () => !swipeTabs(), turner: turners.calendar,
  });
  const months = [monthOf(addMonths(anchor, -1)), monthOf(anchor), monthOf(addMonths(anchor, 1))];
  const dayList = useMemo(() => forCalendar(items, s.done, anchor, anchor, t, carryOver()).filter((o) => o.day <= anchor && o.endDay >= anchor), [items, s, anchor, t]);
  return (
    <div className="p-monthview">
      <div className="p-hpager" ref={pager}>
        <div className="p-hstrip" ref={strip}>
          {months.map((first, i) => (
            <div key={first} className={`p-hpanel ${i === 1 ? "cur" : ""}`} style={{ left: `${(i - 1) * 100}%` }} aria-hidden={i !== 1}>
              <MonthGrid s={s} items={items} first={first} t={t} selected={i === 1 ? anchor : null} noteDays={noteDays} trainDays={trainDays} onPick={onPick} onLong={onLong} />
            </div>
          ))}
        </div>
      </div>
      <div className="p-divider" />
      <div className="p-dayagenda p-rows">
        <div className="p-dayagenda-head">
          <span className="grow t-title-medium">{formatDate(anchor)}</span>
          <IconButton icon="oEditNote" label="Day note" onClick={() => onDayNote(anchor)} />
        </div>
        {dayList.length === 0 && <div className="p-empty pad16">Nothing planned. Long-press a day to add an event.</div>}
        {dayList.map((o) => <OccurrenceRow key={`${o.item.id}_${o.day}`} o={o} s={s} now={now} />)}
        <div style={{ height: 88 }} />
      </div>
    </div>
  );
}

const MonthGrid = memo(function MonthGrid({ s, items, first, t, selected, noteDays, trainDays, onPick, onLong }: {
  s: Snapshot; items: Item[]; first: number; t: number; selected: number | null; noteDays: Set<number>; trainDays: Map<number, string>;
  onPick: (d: number) => void; onLong: (d: number) => void;
}) {
  const start = startOfWeek(first, mondayFirst());
  const days = Array.from({ length: 42 }, (_, i) => start + i);
  const month = ymd(first).m;
  const occ = useMemo(() => forCalendar(items, s.done, days[0], days[41], t, carryOver()), [items, s, first, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = useMemo(() => {
    const map = new Map<number, Occurrence[]>();
    for (const o of occ) for (let d = Math.max(o.day, days[0]); d <= Math.min(o.endDay, days[41]); d++) {
      if (!covers(o, d)) continue;
      const l = map.get(d); if (l) l.push(o); else map.set(d, [o]);
    }
    return map;
  }, [occ]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = ymd(days[35]).m !== month ? 5 : 6;
  const maxShown = rows === 5 ? 3 : 2;
  const press = useLongPress(onLong, onPick);
  // Items over several days: one bar across each week they touch, in lanes at the top of the cells.
  const multi = useMemo(() => occ.filter((o) => o.endDay > o.day), [occ]);
  const keyOf = (o: Occurrence) => `${o.item.id}_${o.day}`;
  const byKey = useMemo(() => new Map(multi.map((o) => [keyOf(o), o])), [multi]);
  return (
    <div className="p-mgrid">
      <div className="p-mweek">{days.slice(0, 7).map((d) => <span key={d}>{NARROW[weekday(d) - 1]}</span>)}</div>
      {Array.from({ length: rows }, (_, r) => {
        const week = days.slice(r * 7, r * 7 + 7);
        const lanes = spanLanes(multi.map((o) => ({ key: keyOf(o), from: o.day, to: o.endDay, skip: skippedDays(o) })), week[0], week[6]);
        return (
          <div key={r} className="p-mrow" style={{ height: rows === 5 ? 78 : 66 }}>
            {week.map((d, col) => {
              const list = byDay.get(d) ?? [];
              // Room for the bars over this day first, then its own items.
              const room = Math.min(maxShown, lanesOver(lanes, col));
              const own = list.filter((o) => o.endDay === o.day).slice(0, maxShown - room);
              const more = list.length - own.length - barsShownOver(lanes, col, maxShown);
              return (
                <div key={d} className={`p-mcell ${d === selected ? "sel" : ""}`} role="button" {...press(d)}>
                  <div className="p-mnum-row">
                    <span className={`p-mnum ${d === t ? "today" : ""} ${ymd(d).m !== month ? "out" : ""}`}>{ymd(d).d}</span>
                    {noteDays.has(d) && <MIcon name="oEditNote" size={11} />}
                    {trainDays.has(d) && <span className="tr-mark"><MIcon name={trainDays.get(d)!} size={11} /></span>}
                  </div>
                  {room > 0 && <span className="p-mspace" style={{ height: room * 11 }} />}
                  {own.map((o) => {
                    const c = o.overdue ? "var(--danger)" : s.colorOf(o.item);
                    const isTask = o.item.type === "TASK";
                    return (
                      <span key={keyOf(o)} className={`p-mchip ${isTask ? "task" : ""}`} style={{
                        ["--c" as string]: c, textDecoration: o.completed ? "line-through" : undefined,
                      }}>{displayTitle(o.item)}</span>
                    );
                  })}
                  {more > 0 && <span className="p-mmore">+{more}</span>}
                </div>
              );
            })}
            <SpanBars lanes={lanes} cap={maxShown} cols={7} byKey={byKey} s={s} className="p-mchip p-mbar" />
          </div>
        );
      })}
    </div>
  );
});

/** Tap or long-press (Compose's combinedClickable) on a cell: handlers to spread on it. */
function useLongPress(onLong: (d: number) => void, onTap: (d: number) => void) {
  const st = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const cb = useRef({ onLong, onTap });
  cb.current = { onLong, onTap };
  return (d: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      const p = { timer: 0, x: e.clientX, y: e.clientY, fired: false };
      p.timer = window.setTimeout(() => { p.fired = true; feel("pickup"); cb.current.onLong(d); }, 500);
      st.current = p;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = st.current;
      if (p && (Math.abs(e.clientX - p.x) > TOUCH_SLOP || Math.abs(e.clientY - p.y) > TOUCH_SLOP)) { clearTimeout(p.timer); st.current = null; }
    },
    onPointerUp: () => { const p = st.current; if (p) clearTimeout(p.timer); },
    onPointerCancel: () => { const p = st.current; if (p) clearTimeout(p.timer); st.current = null; },
    onClick: () => { const p = st.current; st.current = null; if (!p?.fired) cb.current.onTap(d); },
    // A right-click is the mouse's long press.
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (mouseMenu(e)) { const p = st.current; if (p) clearTimeout(p.timer); st.current = null; cb.current.onLong(d); } },
  });
}

// ---------- Year (YearAgenda.kt's YearView) ----------

function YearView({ s, items, anchor, onStep, onMonth }: { s: Snapshot; items: Item[]; anchor: number; onStep: (dir: number) => void; onMonth: (first: number) => void }) {
  const y = ymd(anchor).y;
  const t = todayEpoch();
  const strip = useRef<HTMLDivElement>(null);
  const pager = useSwipePager<HTMLDivElement>({
    layers: () => [strip.current], onStep: (dir) => onStep(dir), pages: () => !swipeTabs(), turner: turners.calendar,
  });
  return (
    <div className="p-yearview" ref={pager}>
      <div className="p-hstrip" ref={strip}>
        {[y - 1, y, y + 1].map((yr, i) => (
          <div key={yr} className={`p-hpanel ${i === 1 ? "cur" : ""}`} style={{ left: `${(i - 1) * 100}%` }} aria-hidden={i !== 1}>
            <YearPanel s={s} items={items} year={yr} t={t} onMonth={onMonth} />
          </div>
        ))}
      </div>
    </div>
  );
}

const YearPanel = memo(function YearPanel({ s, items, year, t, onMonth }: { s: Snapshot; items: Item[]; year: number; t: number; onMonth: (first: number) => void }) {
  const busy = useMemo(() => {
    const counts = new Map<number, number>();
    for (const o of forCalendar(items, s.done, epochOf(year, 1, 1), epochOf(year, 12, 31), t, carryOver())) counts.set(o.day, (counts.get(o.day) ?? 0) + 1);
    return counts;
  }, [items, s, year, t]);
  const mf = mondayFirst();
  const tm = ymd(t);
  return (
    <div className="p-ygrid">
      {Array.from({ length: 12 }, (_, mi) => {
        const first = epochOf(year, mi + 1, 1);
        const start = startOfWeek(first, mf);
        return (
          <div key={mi} className="p-ymonth" role="button" onClick={() => onMonth(first)}>
            <div className={`p-ytitle t-title-small ${tm.y === year && tm.m === mi + 1 ? "now" : ""}`}>{monthLong(mi + 1)}</div>
            <div className="p-yweek">{Array.from({ length: 7 }, (_, i) => <span key={i}>{NARROW[weekday(start + i) - 1]}</span>)}</div>
            {Array.from({ length: 6 }, (_, w) => (
              <div key={w} className="p-yrow">
                {Array.from({ length: 7 }, (_, c) => {
                  const d = start + w * 7 + c;
                  if (ymd(d).m !== mi + 1) return <span key={c} className="p-yday" />;
                  const n = busy.get(d) ?? 0;
                  const bg = d === t ? "var(--p-strong)" : n > 0 ? `color-mix(in srgb, var(--p-primary) ${Math.min(50, 12 + n * 10)}%, transparent)` : undefined;
                  return <span key={c} className="p-yday"><span className={d === t ? "today" : ""} style={{ background: bg }}>{ymd(d).d}</span></span>;
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
});

// ---------- Agenda (YearAgenda.kt's AgendaView) ----------

/**
 * The next 90 days as a list. Its chips (241): Events and Tasks (the Filter dialog's own two), then the Tasks
 * page's Show completed and categories, so only tasks with a category picked lists them by day.
 */
function AgendaView({ s, items, from, f, onFilters }: { s: Snapshot; items: Item[]; from: number; f: typeof filters; onFilters: (v: typeof filters) => void }) {
  const now = useNow();
  const t = todayEpoch();
  const [tf, setTfState] = useState(agendaFilter);
  const setTf = (v: TaskFilter) => { agendaFilter = v; setTfState(v); };
  const groups = useMemo(() => {
    const map = new Map<number, Occurrence[]>();
    const shown = items.filter((i) => inCategory(i, tf.category));
    for (const o of forCalendar(shown, s.done, from, from + 90, t, carryOver())) {
      if (!tf.showDone && o.item.type === "TASK" && o.completed) continue;
      const l = map.get(o.day); if (l) l.push(o); else map.set(o.day, [o]);
    }
    return [...map].sort((a, b) => a[0] - b[0]);
  }, [items, s, from, t, tf]);
  return (
    <div className="p-agenda p-rows">
      <TaskChips s={s} value={tf} onChange={setTf} className="agenda" before={<>
        <FilterChip selected={f.events} check onClick={() => onFilters({ ...f, events: !f.events })}>Events</FilterChip>
        <FilterChip selected={f.tasks} check onClick={() => onFilters({ ...f, tasks: !f.tasks })}>Tasks</FilterChip>
      </>} />
      {groups.length === 0 && <div className="p-empty pad16 body-large">Nothing in the next 90 days.</div>}
      {groups.map(([day, list]) => (
        <div key={day}>
          <div className="p-agenda-day t-title-small">{relativeDay(day)}</div>
          {list.map((o) => <OccurrenceRow key={`a${o.item.id}_${o.day}`} o={o} s={s} now={now} />)}
        </div>
      ))}
      <div style={{ height: 88 }} />
    </div>
  );
}

// ---------- Time grid (TimeGrid.kt) ----------

interface Gesture {
  id: number; x0: number; y0: number; t0: number; scroll0: number;
  block: HTMLElement | null; key: string; timer: number;
  lifted: boolean; swiping: boolean; moved: boolean;
  dx: number; dy: number; x: number; y: number;
  vt: VelocityTracker; sx: number;
  snap: string; raf: number;
  /** A mouse: a block moved with the button down is picked up at once (there's no scroll to tell it from). */
  mouse: boolean;
  /** A mouse on an event's bottom edge: dragging it changes when the event ends. */
  resize: boolean;
  /** Landed while the hours were still scrolling (a fling): that touch only stops them. */
  flung: boolean;
}

function TimeGrid({ s, items, first, count, onStep, turn, onNewAt, pending, noteDays, trainDays, onDayHeader, onDayNote }: {
  s: Snapshot; items: Item[]; first: number; count: number; onStep: (dir: number) => void; turn: (dir: 1 | -1) => void;
  onNewAt: (day: number, min: number) => void; pending: SlotPreview | null; noteDays: Set<number>; trainDays: Map<number, string>;
  onDayHeader: (d: number) => void; onDayNote: (d: number) => void;
}) {
  const slotLook = useLook("slot");
  const days = useMemo(() => Array.from({ length: count }, (_, i) => first + i), [first, count]);
  const t = todayEpoch();
  const scroller = useRef<HTMLDivElement>(null);
  // The days' row is part of the top bar for swipes: that's where the dates are.
  const headRow = useHorizontalSwipe<HTMLDivElement>(turnerSwipe("calendar", turn, () => window.innerWidth));
  const layer = useRef<HTMLDivElement>(null);
  const headDays = useRef<HTMLDivElement>(null);
  const allDayDays = useRef<HTMLDivElement>(null);
  const [hourH, setHourH] = useState(0);
  const hourRef = useRef(0);
  hourRef.current = hourH;
  const pendingScroll = useRef<number | null>(null);
  const [now, setNow] = useState(nowMinutes());
  useEffect(() => { const i = setInterval(() => setNow(nowMinutes()), 60_000); return () => clearInterval(i); }, []);
  const [ghost, setGhost] = useState<{ key: string; start: number; dDay: number; length: number; color: string; isTask: boolean } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ series: Item; day: number; edited: Item } | null>(null);

  // The days before and after are drawn too, off to each side, so a sideways swipe drags real days in
  // (like a pager) instead of empty space. Index `count` is the first day in view.
  const all = useMemo(() => Array.from({ length: count * 3 }, (_, i) => first - count + i), [first, count]);
  const carry = carryOver();
  const occ = useMemo(() => forCalendar(items, s.done, all[0], all[all.length - 1], t, carry), [items, s, all, t, carry]);
  const allDay = all.map((d) => occ.filter((o) => (!o.timed || o.multiDay) && covers(o, d)));
  // Items over several days: a bar across them in the all-day row (lanes at its top), one in each range
  // a swipe turns (so the next week's piece has its own title and edge), broken where days were taken out.
  const spanKey = (o: Occurrence) => `${o.item.id}_${o.day}`;
  const spanning = occ.filter((o) => o.endDay > o.day);
  const spanByKey = new Map(spanning.map((o) => [spanKey(o), o]));
  const adLanes = spanLanes(spanning.map((o) => ({ key: spanKey(o), from: o.day, to: o.endDay, skip: skippedDays(o) })), all[0], all[all.length - 1], count);
  // Each day's blocks are laid out once and kept (the same array) while nothing changes: a swipe to the
  // next range only lays out the days new to it, and the columns already drawn aren't drawn again.
  const dayCache = useRef<{ key: unknown[]; map: Map<number, Placed[]> }>({ key: [], map: new Map() });
  const cacheKey = [items, s, t, carry];
  if (cacheKey.some((v, i) => v !== dayCache.current.key[i])) dayCache.current = { key: cacheKey, map: new Map() };
  const layouts = (list: number[]): Placed[][] => {
    const { map } = dayCache.current;
    const missing = list.filter((d) => !map.has(d));
    if (missing.length) {
      const lo = Math.min(...missing), hi = Math.max(...missing);
      const byDay = new Map<number, Occurrence[]>();
      for (const o of forCalendar(items, s.done, lo, hi, t, carry)) {
        if (!o.timed || o.multiDay) continue;
        const l = byDay.get(o.day); if (l) l.push(o); else byDay.set(o.day, [o]);
      }
      for (const d of missing) map.set(d, layoutDay(byDay.get(d) ?? []));
      // Only the days near the ones shown are kept.
      if (map.size > count * 12) for (const d of [...map.keys()]) if (Math.abs(d - first) > count * 4) map.delete(d);
    }
    return list.map((d) => map.get(d)!);
  };
  const timed = layouts(all);
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  // The ranges after the next and before the previous are laid out while the phone is idle, so the
  // first swipe after opening doesn't wait for that work (or for the code doing it to warm up).
  useEffect(() => {
    const ahead = [...Array.from({ length: count }, (_, i) => first - 2 * count + i), ...Array.from({ length: count }, (_, i) => first + 2 * count + i)];
    return whenIdle(() => layoutsRef.current(ahead));
  }, [first, count, items, s, t, carry]);
  const placed = useRef(new Map<string, { p: Placed; di: number }>());
  placed.current = new Map();
  // Only blocks of the days in view can be picked up.
  timed.slice(count, count * 2).forEach((list, di) => list.forEach((p) => placed.current.set(`${p.o.item.id}-${p.o.day}`, { p, di })));

  const pxPerMin = hourH / 60;
  const pxRef = useRef(pxPerMin);
  pxRef.current = pxPerMin;
  // The hours' layer places each day at a spot that stays while the ranges are swiped through ([base]:
  // the day at its left edge), and the layer itself is moved to show the range in view. So after a swipe
  // the days already there keep their place and aren't painted again; only the new range is.
  const baseRef = useRef<{ base: number; count: number } | null>(null);
  const b0 = baseRef.current;
  if (!b0 || b0.count !== count || (first - b0.base) % count !== 0 || Math.abs(first - b0.base) > count * 40) baseRef.current = { base: first, count };
  const base = baseRef.current!.base;
  const shift = (first - base) / count;
  /** The layer's offset at rest (whole device pixels, so its text stays sharp), and while swiping. */
  const layerRest = useRef(0);
  const swipeX = useRef(0);
  const daysRef = useRef(days);
  daysRef.current = days;
  const props = useRef({ onStep, onNewAt, s });
  props.current = { onStep, onNewAt, s };

  // Opening: 06:00 to 24:00 fills the grid, scrolled to 06:00 (as the native app does; a few pixels
  // above, so the 06:00 label isn't cut, and the 24:00 line shows at the foot), unless a zoom was pinched before. (Measured once it has a
  // real height; later size changes keep the zoom.)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let done = false;
    const fit = () => {
      if (done || el.clientHeight < 200) return;
      done = true;
      const h = openingHourHeight(el.clientHeight, savedHour);
      hourRef.current = h;
      setHourH(h);
      pendingScroll.current = openingScrollTop(h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A zoom (or the opening fit) lands with its scroll position in the same frame.
  useLayoutEffect(() => {
    const el = scroller.current;
    // (Not before the grid has its height: the opening fit sets both in the same commit.)
    if (el && hourH > 0 && pendingScroll.current !== null) { el.scrollTop = pendingScroll.current; pendingScroll.current = null; }
  }, [hourH]);

  // After a swipe the layers sit one range over; the new days now render there, so the offset goes (the
  // hours' layer goes to its resting place for the range in view). Kept right when the width changes.
  const placeLayer = () => {
    const el = layer.current;
    if (!el) return;
    const dpr = devicePixelRatio || 1;
    layerRest.current = -Math.round(shift * el.clientWidth * dpr) / dpr;
    const x = layerRest.current + swipeX.current;
    el.style.transform = x ? `translate3d(${x}px,0,0)` : "";
  };
  const placeLayerRef = useRef(placeLayer);
  placeLayerRef.current = placeLayer;
  useLayoutEffect(() => {
    swipeX.current = 0;
    for (const el of [headDays.current, allDayDays.current]) if (el) el.style.transform = "";
    placeLayer();
  }, [first, count, base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => placeLayerRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A moved block keeps its dragged position until the grid has redrawn it in its new place.
  const clearAfterRender = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = clearAfterRender.current;
    if (el) { el.style.transform = ""; el.classList.remove("lifted"); clearAfterRender.current = null; }
  });

  // The new event's slot stays in view above the add panel.
  useEffect(() => {
    const el = scroller.current;
    if (!pending || !el || !pxPerMin) return;
    const top = pending.min * pxPerMin;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight * 0.3) el.scrollTo({ top: Math.max(0, top - el.clientHeight * 0.12), behavior: "smooth" });
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Touch handling, by hand: the browser scrolls vertically (touch-action: pan-y); sideways moves,
  // long-press drags and two-finger zooms come here. Once one of those has started, touchmove is
  // cancelled so the browser never takes the fingers over.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let g: Gesture | null = null;
    let pinch: { d0: number; h0: number } | null = null;
    let zoomRaf = 0;
    let settling: { stop: () => void; end: () => void } | null = null;
    const layers = () => [layer.current, headDays.current, allDayDays.current];
    // While the days slide, every day keeps its line (the one before the first day in view too), and
    // the lines between one range and the next are drawn in a stronger colour, so the step from week to week shows.
    const root = el.parentElement;
    let lines: HTMLElement[] | null = null;
    const moveLayers = (x: number) => {
      swipeX.current = x;
      for (const l of layers()) {
        if (!l) continue;
        const at = l === layer.current ? layerRest.current + x : x;
        l.style.transform = at ? `translate3d(${at}px,0,0)` : "";
      }
      // The lines between ranges: strongest midway, gone at rest (where the days started or end up).
      const w = layer.current?.clientWidth ?? 0;
      if (!lines) lines = root ? [...root.querySelectorAll<HTMLElement>(".pg-rangeline")] : [];
      const away = w > 0 ? Math.max(0, Math.min(Math.abs(x), w - Math.abs(x))) : 0;
      const o = away > 0.5 ? String(Math.min(1, away / (0.18 * w))) : "";
      for (const ln of lines) ln.style.opacity = o;
      if (!x) lines = null;
    };
    const colW = () => (layer.current?.clientWidth ?? 300) / daysRef.current.length;
    // When the hours last scrolled (by finger, fling or wheel).
    let lastScroll = 0;
    const onScroll = () => { lastScroll = performance.now(); };
    // The days follow 1.2 times the finger, written once per frame.
    const writeLayers = frameWriter(moveLayers);
    const swipeTo = (cur: Gesture) => {
      const w = layer.current?.clientWidth ?? 300;
      cur.sx = Math.max(-w, Math.min(w, SWIPE_GAIN * cur.dx));
      writeLayers(cur.sx);
    };

    const updateDrag = () => {
      if (!g || !g.block) return;
      const info = placed.current.get(g.key);
      if (!info) return;
      const dy = g.dy + (el.scrollTop - g.scroll0);
      g.block.style.transform = `translate3d(${g.dx}px,${dy}px,0) scale(1.03)`;
      const { p, di } = info;
      const px = pxRef.current;
      const dMin = Math.round(dy / px / 15) * 15;
      const start = Math.max(0, Math.min(DAY_MIN - 15, p.start + dMin));
      const dDay = Math.max(-di, Math.min(daysRef.current.length - 1 - di, Math.round(g.dx / colW())));
      const snap = `${start}|${dDay}`;
      if (snap !== g.snap) {
        if (g.snap) feel("tick");
        g.snap = snap;
        const isTask = p.o.item.type === "TASK";
        setGhost({ key: g.key, start, dDay, length: p.end - p.start, color: props.current.s.colorOf(p.o.item), isTask });
      }
    };

    // While dragging near the top or bottom edge, the grid scrolls by itself.
    const autoScroll = () => {
      if (!g || !g.lifted) return;
      const r = el.getBoundingClientRect();
      const edge = 56;
      let v = 0;
      if (g.y < r.top + edge) v = -Math.ceil((r.top + edge - g.y) / 4);
      else if (g.y > r.bottom - edge) v = Math.ceil((g.y - (r.bottom - edge)) / 4);
      if (v) { el.scrollTop += v; updateDrag(); }
      g.raf = requestAnimationFrame(autoScroll);
    };

    // The long-press lift: a soft pick-up, as an Android drag-and-drop; each slot passed ticks, landing settles.
    const lift = () => {
      if (!g || !g.block) return;
      g.lifted = true;
      claimSwipe(g.id);
      feel("pickup");
      g.block.classList.add("lifted");
      el.classList.add("dragging");
      updateDrag();
      g.raf = requestAnimationFrame(autoScroll);
    };

    // An event's bottom edge dragged with a mouse: its end follows, snapped to 15 minutes, the outline
    // showing the new times; letting go saves it (a repeating one on that day only, with Undo).
    const updateResize = () => {
      if (!g || !g.block) return;
      const info = placed.current.get(g.key);
      if (!info) return;
      const { p } = info;
      const px = pxRef.current;
      const dy = g.dy + (el.scrollTop - g.scroll0);
      const endMin = Math.max(p.start + 15, Math.min(DAY_MIN - 1, p.end + Math.round(dy / px / 15) * 15));
      g.block.style.height = `${Math.max(14, (endMin - p.start) * px)}px`;
      const snap = String(endMin);
      if (snap !== g.snap) {
        if (g.snap) feel("tick");
        g.snap = snap;
        setGhost({ key: g.key, start: p.start, dDay: 0, length: endMin - p.start, color: props.current.s.colorOf(p.o.item), isTask: false });
      }
    };

    const end = () => {
      if (!g) return;
      clearTimeout(g.timer);
      cancelAnimationFrame(g.raf);
      el.classList.remove("dragging");
      g = null;
    };

    const onDown = (e: PointerEvent) => {
      if (g || pinch || (e.pointerType === "mouse" && e.button !== 0)) return;
      // A finger landing while the days are still sliding finishes that at once.
      if (settling) { settling.stop(); settling.end(); }
      const block = (e.target as HTMLElement).closest<HTMLElement>(".pg-block");
      g = {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, scroll0: el.scrollTop,
        block, key: block?.dataset.key ?? "", timer: 0, lifted: false, swiping: false, moved: false,
        dx: 0, dy: 0, x: e.clientX, y: e.clientY, vt: new VelocityTracker(), sx: 0, snap: "", raf: 0, mouse: isMouse(e),
        resize: !!block && isMouse(e) && !!(e.target as HTMLElement).closest(".pg-resize"),
        flung: !isMouse(e) && performance.now() - lastScroll < 120,
      };
      g.vt.add(e.timeStamp, e.clientX);
      if (block && !g.resize) g.timer = window.setTimeout(lift, LONG_PRESS_MS);
    };

    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      g.x = e.clientX; g.y = e.clientY;
      g.dx = e.clientX - g.x0; g.dy = e.clientY - g.y0;
      g.vt.addEvent(e, "x");
      if (g.resize) {
        if (!g.moved && Math.abs(g.dy) > 2) g.moved = true;
        if (g.moved) updateResize();
        return;
      }
      if (g.lifted) { updateDrag(); return; }
      if (g.swiping) { swipeTo(g); return; }
      if (Math.abs(g.dx) > TOUCH_SLOP || Math.abs(g.dy) > TOUCH_SLOP) {
        g.moved = true;
        clearTimeout(g.timer);
        if (g.mouse && g.block) { lift(); return; }
        // (A sideways swipe here changes tab by default: the tab pager takes it, 300.)
        if (Math.abs(g.dx) > Math.abs(g.dy) * 1.2 && !swipeTabs()) { g.swiping = true; g.x0 += Math.sign(g.dx) * TOUCH_SLOP; g.dx = e.clientX - g.x0; swipeTo(g); }
      }
    };

    /** Lets the days go: on to the next range, or back, on the pager's spring (no buzz, as native). [to]: a key's or trackpad's turn. */
    const settleSwipe = (dx: number, vx: number, to?: 1 | -1) => {
      writeLayers.cancel();
      const w = layer.current?.clientWidth ?? 300;
      const dir = to ?? pageTarget(dx, vx, w);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        settling = null;
        moveLayers(-dir * w);
        if (dir) props.current.onStep(dir); // the new days render there, then the offset is dropped
        else moveLayers(0);
      };
      settling = { stop: spring(dx, -dir * w, vx, moveLayers, finish), end: finish };
    };

    // Whatever happens in [up], the gesture ends: a throw mustn't leave the grid ignoring every touch.
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      try { up(e); } finally { end(); }
    };
    const up = (e: PointerEvent) => {
      const cur = g!;
      if (cur.resize) {
        const info = placed.current.get(cur.key);
        setGhost(null);
        if (cur.block) cur.block.style.height = "";
        if (info && cur.snap && Number(cur.snap) !== info.p.end) { feel("settle"); setEventEnd(info.p.o, Number(cur.snap)); }
        return;
      }
      if (cur.lifted) {
        const info = placed.current.get(cur.key);
        const snap = cur.snap.split("|").map(Number);
        setGhost(null);
        if (info && cur.block) {
          const { p } = info;
          const dMin = snap[0] - p.start, dDay = snap[1];
          feel("settle");
          if (!dMin && !dDay) {
            // Not moved: back into place.
            cur.block.animate([{ transform: cur.block.style.transform }, { transform: "none" }], { duration: 160, easing: "ease-out" });
            cur.block.style.transform = "";
            cur.block.classList.remove("lifted");
          } else {
            const edited = moved(p.o, dDay, dMin);
            if (isRecurring(p.o.item)) {
              cur.block.style.transform = "";
              cur.block.classList.remove("lifted");
              setPendingMove({ series: p.o.item, day: p.o.day, edited });
            } else {
              clearAfterRender.current = cur.block;
              saveItem(edited);
            }
          }
        }
      } else if (cur.swiping) {
        settleSwipe(cur.sx, SWIPE_GAIN * cur.vt.velocity(e.timeStamp));
      } else if (!cur.moved) {
        clearTimeout(cur.timer);
        if (cur.block) {
          const info = placed.current.get(cur.key);
          if (info) openItem(info.p.o.item, info.p.o.day);
        } else if (layer.current && (e.target as HTMLElement).closest(".pg-layer") && !cur.flung && Math.abs(el.scrollTop - cur.scroll0) < 2) {
          // An empty slot: one tap opens the add panel there, with the new event's box (rounded down to
          // the half hour, like the native grid), as Google Calendar does. Only a real tap: not a touch
          // that scrolled the hours, nor one that stopped them scrolling.
          // (Measured on the grid: the layer itself is moved to show the range in view.)
          const r = (layer.current.parentElement ?? layer.current).getBoundingClientRect();
          const di = Math.max(0, Math.min(daysRef.current.length - 1, Math.floor((e.clientX - r.left) / colW())));
          const min = Math.max(0, Math.min(DAY_MIN - 30, Math.floor((e.clientY - r.top) / pxRef.current / 30) * 30));
          props.current.onNewAt(daysRef.current[di], min);
        }
      }
    };

    const onCancel = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      // The browser took the finger for scrolling.
      if (g.swiping) settleSwipe(g.sx, 0);
      if (g.lifted && g.block) { g.block.style.transform = ""; g.block.classList.remove("lifted"); setGhost(null); }
      if (g.resize) { if (g.block) g.block.style.height = ""; setGhost(null); }
      end();
    };

    // ----- Two-finger zoom (TimeGrid.kt): the hour height follows the fingers' spread, the spot
    // between them stays put, and the zoom is kept for next time. Read from touch events, which
    // keep coming for both fingers whatever the pointer events do.
    const spread = (tl: TouchList) => Math.hypot(tl[0].clientX - tl[1].clientX, tl[0].clientY - tl[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinch || g?.lifted) return;
      // A second finger turns whatever the first one started into a zoom.
      if (g) { clearTimeout(g.timer); if (g.swiping) { writeLayers.cancel(); moveLayers(0); } end(); }
      pinch = { d0: spread(e.touches), h0: hourRef.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (pinch && e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        const d = spread(e.touches);
        const fy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - el.getBoundingClientRect().top;
        const newH = pinchHourHeight(pinch.h0, pinch.d0, d, el.clientHeight / 24);
        cancelAnimationFrame(zoomRaf);
        zoomRaf = requestAnimationFrame(() => {
          const oldH = hourRef.current;
          if (Math.abs(newH - oldH) < 0.05) return;
          pendingScroll.current = zoomScrollTop(el.scrollTop, fy, oldH, newH);
          hourRef.current = newH;
          setHourH(newH);
        });
        return;
      }
      if (g && (g.lifted || g.swiping) && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) {
        pinch = null;
        savedHour = hourRef.current;
        localStorage.setItem(ZOOM_KEY, String(Math.round(savedHour * 10) / 10));
      }
    };
    const noMenu = (e: Event) => e.preventDefault();

    // ----- Mouse and keyboard: ← → and a sideways trackpad swipe turn the days, as a flick would;
    // Ctrl+wheel (a trackpad's pinch) zooms like two fingers, about the pointer.
    const stepRange = (dir: 1 | -1) => {
      if (g || pinch) return;
      if (settling) { settling.stop(); settling.end(); }
      settleSwipe(0, 0, dir);
    };
    const undoDesk = deskPager(el, stepRange, undefined, () => !swipeTabs());
    let turnX = 0;
    const turner: PageTurner = {
      start: () => { if (settling) { settling.stop(); settling.end(); } turnX = 0; },
      move: (dx) => {
        const w = layer.current?.clientWidth ?? 300;
        turnX = Math.max(-w, Math.min(w, SWIPE_GAIN * dx));
        writeLayers(turnX);
      },
      end: (vx) => settleSwipe(turnX, SWIPE_GAIN * vx),
      turn: stepRange,
    };
    turners.calendar.current = turner;
    let zoomTarget = 0, zoomY = 0, saveTimer = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || g?.lifted || pinch) return;
      e.preventDefault(); // not the browser's own zoom
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      zoomTarget = wheelZoom(zoomTarget || hourRef.current, e.deltaY * unit, el.clientHeight / 24, MAX_HOUR_HEIGHT);
      zoomY = e.clientY - el.getBoundingClientRect().top;
      cancelAnimationFrame(zoomRaf);
      zoomRaf = requestAnimationFrame(() => {
        const oldH = hourRef.current, newH = zoomTarget;
        zoomTarget = 0;
        if (Math.abs(newH - oldH) < 0.05) return;
        pendingScroll.current = zoomScrollTop(el.scrollTop, zoomY, oldH, newH);
        hourRef.current = newH;
        setHourH(newH);
      });
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        savedHour = hourRef.current;
        localStorage.setItem(ZOOM_KEY, String(Math.round(savedHour * 10) / 10));
      }, 400);
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("contextmenu", noMenu);
    return () => {
      if (turners.calendar.current === turner) turners.calendar.current = null;
      end();
      settling?.stop();
      cancelAnimationFrame(zoomRaf);
      clearTimeout(saveTimer);
      undoDesk();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  const colPct = 100 / count;
  const compact = days.length > 3;
  const hasAllDay = allDay.some((l) => l.length);

  return (
    <div className="pg">
      <div className="pg-head" ref={headRow}>
        <div className="pg-gutter" />
        <div className="pg-head-days"><div className="pg-strip" ref={headDays}>
          {[0, 1, 2].map((k) => <span key={`l${k}`} className="pg-rangeline" style={{ left: `${(k * 100) / 3}%` }} />)}
          {all.map((d, j) => count === 1 ? (
            // One day: its date fills the header (the number large, the weekday and month beside it).
            <div key={d} className={`pg-dh one ${d === t ? "today" : ""}`} role="button" onClick={() => onDayHeader(d)}>
              <span className="num">{ymd(d).d}</span>
              <span className="when">
                <span className="wdl">{WEEKDAYS_LONG[weekday(d) - 1]}</span>
                <span className="my">{monthLong(ymd(d).m)} {ymd(d).y}</span>
              </span>
              {trainDays.has(d) && (
                <button className="note" aria-label="Training" onClick={(e) => { e.stopPropagation(); go(`training?d=${d}`); }}><MIcon name={trainDays.get(d)!} size={16} /></button>
              )}
              <button className="note" onClick={(e) => { e.stopPropagation(); onDayNote(d); }}>{noteDays.has(d) ? "Note" : "＋ note"}</button>
            </div>
          ) : (
            <div key={d} className={`pg-dh ${d === t ? "today" : ""} ${j % count === 0 ? "range" : ""}`} role="button" onClick={() => onDayHeader(d)}>
              <span className="wd">{NARROW[weekday(d) - 1]}</span>
              <span className="num">{ymd(d).d}</span>
              {trainDays.has(d) && <span className="tr-mark"><MIcon name={trainDays.get(d)!} size={11} /></span>}
              {count <= 3 && (
                <button className="note" onClick={(e) => { e.stopPropagation(); onDayNote(d); }}>{noteDays.has(d) ? "Note" : "＋ note"}</button>
              )}
            </div>
          ))}
        </div></div>
      </div>
      {hasAllDay && (
        <div className="pg-allday">
          <div className="pg-gutter">all-day</div>
          <div className="pg-allday-days"><div className="pg-strip" ref={allDayDays}>
            {allDay.map((list, i) => {
              const room = Math.min(3, lanesOver(adLanes, i));
              const own = list.filter((o) => o.endDay === o.day).slice(0, 3 - room);
              const more = list.length - own.length - barsShownOver(adLanes, i, 3);
              return (
                <div key={i} className={`pg-adcol ${i % count === 0 ? "range" : ""}`}>
                  {room > 0 && <span className="pg-adspace" style={{ height: room * 17 }} />}
                  {own.map((o) => <AllDayChip key={o.item.id} o={o} s={s} />)}
                  {more > 0 && <span className="more">+{more}</span>}
                </div>
              );
            })}
            <SpanBars lanes={adLanes} cap={3} cols={all.length} byKey={spanByKey} s={s} className="pg-chip pg-bar" open />
            {[0, 1, 2].map((k) => <span key={`l${k}`} className="pg-rangeline" style={{ left: `${(k * 100) / 3}%` }} />)}
          </div></div>
        </div>
      )}
      <div className="pg-scroll" ref={scroller} style={{ visibility: hourH ? undefined : "hidden" }}>
        <div className="pg-body" style={{ height: hourH * 24, ["--hour" as string]: `${hourH}px` }}>
          <div className="pg-labels">
            {Array.from({ length: 24 }, (_, h) => <div key={h} style={{ height: hourH }}>{h ? <span>{formatTime(h * 60)}</span> : null}</div>)}
            {/* The new event's edge being dragged: its time on its line (Google Calendar's). */}
            {pending?.edge && days.includes(pending.day) && (() => {
              const m = pending.edge === "top" ? pending.min : pending.end;
              return <span className="pg-edgetime" style={{ top: m * pxPerMin, color: pending.color }}>{formatTime(m)}</span>;
            })()}
          </div>
          <div className="pg-grid">
            <div className="pg-layer" ref={layer}>
              {[-1, 0, 1].map((k) => <span key={`l${k}`} className="pg-rangeline" style={{ left: `${(shift + k) * 100}%` }} />)}
              {all.map((d, j) => (
                <DayColumn key={d} left={`${(d - base) * colPct}%`} width={`${colPct}%`} blocks={timed[j]} s={s} pxPerMin={pxPerMin} compact={compact}
                  now={d === t ? now : null} />
              ))}
              {ghost && (() => {
                const info = placed.current.get(ghost.key);
                if (!info) return null;
                const di = info.di + ghost.dDay;
                return (
                  <div className="pg-ghost" style={{
                    left: `${(first - base + di) * colPct}%`, width: `${colPct}%`, top: ghost.start * pxPerMin, height: Math.max(18, ghost.length * pxPerMin),
                    ["--c" as string]: ghost.color,
                  }}>{ghost.isTask ? formatTime(ghost.start) : `${formatTime(ghost.start)}–${formatTime(Math.min(DAY_MIN - 1, ghost.start + ghost.length))}`}</div>
                );
              })()}
              {/* Where the new event goes, while the panel is open: its outline in its colour (the look
                  picked in looks.ts), with the title typed so far and its times. Its handles drag to change
                  the times (AddPanel takes the finger, over its scrim). */}
              {pending && all.includes(pending.day) && (
                <div className={`pg-slot pending look-${slotLook.toLowerCase()} ${pending.edge ? `drag-${pending.edge}` : ""}`} data-ppm={pxPerMin} style={{
                  left: `calc(${(pending.day - base) * colPct}% + 1px)`, width: `calc(${colPct}% - 2px)`, top: pending.min * pxPerMin,
                  height: Math.max(22, (pending.end - pending.min) * pxPerMin), color: pending.color,
                }}>
                  <div className={`pg-slot-lab ${(pending.end - pending.min) * pxPerMin < 34 ? "one" : ""}`}>
                    <b>{pending.title?.trim() || "(No title)"}</b>
                    <i>{formatTime(pending.min)}–{formatTime(pending.end)}</i>
                  </div>
                  {pending.resizable && <><span className="edge top" /><span className="edge bottom" /></>}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* A little room under the 24:00 line, so it shows clear of the bottom edge. */}
        <div style={{ height: END_ROOM }} />
      </div>
      {pendingMove && (
        <ScopeDialog title="Move repeating item" onCancel={() => setPendingMove(null)} onPick={(scope: EditScope) => {
          const { series, day, edited } = pendingMove;
          if (scope === "THIS") saveSeriesEdit("THIS", series, day, edited);
          else {
            const delta = (edited.startDay ?? day) - day;
            const shifted = { ...series, startDay: (series.startDay ?? day) + delta, endDay: series.endDay !== null ? series.endDay + delta : null, startMin: edited.startMin, endMin: edited.endMin };
            saveSeriesEdit(scope, series, day, scope === "FOLLOWING" ? { ...shifted, startDay: edited.startDay, endDay: edited.endDay } : shifted);
          }
          setPendingMove(null);
        }} />
      )}
    </div>
  );
}

/** The item moved by [dDay] days and [dMin] minutes, keeping its length (same rules as the PC grid). */
function moved(o: Occurrence, dDay: number, dMin: number): Item {
  const start = o.startMin ?? 0;
  const newDay = o.day + dDay;
  const newStart = Math.max(0, Math.min(DAY_MIN - 15, start + dMin));
  if (o.item.type === "TASK") return { ...o.item, startDay: newDay, startMin: newStart };
  const dur = Math.max(15, (o.endMin ?? start + 60) - start);
  return { ...o.item, startDay: newDay, endDay: newDay, startMin: newStart, endMin: Math.min(DAY_MIN - 1, newStart + dur) };
}

/**
 * One day's column of blocks over the hours. Memoized: a day already drawn isn't drawn again while its
 * blocks, the zoom and the data stay the same (as when the ranges are swiped through).
 */
const DayColumn = memo(function DayColumn({ left, width, blocks, s, pxPerMin, compact, now }: {
  left: string; width: string; blocks: Placed[]; s: Snapshot; pxPerMin: number; compact: boolean; now: number | null;
}) {
  return (
    <div className="pg-col" style={{ left, width }}>
      {blocks.map((p) => <Block key={`${p.o.item.id}-${p.o.day}`} p={p} s={s} pxPerMin={pxPerMin} compact={compact} />)}
      {now !== null && <div className="pg-now" style={{ transform: `translate3d(0,${now * pxPerMin}px,0)` }} />}
    </div>
  );
});

/** Runs [fn] once the phone is idle (soon in any case); returns how to call it off. */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") { const h = requestIdleCallback(fn, { timeout: 1500 }); return () => cancelIdleCallback(h); }
  const h = window.setTimeout(fn, 300);
  return () => clearTimeout(h);
}

/** Days taken out of an item over several days (excluded days inside its run): its bar breaks there. */
const skipCache = new WeakMap<Item, number[]>();
function skippedDays(o: Occurrence): number[] {
  if (o.endDay <= o.day || !o.item.excludedDays) return [];
  let days = skipCache.get(o.item);
  if (!days) { days = [...parseDays(o.item.excludedDays)]; skipCache.set(o.item, days); }
  return days.filter((d) => d > o.day && d <= o.endDay);
}
/** Whether [o] is on day [d] (a day taken out of a run of days isn't). */
const covers = (o: Occurrence, d: number) => o.day <= d && d <= o.endDay && (o.endDay === o.day || !skippedDays(o).includes(d));

function Block({ p, s, pxPerMin, compact }: { p: Placed; s: Snapshot; pxPerMin: number; compact: boolean }) {
  const isTask = p.o.item.type === "TASK";
  // A routine event has a tick too (ticked on Today or in its window).
  const ticks = isTask || isRoutineItem(p.o.item);
  const c = s.colorOf(p.o.item);
  const h = Math.max(14, (p.end - p.start) * pxPerMin);
  const tiny = h < 22;
  return (
    <div className={`pg-block ${tiny ? "tiny" : ""} ${isTask ? "task" : ""} ${p.o.completed ? "done" : ""}`} data-key={`${p.o.item.id}-${p.o.day}`}
      style={{
        top: p.start * pxPerMin, height: h, left: `${(p.col / p.cols) * 100}%`, width: `${100 / p.cols}%`, ["--c" as string]: c,
      }}>
      <b className={h >= 36 ? "two" : ""} style={{ textDecoration: p.o.completed ? "line-through" : undefined }}>
        {ticks && <span className={`pg-tick ${p.o.completed ? "on" : ""}`}>{p.o.completed && <MIcon name="fCheck" size={8} />}</span>}
        {displayTitle(p.o.item)}
      </b>
      {h >= 40 && !isTask && <span className="tm">{compact ? formatTime(p.start) : `${formatTime(p.start)}–${formatTime(Math.min(DAY_MIN - 1, p.end))}`}</span>}
      {/* The bottom edge, for a mouse: drag it to change when the event ends (wide.css shows it to a mouse only). */}
      {!isTask && h >= 24 && <span className="pg-resize" aria-hidden="true" />}
    </div>
  );
}

/**
 * The bars of items over several days, over a row of [cols] day columns: each from its first day to its
 * last in the row, in its lane (the first [cap] lanes are drawn). [open]: a tap opens the item.
 */
function SpanBars({ lanes, cap, cols, byKey, s, className, open }: {
  lanes: Lane[]; cap: number; cols: number; byKey: Map<string, Occurrence>; s: Snapshot; className: string; open?: boolean;
}) {
  return (
    <div className="p-spanbars" aria-hidden={!open}>
      {lanes.filter((l) => l.lane < cap).map((l) => {
        const o = byKey.get(l.key);
        if (!o) return null;
        const c = o.overdue ? "var(--danger)" : s.colorOf(o.item);
        const isTask = o.item.type === "TASK";
        return (
          <span key={`${l.key}@${l.first}`} className={`${className} ${isTask ? "task" : ""}`} role={open ? "button" : undefined}
            onClick={open ? () => openItem(o.item, o.day) : undefined}
            style={{
              ["--lane" as string]: l.lane, left: `calc(${(l.first / cols) * 100}% + 2px)`, width: `calc(${((l.last - l.first + 1) / cols) * 100}% - 4px)`,
              ["--c" as string]: c, textDecoration: o.completed ? "line-through" : undefined,
            }}>{displayTitle(o.item)}</span>
        );
      })}
    </div>
  );
}

function AllDayChip({ o, s }: { o: Occurrence; s: Snapshot }) {
  const c = o.overdue ? "var(--danger)" : s.colorOf(o.item);
  const isTask = o.item.type === "TASK";
  return (
    <div className={`pg-chip ${isTask ? "task" : ""}`} role="button" onClick={() => openItem(o.item, o.day)}
      style={{ ["--c" as string]: c, textDecoration: o.completed ? "line-through" : undefined }}>
      {displayTitle(o.item)}
    </div>
  );
}
