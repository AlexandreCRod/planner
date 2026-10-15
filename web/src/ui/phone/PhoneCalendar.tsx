// The calendar on the phone: Google Calendar-style header and a day / 3-day / week time grid that
// scrolls natively, with long-press-and-drag to move an event (snapped to 15 minutes, with a lift and
// haptics), a tap on an empty slot to add one, and a sideways swipe to move to the previous/next days.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addMonths, formatDateShort, formatTime, monthLong, monthShort, nowMinutes, startOfWeek, today as todayEpoch, weekday, ymd } from "../../domain/dates.ts";
import { forCalendar, type Occurrence } from "../../domain/schedule.ts";
import { type Item, displayTitle, isRecurring } from "../../domain/types.ts";
import { type EditScope, saveItem, saveSeriesEdit, type Snapshot, useSnapshot } from "../../store/store.ts";
import { Agenda, MonthGrid, type Placed, layoutDay } from "../CalendarView.tsx";
import { Icon, openItem } from "../common.tsx";
import { ScopeDialog } from "../ItemEditor.tsx";
import type { AddRequest } from "./AddPanel.tsx";
import { hapticLift, hapticLight, hapticTick, pushBack } from "./native.ts";

type Mode = "day" | "3day" | "week" | "month" | "agenda";
const MODES: [Mode, string][] = [["day", "Day"], ["3day", "3 days"], ["week", "Week"], ["month", "Month"], ["agenda", "Agenda"]];
const NARROW = ["M", "T", "W", "T", "F", "S", "S"];
const mondayFirst = () => localStorage.getItem("weekStartsMonday") !== "false";
const DAY_MIN = 1440;
const LONG_PRESS_MS = 400;
const SLOP = 8;

// Kept while moving around the app, like the native CalendarState.
let selected = todayEpoch();
/** The day the calendar is on (the + button adds there). */
export const calendarSelectedDay = () => selected;

export function PhoneCalendar({ onNewAt, pending }: { onNewAt: (day: number, min: number) => void; pending: AddRequest | null }) {
  const s = useSnapshot();
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem("calModePhone") as Mode) || "3day");
  const [anchor, setAnchorState] = useState(selected);
  const [menu, setMenu] = useState(false);
  const setAnchor = (d: number) => { selected = d; setAnchorState(d); };
  const setMode = (m: Mode) => { localStorage.setItem("calModePhone", m); setModeState(m); setMenu(false); };
  useEffect(() => (menu ? pushBack(() => setMenu(false)) : undefined), [menu]);

  const step = (dir: number) => setAnchor(
    mode === "day" ? anchor + dir : mode === "3day" ? anchor + 3 * dir : mode === "week" ? anchor + 7 * dir : mode === "month" ? addMonths(anchor, dir) : anchor + 7 * dir);
  const { y, m } = ymd(anchor);
  const weekStart = startOfWeek(anchor, mondayFirst());
  const title = mode === "day" ? formatDateShort(anchor) : mode === "month" || mode === "agenda" ? `${monthLong(m)} ${y}` : `${monthShort(ymd(mode === "week" ? weekStart : anchor).m)} ${y}`;
  const first = mode === "day" ? anchor : mode === "3day" ? anchor : weekStart;
  const count = mode === "day" ? 1 : mode === "3day" ? 3 : 7;
  const items = useMemo(() => s.items.filter((i) => i.type === "EVENT" || i.type === "TASK"), [s]);
  const grid = mode === "day" || mode === "3day" || mode === "week";

  return (
    <div className="p-scaffold p-cal">
      <div className="p-statusbar" />
      <header className="p-calhead">
        <h2>{title}</h2>
        <button className="p-icon" aria-label="Previous" onClick={() => step(-1)}><Icon name="left" size={24} /></button>
        <button className="p-icon" aria-label="Today" onClick={() => setAnchor(todayEpoch())}><Icon name="today" size={22} /></button>
        <button className="p-icon" aria-label="Next" onClick={() => step(1)}><Icon name="right" size={24} /></button>
        <button className="p-icon" aria-label="View" onClick={() => setMenu(!menu)}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 11V3h18v8Zm0 10v-8h18v8Zm2-12h14V5H5Zm0 10h14v-4H5Z" /></svg>
        </button>
        {menu && <>
          <div className="p-menu-scrim" onPointerDown={() => setMenu(false)} />
          <div className="p-menu">
            {MODES.map(([k, l]) => <button key={k} onClick={() => setMode(k)}><span className="grow">{l}</span>{mode === k && "✓"}</button>)}
          </div>
        </>}
      </header>
      <div className="p-calbody">
        {grid && <TimeGrid s={s} items={items} first={first} count={count} onStep={step} onNewAt={onNewAt} pending={pending}
          onDayHeader={(d) => { setAnchor(d); setMode("day"); }} />}
        {mode === "month" && <div className="p-month"><MonthGrid s={s} items={items} anchor={anchor} onDay={(d) => { setAnchor(d); setMode("day"); }} /></div>}
        {mode === "agenda" && <div className="p-content"><Agenda s={s} items={items} from={anchor} /></div>}
      </div>
    </div>
  );
}

