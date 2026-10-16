// The calendar on the phone, as CalendarScreen.kt: the title and its arrow / today / view buttons, a
// view menu (Day, 3 days, Week, Month, Year, Agenda, then Filter, the day's note, Search, Settings),
// and the views themselves. The day / 3-day / week time grid scrolls natively, zooms with two
// fingers, moves an event on long-press-and-drag (snapped to 15 minutes), adds one on a tap on an
// empty slot, and slides sideways like a pager to the days before and after. Month and Year slide the
// same way.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addMonths, epochOf, formatDate, formatDateShort, formatTime, monthLong, monthShort, nowMinutes, relativeDay, startOfWeek, today as todayEpoch, weekday, ymd } from "../../domain/dates.ts";
import { forCalendar, type Occurrence, type TaskEntry } from "../../domain/schedule.ts";
import { type Item, displayTitle, isRecurring } from "../../domain/types.ts";
import { type EditScope, saveItem, saveSeriesEdit, type Snapshot, useSnapshot } from "../../store/store.ts";
import { type Placed, layoutDay } from "../CalendarView.tsx";
import { EventRow, TaskRow, go, openItem, useNow } from "../common.tsx";
import { ScopeDialog } from "../ItemEditor.tsx";
import type { SlotPreview } from "./AddPanel.tsx";
import { Checkbox, Dialog, DropdownMenu, IconButton, MIcon, type MenuItem } from "./chrome.tsx";
import { hapticLift } from "./native.ts";
import { pageTarget, spring, useSwipePager } from "./pager.ts";
import { TOUCH_SLOP } from "./press.ts";
import { openingHourHeight, pinchHourHeight, zoomScrollTop } from "./zoom.ts";

type Mode = "day" | "3day" | "week" | "month" | "year" | "agenda";
const MODES: [Mode, string][] = [["day", "Day"], ["3day", "3 days"], ["week", "Week"], ["month", "Month"], ["year", "Year"], ["agenda", "Agenda"]];
const NARROW = ["M", "T", "W", "T", "F", "S", "S"];
const mondayFirst = () => localStorage.getItem("weekStartsMonday") !== "false";
const DAY_MIN = 1440;
const LONG_PRESS_MS = 400;
const ZOOM_KEY = "calHourHeight";

