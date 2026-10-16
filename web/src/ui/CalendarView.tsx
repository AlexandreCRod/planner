import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addMonths, dayShort, formatDateShort, formatTime, monthLong, monthShort, nowMinutes, relativeDay, startOfWeek, today as todayEpoch, weekday, ymd } from "../domain/dates.ts";
import { type Occurrence, forCalendar } from "../domain/schedule.ts";
import { type Item, displayTitle, isRecurring, newItem } from "../domain/types.ts";
import { type EditScope, saveItem, saveSeriesEdit, type Snapshot, useSnapshot } from "../store/store.ts";
import { EventRow, Icon, go, openItem } from "./common.tsx";
import { ScopeDialog } from "./ItemEditor.tsx";

type Mode = "day" | "3day" | "week" | "month" | "agenda";
const MODES: [Mode, string][] = [["day", "Day"], ["3day", "3 days"], ["week", "Week"], ["month", "Month"], ["agenda", "Agenda"]];
const mondayFirst = () => localStorage.getItem("weekStartsMonday") !== "false";

export function CalendarView() {
  const s = useSnapshot();
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("calMode") as Mode) || "week");
  const [anchor, setAnchor] = useState(todayEpoch());
  const [showTasks, setShowTasks] = useState(true);
  const [hour, setHour] = useState(() => Number(localStorage.getItem("hourHeight") ?? 52));
  const [fit, setFit] = useState(20);
  useEffect(() => localStorage.setItem("calMode", mode), [mode]);
  const gridMode = mode === "day" || mode === "3day" || mode === "week";

  const items = s.items.filter((i) => i.type === "EVENT" || (showTasks && i.type === "TASK"));
  const step = (dir: number) => setAnchor((a) =>
    mode === "day" ? a + dir : mode === "3day" ? a + 3 * dir : mode === "week" ? a + 7 * dir : mode === "month" ? addMonths(a, dir) : a + 7 * dir);
  const { y, m } = ymd(anchor);
  const title = mode === "day" ? formatDateShort(anchor) : mode === "month" || mode === "agenda" ? `${monthLong(m)} ${y}` : `${monthShort(ymd(mode === "week" ? startOfWeek(anchor, mondayFirst()) : anchor).m)} ${y}`;

  const days = mode === "day" ? [anchor] : mode === "3day" ? [anchor, anchor + 1, anchor + 2]
    : Array.from({ length: 7 }, (_, i) => startOfWeek(anchor, mondayFirst()) + i);

  return (
    <>
      <div className="cal-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={() => step(-1)} title="Previous"><Icon name="left" /></button>
        <button className="btn small" onClick={() => setAnchor(todayEpoch())}>Today</button>
        <button className="icon-btn" onClick={() => step(1)} title="Next"><Icon name="right" /></button>
        <span className="grow" />
        <button className={`chip ${showTasks ? "on" : ""}`} onClick={() => setShowTasks(!showTasks)}>Tasks</button>
        <div className="seg">
          {MODES.map(([k, l]) => <button key={k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>)}
        </div>
      </div>
      {mode === "month" && <MonthGrid s={s} items={items} anchor={anchor} onDay={(d) => { setAnchor(d); setMode("day"); }} />}
      {mode === "agenda" && <Agenda s={s} items={items} from={anchor} />}
      {gridMode && <TimeGrid s={s} items={items} days={days} hour={hour} setHour={setHour} fit={fit} setFit={setFit} onDayHeader={(d) => { setAnchor(d); setMode("day"); }} />}
    </>
  );
}

function newEventAt(day: number, min: number | null) {
  const id = saveItem(newItem({
    type: "EVENT", title: "", startDay: day, endDay: day, startMin: min, endMin: min !== null ? Math.min(min + 60, 1439) : null, allDay: min === null,
  }));
  go(`item/${id}?new=1`);
}