interface Gesture {
  id: number; x0: number; y0: number; t0: number; scroll0: number;
  block: HTMLElement | null; key: string; timer: number;
  lifted: boolean; swiping: boolean; moved: boolean;
  dx: number; dy: number; x: number; y: number;
  vx: number; lastX: number; lastT: number;
  snap: string; raf: number;
}

function TimeGrid({ s, items, first, count, onStep, onNewAt, pending, onDayHeader }: {
  s: Snapshot; items: Item[]; first: number; count: number; onStep: (dir: number) => void;
  onNewAt: (day: number, min: number) => void; pending: AddRequest | null; onDayHeader: (d: number) => void;
}) {
  const days = useMemo(() => Array.from({ length: count }, (_, i) => first + i), [first, count]);
  const t = todayEpoch();
  const scroller = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const headDays = useRef<HTMLDivElement>(null);
  const allDayDays = useRef<HTMLDivElement>(null);
  const [hourH, setHourH] = useState(0);
  const [now, setNow] = useState(nowMinutes());
  useEffect(() => { const i = setInterval(() => setNow(nowMinutes()), 60_000); return () => clearInterval(i); }, []);
  const [ghost, setGhost] = useState<{ key: string; start: number; dDay: number; length: number; color: string; isTask: boolean } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ series: Item; day: number; edited: Item } | null>(null);

  const occ = useMemo(() => forCalendar(items, s.done, days[0], days[days.length - 1], t), [items, s, days, t]);
  const allDay = days.map((d) => occ.filter((o) => (!o.timed || o.multiDay) && o.day <= d && o.endDay >= d));
  const timed = useMemo(() => days.map((d) => layoutDay(occ.filter((o) => o.timed && !o.multiDay && o.day === d))), [occ, days]);
  const placed = useRef(new Map<string, { p: Placed; di: number }>());
  placed.current = new Map();
  timed.forEach((list, di) => list.forEach((p) => placed.current.set(`${p.o.item.id}-${p.o.day}`, { p, di })));

  const pxPerMin = hourH / 60;
  const pxRef = useRef(pxPerMin);
  pxRef.current = pxPerMin;
  const daysRef = useRef(days);
  daysRef.current = days;
  const props = useRef({ onStep, onNewAt, s });
  props.current = { onStep, onNewAt, s };

  // Opening: 06:00 to 24:00 fills the grid, scrolled to 06:00 (as the native app does).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const h = Math.max(240, el.clientHeight) / 18;
    setHourH(h);
    el.scrollTop = h * 6;
  }, []);

  // A new range slid in from the side the finger pushed it.
  const incoming = useRef(0);
  useLayoutEffect(() => {
    const dir = incoming.current;
    if (!dir) return;
    incoming.current = 0;
    const w = layer.current?.clientWidth ?? 300;
    for (const el of [layer.current, headDays.current, allDayDays.current]) {
      el?.animate([{ transform: `translate3d(${dir * w * 0.35}px,0,0)`, opacity: 0.3 }, { transform: "translate3d(0,0,0)", opacity: 1 }], { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" });
      if (el) el.style.transform = "";
    }
  }, [first]);

  // A moved block keeps its dragged position until the grid has redrawn it in its new place.
  const clearAfterRender = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = clearAfterRender.current;
    if (el) { el.style.transform = ""; el.classList.remove("lifted"); clearAfterRender.current = null; }
  });

  // The new event's slot stays in view above the add panel.
  useEffect(() => {
    const el = scroller.current;
    if (!pending || pending.min === null || !el || !pxPerMin) return;
    const top = pending.min * pxPerMin;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight * 0.3) el.scrollTo({ top: Math.max(0, top - el.clientHeight * 0.12), behavior: "smooth" });
  }, [pending, pxPerMin]);

  // Touch handling, by hand: the browser scrolls vertically (touch-action: pan-y); sideways moves and
  // long-press drags come here. Once a drag or swipe has started, touchmove is cancelled so the
  // browser never takes the finger over.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let g: Gesture | null = null;
    const moveLayers = (x: number) => {
      for (const l of [layer.current, headDays.current, allDayDays.current]) if (l) l.style.transform = x ? `translate3d(${x}px,0,0)` : "";
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
        hapticTick();
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
      if (g || (e.pointerType === "mouse" && e.button !== 0)) return;
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
      if (dt > 0) { g.vx = 0.7 * ((e.clientX - g.lastX) / dt) + 0.3 * g.vx; g.lastX = e.clientX; g.lastT = e.timeStamp; }
      if (g.lifted) { updateDrag(); return; }
      if (g.swiping) { moveLayers(g.dx); return; }
      if (Math.abs(g.dx) > SLOP || Math.abs(g.dy) > SLOP) {
        g.moved = true;
        clearTimeout(g.timer);
        if (Math.abs(g.dx) > Math.abs(g.dy) * 1.2) { g.swiping = true; moveLayers(g.dx); }
      }
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
        const w = layer.current?.clientWidth ?? 300;
        const dir = cur.dx < -w * 0.25 || cur.vx < -0.45 ? 1 : cur.dx > w * 0.25 || cur.vx > 0.45 ? -1 : 0;
        if (dir) {
          hapticLight();
          incoming.current = dir;
          moveLayers(0);
          props.current.onStep(dir);
        } else {
          for (const l of [layer.current, headDays.current, allDayDays.current]) {
            if (!l) continue;
            l.animate([{ transform: l.style.transform }, { transform: "translate3d(0,0,0)" }], { duration: 180, easing: "ease-out" });
          }
          moveLayers(0);
        }
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
          props.current.onNewAt(daysRef.current[di], min);
        }
      }
      end();
    };

    const onCancel = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      // The browser took the finger for scrolling.
      if (g.swiping) moveLayers(0);
      if (g.lifted && g.block) { g.block.style.transform = ""; g.block.classList.remove("lifted"); setGhost(null); }
      end();
    };

    const onTouchMove = (e: TouchEvent) => { if (g && (g.lifted || g.swiping) && e.cancelable) e.preventDefault(); };
    const noMenu = (e: Event) => e.preventDefault();

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("contextmenu", noMenu);
    return () => {
      end();
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  const colPct = 100 / days.length;
  const compact = days.length > 3;
  const hasAllDay = allDay.some((l) => l.length);

  return (
    <div className="pg">
      <div className="pg-head">
        <div className="pg-gutter" />
        <div className="pg-head-days" ref={headDays}>
          {days.map((d) => (
            <button key={d} className={`pg-dh ${d === t ? "today" : ""}`} onClick={() => onDayHeader(d)}>
              <span className="wd">{NARROW[weekday(d) - 1]}</span>
              <span className="num">{ymd(d).d}</span>
            </button>
          ))}
        </div>
      </div>
      {hasAllDay && (
        <div className="pg-allday">
          <div className="pg-gutter">all-day</div>
          <div className="pg-allday-days" ref={allDayDays}>
            {allDay.map((list, i) => (
              <div key={i} className="pg-adcol">
                {list.slice(0, 3).map((o) => <AllDayChip key={o.item.id} o={o} s={s} />)}
                {list.length > 3 && <span className="more">+{list.length - 3}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="pg-scroll" ref={scroller} style={{ visibility: hourH ? undefined : "hidden" }}>
        <div className="pg-body" style={{ height: hourH * 24, ["--hour" as string]: `${hourH}px` }}>
          <div className="pg-labels">
            {Array.from({ length: 24 }, (_, h) => <div key={h} style={{ height: hourH }}>{h ? <span>{formatTime(h * 60)}</span> : null}</div>)}
          </div>
          <div className="pg-grid">
            <div className="pg-layer" ref={layer}>
              {days.map((d, di) => (
                <div key={d} className="pg-col" style={{ left: `${di * colPct}%`, width: `${colPct}%` }}>
                  {timed[di].map((p) => <Block key={`${p.o.item.id}-${p.o.day}`} p={p} s={s} pxPerMin={pxPerMin} compact={compact} />)}
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
              {pending && pending.min !== null && days.includes(pending.day) && (
                <div className="pg-slot" style={{ left: `${days.indexOf(pending.day) * colPct}%`, width: `${colPct}%`, top: pending.min * pxPerMin, height: Math.max(22, 60 * pxPerMin) }}>
                  <b>(No title)</b>
                  <span>{formatTime(pending.min)} – {formatTime(Math.min(DAY_MIN - 1, pending.min + 60))}</span>
                </div>
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
        ["--c" as string]: c, background: isTask ? `color-mix(in srgb, ${c} 25%, var(--surface))` : c, color: isTask ? c : "#fff",
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
    <div className="pg-chip" onClick={() => openItem(o.item, o.day)}
      style={{ background: isTask ? `color-mix(in srgb, ${c} 18%, transparent)` : c, color: isTask ? c : "#fff", textDecoration: o.completed ? "line-through" : undefined }}>
      {displayTitle(o.item)}
    </div>
  );
}