// Kept while moving around the app, like the native CalendarState.
let selected = todayEpoch();
let filters = { events: true, tasks: true, hidden: new Set<number>() };
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
  savedHour = null;
  localStorage.removeItem(ZOOM_KEY);
}

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
  const setAnchor = (d: number) => { selected = d; setAnchorState(d); };
  const setFilters = (n: typeof filters) => { filters = n; setF(n); };
  /** Picked in the menu: remembered, like the native calendarView setting. */
  const pickMode = (m: Mode) => { localStorage.setItem("calModePhone", m); setMode(m); };

  const step = (dir: number) => setAnchor(
    mode === "day" ? anchor + dir : mode === "3day" ? anchor + 3 * dir : mode === "week" || mode === "agenda" ? anchor + 7 * dir
      : mode === "month" ? addMonths(anchor, dir) : addMonths(anchor, 12 * dir));
  const { y, m } = ymd(anchor);
  const weekStart = startOfWeek(anchor, mondayFirst());
  const title = mode === "year" ? String(y) : mode === "day" ? formatDateShort(anchor) : mode === "month" || mode === "agenda" ? `${monthLong(m)} ${y}`
    : `${monthShort(ymd(mode === "week" ? weekStart : anchor).m)} ${ymd(mode === "week" ? weekStart : anchor).y}`;
  const first = mode === "week" ? weekStart : anchor;
  const count = mode === "day" ? 1 : mode === "3day" ? 3 : 7;
  const items = useMemo(() => s.items.filter((i) =>
    ((i.type === "EVENT" && f.events) || (i.type === "TASK" && f.tasks)) && (i.categoryId === null || !f.hidden.has(i.categoryId))), [s, f]);
  const noteDays = useMemo(() => new Set(s.items.filter((i) => i.type === "NOTE" && i.noteDay !== null).map((i) => i.noteDay!)), [s]);
  const grid = mode === "day" || mode === "3day" || mode === "week";

  const menuItems: MenuItem[] = [
    ...MODES.map(([k, l]): MenuItem => ({ label: l, checked: mode === k, onClick: () => pickMode(k) })),
    { label: "Filter…", icon: "oFilterList", divider: true, onClick: () => setFilterOpen(true) },
    { label: "Note for selected day", icon: "oEditNote", onClick: () => openDailyNote(s, anchor) },
    { label: "Search", icon: "oSearch", onClick: () => go("browse") },
    { label: "Settings", icon: "oSettings", onClick: () => go("settings") },
  ];

  return (
    <div className="p-scaffold p-cal">
      <div className="p-statusbar" />
      <header className="p-calhead">
        <h2 className="t-title-medium">{title}</h2>
        <IconButton icon="fArrowBack" label="Previous" onClick={() => step(-1)} />
        <IconButton icon="oToday" label="Today" onClick={() => setAnchor(todayEpoch())} />
        <IconButton icon="fArrowForward" label="Next" onClick={() => step(1)} />
        <div className="p-menu-anchor">
          <IconButton icon="oViewAgenda" label="View" onClick={() => setMenu(true)} />
          <DropdownMenu open={menu} onClose={() => setMenu(false)} items={menuItems} />
        </div>
      </header>
      <div className="p-calbody">
        {grid && <TimeGrid s={s} items={items} first={first} count={count} onStep={step} onNewAt={onNewAt} pending={pending} noteDays={noteDays}
          onDayHeader={(d) => { setAnchor(d); setMode("day"); }} onDayNote={(d) => openDailyNote(s, d)} />}
        {mode === "month" && <MonthView s={s} items={items} anchor={anchor} noteDays={noteDays} onStep={step}
          onPick={(d) => { if (d === anchor) setMode("day"); else setAnchor(d); }}
          onLong={(d) => { setAnchor(d); onNewAt(d, 9 * 60); }} onDayNote={(d) => openDailyNote(s, d)} />}
        {mode === "year" && <YearView s={s} items={items} anchor={anchor} onStep={step} onMonth={(d) => { setAnchor(d); setMode("month"); }} />}
        {mode === "agenda" && <AgendaView s={s} items={items} from={anchor} />}
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

function MonthView({ s, items, anchor, noteDays, onStep, onPick, onLong, onDayNote }: {
  s: Snapshot; items: Item[]; anchor: number; noteDays: Set<number>; onStep: (dir: number) => void;
  onPick: (d: number) => void; onLong: (d: number) => void; onDayNote: (d: number) => void;
}) {
  const now = useNow();
  const t = todayEpoch();
  const strip = useRef<HTMLDivElement>(null);
  const pager = useSwipePager<HTMLDivElement>({
    layers: () => [strip.current], onStep: (dir) => onStep(dir),
  });
  const months = [monthOf(addMonths(anchor, -1)), monthOf(anchor), monthOf(addMonths(anchor, 1))];
  const dayList = useMemo(() => forCalendar(items, s.done, anchor, anchor, t).filter((o) => o.day <= anchor && o.endDay >= anchor), [items, s, anchor, t]);
  return (
    <div className="p-monthview">
      <div className="p-hpager" ref={pager}>
        <div className="p-hstrip" ref={strip}>
          {months.map((first, i) => (
            <div key={first} className={`p-hpanel ${i === 1 ? "cur" : ""}`} style={{ left: `${(i - 1) * 100}%` }} aria-hidden={i !== 1}>
              <MonthGrid s={s} items={items} first={first} t={t} selected={i === 1 ? anchor : null} noteDays={noteDays} onPick={onPick} onLong={onLong} />
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

const MonthGrid = memo(function MonthGrid({ s, items, first, t, selected, noteDays, onPick, onLong }: {
  s: Snapshot; items: Item[]; first: number; t: number; selected: number | null; noteDays: Set<number>;
  onPick: (d: number) => void; onLong: (d: number) => void;
}) {
  const start = startOfWeek(first, mondayFirst());
  const days = Array.from({ length: 42 }, (_, i) => start + i);
  const month = ymd(first).m;
  const occ = useMemo(() => forCalendar(items, s.done, days[0], days[41], t), [items, s, first, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = useMemo(() => {
    const map = new Map<number, Occurrence[]>();
    for (const o of occ) for (let d = Math.max(o.day, days[0]); d <= Math.min(o.endDay, days[41]); d++) { const l = map.get(d); if (l) l.push(o); else map.set(d, [o]); }
    return map;
  }, [occ]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = ymd(days[35]).m !== month ? 5 : 6;
  const maxShown = rows === 5 ? 3 : 2;
  const press = useLongPress(onLong, onPick);
  return (
    <div className="p-mgrid">
      <div className="p-mweek">{days.slice(0, 7).map((d) => <span key={d}>{NARROW[weekday(d) - 1]}</span>)}</div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="p-mrow" style={{ height: rows === 5 ? 78 : 66 }}>
          {days.slice(r * 7, r * 7 + 7).map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={d} className={`p-mcell ${d === selected ? "sel" : ""}`} role="button" {...press(d)}>
                <div className="p-mnum-row">
                  <span className={`p-mnum ${d === t ? "today" : ""} ${ymd(d).m !== month ? "out" : ""}`}>{ymd(d).d}</span>
                  {noteDays.has(d) && <MIcon name="oEditNote" size={11} />}
                </div>
                {list.slice(0, maxShown).map((o) => {
                  const c = o.overdue ? "var(--danger)" : s.colorOf(o.item);
                  const isTask = o.item.type === "TASK";
                  return (
                    <span key={`${o.item.id}_${o.day}`} className="p-mchip" style={{
                      background: isTask ? `color-mix(in srgb, ${c} 15%, transparent)` : c, color: isTask ? c : onColor(c),
                      textDecoration: o.completed ? "line-through" : undefined,
                    }}>{displayTitle(o.item)}</span>
                  );
                })}
                {list.length > maxShown && <span className="p-mmore">+{list.length - maxShown}</span>}
              </div>
            );
          })}
        </div>
      ))}
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
      p.timer = window.setTimeout(() => { p.fired = true; hapticLift(); cb.current.onLong(d); }, 500);
      st.current = p;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = st.current;
      if (p && (Math.abs(e.clientX - p.x) > TOUCH_SLOP || Math.abs(e.clientY - p.y) > TOUCH_SLOP)) { clearTimeout(p.timer); st.current = null; }
    },
    onPointerUp: () => { const p = st.current; if (p) clearTimeout(p.timer); },
    onPointerCancel: () => { const p = st.current; if (p) clearTimeout(p.timer); st.current = null; },
    onClick: () => { const p = st.current; st.current = null; if (!p?.fired) cb.current.onTap(d); },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
}

// ---------- Year (YearAgenda.kt's YearView) ----------

function YearView({ s, items, anchor, onStep, onMonth }: { s: Snapshot; items: Item[]; anchor: number; onStep: (dir: number) => void; onMonth: (first: number) => void }) {
  const y = ymd(anchor).y;
  const t = todayEpoch();
  const strip = useRef<HTMLDivElement>(null);
  const pager = useSwipePager<HTMLDivElement>({
    layers: () => [strip.current], onStep: (dir) => onStep(dir),
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
    for (const o of forCalendar(items, s.done, epochOf(year, 1, 1), epochOf(year, 12, 31), t)) counts.set(o.day, (counts.get(o.day) ?? 0) + 1);
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
                  const bg = d === t ? "var(--p-primary)" : n > 0 ? `color-mix(in srgb, var(--p-primary) ${Math.min(50, 12 + n * 10)}%, transparent)` : undefined;
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

function AgendaView({ s, items, from }: { s: Snapshot; items: Item[]; from: number }) {
  const now = useNow();
  const t = todayEpoch();
  const groups = useMemo(() => {
    const map = new Map<number, Occurrence[]>();
    for (const o of forCalendar(items, s.done, from, from + 90, t)) { const l = map.get(o.day); if (l) l.push(o); else map.set(o.day, [o]); }
    return [...map].sort((a, b) => a[0] - b[0]);
  }, [items, s, from, t]);
  return (
    <div className="p-agenda p-rows">
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
  vx: number; lastX: number; lastT: number;
  snap: string; raf: number;
}

function TimeGrid({ s, items, first, count, onStep, onNewAt, pending, noteDays, onDayHeader, onDayNote }: {
  s: Snapshot; items: Item[]; first: number; count: number; onStep: (dir: number) => void;
  onNewAt: (day: number, min: number) => void; pending: SlotPreview | null; noteDays: Set<number>;
  onDayHeader: (d: number) => void; onDayNote: (d: number) => void;
}) {
  const days = useMemo(() => Array.from({ length: count }, (_, i) => first + i), [first, count]);
  const t = todayEpoch();
  const scroller = useRef<HTMLDivElement>(null);
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
  // An empty slot tapped once is only marked; a second tap on the marked slot opens the add panel there.
  const [armed, setArmedState] = useState<{ day: number; min: number } | null>(null);
  const armedRef = useRef(armed);
  const setArmed = (a: { day: number; min: number } | null) => { armedRef.current = a; setArmedState(a); };

  // The days before and after are drawn too, off to each side, so a sideways swipe drags real days in
  // (like a pager) instead of empty space. Index `count` is the first day in view.
  const all = useMemo(() => Array.from({ length: count * 3 }, (_, i) => first - count + i), [first, count]);
  const occ = useMemo(() => forCalendar(items, s.done, all[0], all[all.length - 1], t), [items, s, all, t]);
  const allDay = all.map((d) => occ.filter((o) => (!o.timed || o.multiDay) && o.day <= d && o.endDay >= d));
  const timed = useMemo(() => all.map((d) => layoutDay(occ.filter((o) => o.timed && !o.multiDay && o.day === d))), [occ, all]);
  const placed = useRef(new Map<string, { p: Placed; di: number }>());
  placed.current = new Map();
  // Only blocks of the days in view can be picked up.
  timed.slice(count, count * 2).forEach((list, di) => list.forEach((p) => placed.current.set(`${p.o.item.id}-${p.o.day}`, { p, di })));

  const pxPerMin = hourH / 60;
  const pxRef = useRef(pxPerMin);
  pxRef.current = pxPerMin;
  const daysRef = useRef(days);
  daysRef.current = days;
  const props = useRef({ onStep, onNewAt, s });
  props.current = { onStep, onNewAt, s };

  // Opening: 06:00 to 24:00 fills the grid, scrolled to 06:00 (as the native app does), unless a zoom
  // was pinched before. (Measured once it has a real height; later size changes keep the zoom.)
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
      pendingScroll.current = h * 6;
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

  // After a swipe the layers sit one range over; the new days now render there, so the offset goes.
  useLayoutEffect(() => {
    for (const el of [layer.current, headDays.current, allDayDays.current]) if (el) el.style.transform = "";
    scroller.current?.parentElement?.classList.remove("swiping");
  }, [first]);
  // A marked slot is forgotten once the panel has opened (or another range is shown).
  useEffect(() => { if (pending) setArmed(null); }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setArmed(null); }, [first, count]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const moveLayers = (x: number) => {
      for (const l of layers()) if (l) l.style.transform = x ? `translate3d(${x}px,0,0)` : "";
      root?.classList.toggle("swiping", x !== 0);
    };
    const colW = () => (layer.current?.clientWidth ?? 300) / daysRef.current.length;

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

    // The long-press lift is the one place with a buzz, as an Android drag-and-drop pick-up.
    const lift = () => {
      if (!g || !g.block) return;
      g.lifted = true;
      hapticLift();
      g.block.classList.add("lifted");
      el.classList.add("dragging");
      updateDrag();
      g.raf = requestAnimationFrame(autoScroll);
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
        dx: 0, dy: 0, x: e.clientX, y: e.clientY, vx: 0, lastX: e.clientX, lastT: e.timeStamp, snap: "", raf: 0,
      };
      if (block) g.timer = window.setTimeout(lift, LONG_PRESS_MS);
    };

    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      g.x = e.clientX; g.y = e.clientY;
      g.dx = e.clientX - g.x0; g.dy = e.clientY - g.y0;
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) { g.vx = 0.6 * ((e.clientX - g.lastX) / dt) + 0.4 * g.vx; g.lastX = e.clientX; g.lastT = e.timeStamp; }
      if (g.lifted) { updateDrag(); return; }
      if (g.swiping) { moveLayers(g.dx); return; }
      if (Math.abs(g.dx) > TOUCH_SLOP || Math.abs(g.dy) > TOUCH_SLOP) {
        g.moved = true;
        clearTimeout(g.timer);
        if (Math.abs(g.dx) > Math.abs(g.dy) * 1.2) { g.swiping = true; g.x0 += Math.sign(g.dx) * TOUCH_SLOP; g.dx = e.clientX - g.x0; moveLayers(g.dx); }
      }
    };

    /** Lets the days go: on to the next range, or back, on the pager's spring (no buzz, as native). */
    const settleSwipe = (dx: number, vx: number) => {
      const w = layer.current?.clientWidth ?? 300;
      const dir = pageTarget(dx, vx, w);
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

    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const cur = g;
      if (cur.lifted) {
        const info = placed.current.get(cur.key);
        const snap = cur.snap.split("|").map(Number);
        setGhost(null);
        if (info && cur.block) {
          const { p } = info;
          const dMin = snap[0] - p.start, dDay = snap[1];
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
        settleSwipe(cur.dx, cur.vx);
      } else if (!cur.moved) {
        clearTimeout(cur.timer);
        if (cur.block) {
          const info = placed.current.get(cur.key);
          if (info) openItem(info.p.o.item, info.p.o.day);
        } else if (layer.current && (e.target as HTMLElement).closest(".pg-layer")) {
          // An empty slot: the add panel opens there (rounded down to the half hour, like the native grid).
          const r = layer.current.getBoundingClientRect();
          const di = Math.max(0, Math.min(daysRef.current.length - 1, Math.floor((e.clientX - r.left) / colW())));
          const min = Math.max(0, Math.min(DAY_MIN - 30, Math.floor((e.clientY - r.top) / pxRef.current / 30) * 30));
          const day = daysRef.current[di], a = armedRef.current;
          if (a && a.day === day && a.min === min) { setArmed(null); props.current.onNewAt(day, min); }
          else setArmed({ day, min });
        }
      }
      end();
    };

    const onCancel = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      // The browser took the finger for scrolling.
      if (g.swiping) settleSwipe(g.dx, 0);
      if (g.lifted && g.block) { g.block.style.transform = ""; g.block.classList.remove("lifted"); setGhost(null); }
      end();
    };

    // ----- Two-finger zoom (TimeGrid.kt): the hour height follows the fingers' spread, the spot
    // between them stays put, and the zoom is kept for next time. Read from touch events, which
    // keep coming for both fingers whatever the pointer events do.
    const spread = (tl: TouchList) => Math.hypot(tl[0].clientX - tl[1].clientX, tl[0].clientY - tl[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinch || g?.lifted) return;
      // A second finger turns whatever the first one started into a zoom.
      if (g) { clearTimeout(g.timer); if (g.swiping) moveLayers(0); end(); }
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
      end();
      settling?.stop();
      cancelAnimationFrame(zoomRaf);
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
      <div className="pg-head">
        <div className="pg-gutter" />
        <div className="pg-head-days"><div className="pg-strip" ref={headDays}>
          {all.map((d, j) => (
            <div key={d} className={`pg-dh ${d === t ? "today" : ""} ${j % count === 0 ? "range" : ""}`} role="button" onClick={() => onDayHeader(d)}>
              <span className="wd">{NARROW[weekday(d) - 1]}</span>
              <span className="num">{ymd(d).d}</span>
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
            {allDay.map((list, i) => (
              <div key={i} className={`pg-adcol ${i % count === 0 ? "range" : ""}`}>
                {list.slice(0, 3).map((o) => <AllDayChip key={o.item.id} o={o} s={s} />)}
                {list.length > 3 && <span className="more">+{list.length - 3}</span>}
              </div>
            ))}
          </div></div>
        </div>
      )}
      <div className="pg-scroll" ref={scroller} style={{ visibility: hourH ? undefined : "hidden" }}>
        <div className="pg-body" style={{ height: hourH * 24, ["--hour" as string]: `${hourH}px` }}>
          <div className="pg-labels">
            {Array.from({ length: 24 }, (_, h) => <div key={h} style={{ height: hourH }}>{h ? <span>{formatTime(h * 60)}</span> : null}</div>)}
          </div>
          <div className="pg-grid">
            <div className="pg-layer" ref={layer}>
              {all.map((d, j) => (
                <div key={d} className={`pg-col ${j === count ? "first" : ""} ${j % count === 0 ? "range" : ""}`} style={{ left: `${(j - count) * colPct}%`, width: `${colPct}%` }}>
                  {timed[j].map((p) => <Block key={`${p.o.item.id}-${p.o.day}`} p={p} s={s} pxPerMin={pxPerMin} compact={compact} />)}
                  {d === t && <div className="pg-now" style={{ transform: `translate3d(0,${now * pxPerMin}px,0)` }} />}
                </div>
              ))}
              {ghost && (() => {
                const info = placed.current.get(ghost.key);
                if (!info) return null;
                const di = info.di + ghost.dDay;
                return (
                  <div className="pg-ghost" style={{
                    left: `${di * colPct}%`, width: `${colPct}%`, top: ghost.start * pxPerMin, height: Math.max(18, ghost.length * pxPerMin),
                    borderColor: ghost.color, color: ghost.color, background: `color-mix(in srgb, ${ghost.color} 22%, transparent)`,
                  }}>{ghost.isTask ? formatTime(ghost.start) : `${formatTime(ghost.start)}–${formatTime(Math.min(DAY_MIN - 1, ghost.start + ghost.length))}`}</div>
                );
              })()}
              {/* The slot tapped once (tap it again to add there). */}
              {armed && !pending && all.includes(armed.day) && (
                <div className="pg-slot armed" style={{
                  left: `calc(${(all.indexOf(armed.day) - count) * colPct}% + 1px)`, width: `calc(${colPct}% - 2px)`, top: armed.min * pxPerMin,
                  height: Math.max(22, 60 * pxPerMin),
                }}><MIcon name="fAdd" size={18} /></div>
              )}
              {/* Where the new event goes: only its outline, in its colour, while the panel is open. */}
              {pending && all.includes(pending.day) && (
                <div className="pg-slot" style={{
                  left: `calc(${(all.indexOf(pending.day) - count) * colPct}% + 1px)`, width: `calc(${colPct}% - 2px)`, top: pending.min * pxPerMin,
                  height: Math.max(22, (pending.end - pending.min) * pxPerMin), borderColor: pending.color,
                }} />
              )}
            </div>
          </div>
        </div>
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

function Block({ p, s, pxPerMin, compact }: { p: Placed; s: Snapshot; pxPerMin: number; compact: boolean }) {
  const isTask = p.o.item.type === "TASK";
  const c = s.colorOf(p.o.item);
  const h = Math.max(14, (p.end - p.start) * pxPerMin);
  const tiny = h < 22;
  return (
    <div className={`pg-block ${tiny ? "tiny" : ""}`} data-key={`${p.o.item.id}-${p.o.day}`}
      style={{
        top: p.start * pxPerMin, height: h, left: `${(p.col / p.cols) * 100}%`, width: `${100 / p.cols}%`,
        ["--c" as string]: c, background: isTask ? `color-mix(in srgb, ${c} 25%, var(--surface))` : c, color: isTask ? c : onColor(c),
      }}>
      <b className={h >= 36 ? "two" : ""} style={{ textDecoration: p.o.completed ? "line-through" : undefined }}>{displayTitle(p.o.item)}</b>
      {h >= 40 && !isTask && <span className="tm">{compact ? formatTime(p.start) : `${formatTime(p.start)}–${formatTime(Math.min(DAY_MIN - 1, p.end))}`}</span>}
    </div>
  );
}

function AllDayChip({ o, s }: { o: Occurrence; s: Snapshot }) {
  const c = o.overdue ? "var(--danger)" : s.colorOf(o.item);
  const isTask = o.item.type === "TASK";
  return (
    <div className="pg-chip" role="button" onClick={() => openItem(o.item, o.day)}
      style={{ background: isTask ? `color-mix(in srgb, ${c} 18%, transparent)` : c, color: isTask ? c : onColor(c), textDecoration: o.completed ? "line-through" : undefined }}>
      {displayTitle(o.item)}
    </div>
  );
}