export function MonthGrid({ s, items, anchor, onDay }: { s: Snapshot; items: Item[]; anchor: number; onDay: (d: number) => void }) {
  const { y, m } = ymd(anchor);
  const first = anchor - ymd(anchor).d + 1;
  const start = startOfWeek(first, mondayFirst());
  const days = Array.from({ length: 42 }, (_, i) => start + i);
  const rows = ymd(days[35]).m !== m ? 5 : 6;
  const occ = forCalendar(items, s.done, days[0], days[rows * 7 - 1], todayEpoch());
  const t = todayEpoch();
  const byDay = new Map<number, Occurrence[]>();
  for (const o of occ) for (let d = o.day; d <= o.endDay; d++) byDay.set(d, [...(byDay.get(d) ?? []), o]);
  return (
    <div className="month" style={{ gridTemplateRows: `auto repeat(${rows}, 1fr)` }}>
      {days.slice(0, 7).map((d) => <div key={"h" + d} className="dow">{dayShort(weekday(d))}</div>)}
      {days.slice(0, rows * 7).map((d) => {
        const list = byDay.get(d) ?? [];
        return (
          <div key={d} className={`cell ${ymd(d).m !== m || ymd(d).y !== y ? "other" : ""} ${d === t ? "today" : ""}`}
            onClick={() => onDay(d)} onDoubleClick={(e) => { e.stopPropagation(); newEventAt(d, null); }}>
            <span className="num">{ymd(d).d}</span>
            {list.slice(0, 4).map((o) => {
              const c = o.overdue ? "var(--danger)" : s.colorOf(o.item);
              const isTask = o.item.type === "TASK";
              return (
                <div key={o.item.id + "-" + o.day} className={`ev ${isTask ? "task" : ""} ${o.completed ? "done" : ""}`} onClick={(e) => { e.stopPropagation(); openItem(o.item, o.day); }}
                  style={{ ["--c" as string]: c }}>
                  {o.timed && !o.multiDay ? `${formatTime(o.startMin!)} ` : ""}{displayTitle(o.item)}
                </div>
              );
            })}
            {list.length > 4 && <div className="hint" style={{ fontSize: 11 }}>+{list.length - 4} more</div>}
          </div>
        );
      })}
    </div>
  );
}

export function Agenda({ s, items, from }: { s: Snapshot; items: Item[]; from: number }) {
  const occ = forCalendar(items, s.done, from, from + 90, todayEpoch());
  const byDay = new Map<number, Occurrence[]>();
  for (const o of occ) byDay.set(o.day, [...(byDay.get(o.day) ?? []), o]);
  return (
    <div className="content">
      {byDay.size === 0 && <div className="hint">Nothing in the next 90 days.</div>}
      {[...byDay.entries()].map(([d, list]) => (
        <div key={d} style={{ maxWidth: 820 }}>
          <div className="section">{relativeDay(d)}</div>
          {list.map((o) => <EventRow key={o.item.id + "-" + o.day} o={o} s={s} />)}
        </div>
      ))}
    </div>
  );
}

export interface Placed { o: Occurrence; start: number; end: number; col: number; cols: number }

/** Side-by-side columns for overlapping items within one day (same as the phone). */
export function layoutDay(list: Occurrence[]): Placed[] {
  const spans = list.map((o) => {
    const start = o.startMin ?? 0;
    let end = o.item.type === "TASK" ? start + 30 : o.endMin ?? start + 60;
    if (end <= start) end = start + 30;
    return { o, start, end: Math.min(end, 1440) };
  }).sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: { sp: (typeof spans)[number]; col: number }[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => { const n = Math.max(1, colEnds.length); cluster.forEach(({ sp, col }) => out.push({ ...sp, col, cols: n })); cluster = []; colEnds = []; clusterEnd = -1; };
  for (const sp of spans) {
    if (sp.start >= clusterEnd && cluster.length) flush();
    let col = colEnds.findIndex((e) => e <= sp.start);
    if (col === -1) { colEnds.push(sp.end); col = colEnds.length - 1; } else colEnds[col] = sp.end;
    cluster.push({ sp, col });
    clusterEnd = Math.max(clusterEnd, sp.end);
  }
  flush();
  return out;
}

function TimeGrid({ s, items, days, hour, setHour, fit, setFit, onDayHeader }: {
  s: Snapshot; items: Item[]; days: number[]; hour: number; setHour: (f: (h: number) => number) => void; fit: number; setFit: (n: number) => void; onDayHeader: (d: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ series: Item; day: number; edited: Item } | null>(null);
  // The clicked empty slot (one across all columns): outlined first, a second click creates the event.
  const [slot, setSlot] = useState<{ day: number; min: number } | null>(null);
  const t = todayEpoch();
  const occ = useMemo(() => forCalendar(items, s.done, days[0], days[days.length - 1], todayEpoch()), [items, s, days]);
  const allDay = days.map((d) => occ.filter((o) => (!o.timed || o.multiDay) && o.day <= d && o.endDay >= d));
  const timed = days.map((d) => layoutDay(occ.filter((o) => o.timed && !o.multiDay && o.day === d)));
  const headH = 52 + (allDay.some((l) => l.length) ? Math.min(3, Math.max(...allDay.map((l) => l.length))) * 22 + 6 : 0);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setFit(Math.max(12, (el.clientHeight - headH) / 24));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [headH]);
  useEffect(() => { localStorage.setItem("hourHeight", String(hour)); }, [hour]);
  // On the computer the grid always shows the whole day, sized to the window.
  const h = fit;
  const cols = `52px repeat(${days.length}, 1fr)`;

  const commit = (o: Occurrence, dDay: number, dStart: number, dEnd: number) => {
    const start = o.startMin ?? 0;
    const newDay = o.day + dDay;
    const newStart = Math.max(0, Math.min(1440 - 15, start + dStart));
    let edited: Item;
    if (o.item.type === "TASK") edited = { ...o.item, startDay: newDay, startMin: newStart };
    else {
      const dur = Math.max(15, (o.endMin ?? start + 60) - start + (dEnd - dStart));
      edited = { ...o.item, startDay: newDay, endDay: newDay, startMin: newStart, endMin: Math.min(1439, newStart + dur) };
    }
    if (isRecurring(o.item)) setPending({ series: o.item, day: o.day, edited });
    else saveItem(edited);
  };

  return (
    <div className="grid-wrap" ref={wrap}>
      <div className="grid-days" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => (
          <div key={d} className={`dh ${d === t ? "today" : ""}`} onClick={() => onDayHeader(d)}>{dayShort(weekday(d))}<b>{ymd(d).d}</b></div>
        ))}
      </div>
      {allDay.some((l) => l.length) && (
        <div className="allday" style={{ gridTemplateColumns: cols, top: 52 }}>
          <div className="hint" style={{ fontSize: 10, textAlign: "center", paddingTop: 4 }}>all-day</div>
          {allDay.map((list, i) => (
            <div key={i} style={{ padding: 2, minWidth: 0 }}>
              {list.slice(0, 3).map((o) => {
                const c = o.overdue ? "var(--danger)" : s.colorOf(o.item);
                const isTask = o.item.type === "TASK";
                return (
                  <div key={o.item.id} className={`ev ellipsis ${isTask ? "task" : ""} ${o.completed ? "done" : ""}`} onClick={() => openItem(o.item, o.day)}
                    style={{ ["--c" as string]: c, fontSize: 11.5, borderRadius: 4, padding: "1px 6px", marginBottom: 2, cursor: "pointer" }}>
                    {displayTitle(o.item)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <div className="hours" style={{ gridTemplateColumns: cols, height: h * 24 }}>
        <div>{Array.from({ length: 24 }, (_, i) => <div key={i} className="hour-label" style={{ height: h }}>{i ? formatTime(i * 60) : ""}</div>)}</div>
        {days.map((d, di) => (
          <DayColumn key={d} day={d} hour={h} placed={timed[di]} s={s} isToday={d === t}
            colWidth={() => (wrap.current ? (wrap.current.clientWidth - 52) / days.length : 100)} onCommit={commit}
            slot={slot?.day === d ? slot.min : null} onSlot={(min) => setSlot(min === null ? null : { day: d, min })} />
        ))}
      </div>
      {pending && (
        <ScopeDialog title="Move repeating item" onCancel={() => setPending(null)} onPick={(scope: EditScope) => {
          const { series, day, edited } = pending;
          if (scope === "THIS") saveSeriesEdit("THIS", series, day, edited);
          else {
            const delta = (edited.startDay ?? day) - day;
            const shifted = { ...series, startDay: (series.startDay ?? day) + delta, endDay: series.endDay !== null ? series.endDay + delta : null, startMin: edited.startMin, endMin: edited.endMin };
            saveSeriesEdit(scope, series, day, scope === "FOLLOWING" ? { ...shifted, startDay: edited.startDay, endDay: edited.endDay } : shifted);
          }
          setPending(null);
        }} />
      )}
    </div>
  );
}

function DayColumn({ day, hour, placed, s, isToday, colWidth, onCommit, slot, onSlot }: {
  day: number; hour: number; placed: Placed[]; s: Snapshot; isToday: boolean; colWidth: () => number;
  onCommit: (o: Occurrence, dDay: number, dStart: number, dEnd: number) => void;
  slot: number | null; onSlot: (min: number | null) => void;
}) {
  const pxPerMin = hour / 60;
  const [drag, setDrag] = useState<{ key: string; dx: number; dy: number; resize: boolean } | null>(null);
  const [now, setNow] = useState(nowMinutes());
  useEffect(() => { const t = setInterval(() => setNow(nowMinutes()), 60_000); return () => clearInterval(t); }, []);
  const snap = (px: number) => Math.round(px / pxPerMin / 15) * 15;

  const startDrag = (e: React.PointerEvent, p: Placed, resize: boolean) => {
    e.stopPropagation();
    const key = `${p.o.item.id}-${p.o.day}`;
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (moved) setDrag({ key, dx: resize ? 0 : dx, dy, resize });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!moved) { if (!resize) openItem(p.o.item, p.o.day); return; }
      const dDay = resize ? 0 : Math.round((ev.clientX - x0) / colWidth());
      const dMin = snap(ev.clientY - y0);
      if (resize) { if (dMin) onCommit(p.o, 0, 0, dMin); }
      else if (dDay || dMin) onCommit(p.o, dDay, dMin, dMin);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="daycol" onClick={(e) => {
      if (e.target !== e.currentTarget) return;
      const y = e.nativeEvent.offsetY;
      onSlot(Math.min(1410, Math.floor(y / pxPerMin / 30) * 30));
    }}>
      {slot !== null && (
        <div className="slot-sel" style={{ top: slot * pxPerMin, height: Math.max(20, 60 * pxPerMin) }} title="Click again to add an event here"
          onClick={(e) => { e.stopPropagation(); onSlot(null); newEventAt(day, slot); }}>+ {formatTime(slot)}</div>
      )}
      {Array.from({ length: 23 }, (_, i) => <div key={i} className="hline" style={{ top: (i + 1) * hour }} />)}
      {placed.map((p) => {
        const key = `${p.o.item.id}-${p.o.day}`;
        const d = drag?.key === key ? drag : null;
        const isTask = p.o.item.type === "TASK";
        const c = s.colorOf(p.o.item);
        const height = Math.max(14, (p.end - p.start) * pxPerMin + (d?.resize ? d.dy : 0));
        const tiny = height < 22;
        // While dragging, an outline shows where it will land, with its new time.
        const ghost = d && !d.resize ? (() => {
          const length = p.end - p.start;
          const start = Math.max(0, Math.min(1425, p.start + snap(d.dy)));
          const dDay = Math.round(d.dx / colWidth());
          return (
            <div key={key + "-ghost"} className="drop-ghost" style={{
              top: start * pxPerMin, height: Math.max(16, length * pxPerMin), left: `calc(${dDay * colWidth()}px + 1px)`, width: "calc(100% - 3px)",
              borderColor: c, color: c, background: `color-mix(in srgb, ${c} 18%, transparent)`,
            }}>{isTask ? formatTime(start) : `${formatTime(start)}–${formatTime(Math.min(1439, start + length))}`}</div>
          );
        })() : null;
        return (<Fragment key={key}>{ghost}
          <div key={key} className={`block ${isTask ? "task" : ""} ${tiny ? "tiny" : ""} ${p.o.completed ? "done" : ""} ${d ? "dragging" : ""}`} onPointerDown={(e) => startDrag(e, p, false)}
            style={{ ["--c" as string]: c,
              top: p.start * pxPerMin + (d && !d.resize ? d.dy : 0), height,
              left: `calc(${(p.col / p.cols) * 100}% + ${d && !d.resize ? d.dx : 0}px + 1px)`, width: `calc(${100 / p.cols}% - 3px)`,
              fontSize: tiny ? 10.5 : 12, lineHeight: tiny ? `${height - 2}px` : undefined,
            }}>
            {/* A task is an outline with a small tick circle; an event is a filled block with a stripe. */}
            {isTask && <span className={`cal-tick ${p.o.completed ? "on" : ""}`}>{p.o.completed && <Icon name="check" size={8} />}</span>}
            <b style={{ fontWeight: 600 }}>{displayTitle(p.o.item)}</b>
            {height >= 40 && !isTask && <div style={{ opacity: 0.85, fontSize: 11 }}>{formatTime(p.start)}–{formatTime(Math.min(1439, p.end + (d?.resize ? snap(d.dy) : 0)))}</div>}
            {!isTask && height >= 30 && (
              <div onPointerDown={(e) => startDrag(e, p, true)} title="Drag to change length"
                style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 8, cursor: "ns-resize" }} />
            )}
          </div></Fragment>
        );
      })}
      {isToday && <div className="nowline" style={{ top: now * pxPerMin }} />}
    </div>
  );
}
