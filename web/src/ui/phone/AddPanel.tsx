// The phone's add panel, after the native GrowingPanel: a small panel over the bottom bar (the keyboard
// only comes up when its title field is tapped, and the panel then rides on top of it). Dragging it up
// grows it continuously into the full editor (already there underneath, at full size, revealed as the
// panel grows); it follows the finger exactly (the transform is written straight from the pointer, no
// redraw) and settles when let go: a short pull or a flick is enough (sheet.ts). Dragged down, it
// closes. Once open, the editor's own handle drags it back down the same way. A sideways swipe on the
// small panel switches between Task and Event, the switch's indicator following the finger.
import { animated, easings, to, useSpring } from "@react-spring/web";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { describe } from "../../domain/recurrence.ts";
import { formatDate, formatDateShort, formatTime, offsetLabel, relativeDay } from "../../domain/dates.ts";
import { type ClockCommand, parseClockCommand, parseQuickAdd } from "../../domain/quickadd.ts";
import { daysText, formatDuration } from "../../domain/alarms.ts";
import { act, hasAlarms, native } from "../../alarms/native.ts";
import { ensureNotifications } from "./PhoneAlarms.tsx";
import { type Item, type ItemType, type Reminder, PRIORITIES, PRIORITY_COLORS_MUTED, newItem } from "../../domain/types.ts";
import { saveItem, snapshot } from "../../store/store.ts";
import { go } from "../common.tsx";
import { FilterChip, MIcon, Segmented } from "./chrome.tsx";
import { SWIPE_GAIN, pageTarget } from "./pager.ts";
import { VelocityTracker } from "./motion.ts";
import { TOUCH_SLOP, selectingText } from "./press.ts";
import { swallowNextClick } from "./gesture.ts";
import { panelTarget } from "./sheet.ts";
import { AssistChip, ColorPickerDialog, TextButton, showSnackbar } from "./m3.tsx";
import { hideKeyboard, pushBack, showKeyboard, useKeyboardHeight } from "./native.ts";

const TYPES: [ItemType, string][] = [["TASK", "Task"], ["EVENT", "Event"]];
import { type Draft, PhoneItemEditor, firstAlerts, switchType } from "./PhoneItem.tsx";
import { DatePickerDialog, TimePickerDialog } from "./pickers.tsx";

/** What a timer or alarm typed on the add line will be: "Timer · 10:00 · pasta", "Alarm · 7:00 AM · Weekdays". */
function clockText(c: ClockCommand): string {
  const parts = c.kind === "timer"
    ? ["Timer", formatDuration(c.durationMs)]
    : ["Alarm", formatTime(c.hour * 60 + c.minute), c.days ? daysText(c.days) : "Rings once"];
  return [...parts, c.label].filter(Boolean).join(" · ");
}

/** Starts the timer or sets the alarm clock, then shows it on the Alarms page. */
async function runClock(c: ClockCommand) {
  if (c.kind === "timer") {
    await ensureNotifications("A running timer shows its countdown in a notification and rings when it's done, even with the screen locked.");
    await act(native.timer("start", { durationMs: c.durationMs, label: c.label }));
    go("alarms/timer");
    showSnackbar(`Timer started: ${formatDuration(c.durationMs)}`);
  } else {
    await ensureNotifications("This alarm rings at its time even with the app closed, through a notification.");
    await act(native.saveClock({ id: 0, hour: c.hour, minute: c.minute, label: c.label, days: c.days, enabled: true, color: 0, sound: null }));
    go("alarms/alarm");
    showSnackbar(`Alarm set for ${formatTime(c.hour * 60 + c.minute)}`);
  }
}

/** Whole device pixels: the panel is its own GPU layer, and one left at a fractional offset is drawn soft. */
const snapPx = (v: number) => Math.round(v * devicePixelRatio) / devicePixelRatio;

export interface AddRequest { mode: "quick" | "slot"; type: ItemType; day: number; min: number | null }
/** Where the new event will be, outlined on the calendar while the panel is open (Google Calendar's box). */
export interface SlotPreview { day: number; min: number; end: number; color: string }

/** Native: spring(stiffness = 600), critically damped. */
const SETTLE = { tension: 600, friction: 49 };
const DAY_END = 24 * 60 - 1;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Close to Android's keyboard animation (fast out, slow in). */
const imeCurve = (t: number) => 1 - Math.pow(1 - t, 3.2);

/** What the quick panel's own date, time, all-day and colour controls changed (they win over the typed line). */
interface Overrides { startDay?: number | null; endDay?: number | null; startMin?: number | null; endMin?: number | null; allDay?: boolean; color?: number | null; categoryId?: number | null }
type Pick = { kind: "date" | "start" | "end" } | null;

export function AddPanel({ req, onClose, onPreview }: { req: AddRequest; onClose: () => void; onPreview?: (p: SlotPreview | null) => void }) {
  const kb = useKeyboardHeight();
  const [winH, setWinH] = useState(window.innerHeight);
  const [nav, setNav] = useState(0);
  const probe = useRef<HTMLDivElement>(null);
  const compactRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<(() => void) | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [grown, setGrown] = useState(false);
  // Once it has been the full editor, the small panel shows the editor's draft (title, type, when).
  const [everGrown, setEverGrown] = useState(false);
  const closing = useRef(false);
  // The tap that opened the panel (on a calendar slot) ends with a click that lands on the new scrim.
  const openedAt = useRef(performance.now());
  const grownRef = useRef(false);
  const [pick, setPick] = useState<Pick>(null);
  const [colorOpen, setColorOpen] = useState(false);

  // ---------- What's being added ----------
  const [type, setType] = useState<ItemType>(req.type);
  const [text, setText] = useState("");
  const [ov, setOv] = useState<Overrides>({});
  const categories = snapshot().categories;
  const parsed = useMemo(() => parseQuickAdd(text, undefined, categories.map((c) => c.name)), [text, categories]);
  const quick = req.mode === "quick";
  const buildQuick = (): Draft => {
    const ev = type === "EVENT";
    const day = parsed.day ?? (ev ? req.day : null);
    const start = parsed.startMin;
    const item: Item = newItem({
      type: type === "NOTE" ? "TASK" : type,
      title: parsed.title || text.trim(),
      startDay: day ?? (parsed.freq !== "NONE" ? req.day : null),
      startMin: start,
      endDay: ev ? parsed.endDay ?? day : null,
      endMin: ev ? parsed.endMin ?? (start !== null ? Math.min(start + 60, DAY_END) : null) : null,
      allDay: ev && start === null,
      freq: parsed.freq, interval: parsed.interval, weekDays: parsed.weekDays, untilDay: parsed.untilDay,
      priority: type === "TASK" ? parsed.priority : 0,
      categoryId: parsed.category !== null ? categories.find((c) => c.name === parsed.category)?.id ?? null : null,
      location: parsed.place ?? "",
    });
    if ("startDay" in ov) {
      const span = item.endDay !== null && item.startDay !== null ? item.endDay - item.startDay : 0;
      item.startDay = ov.startDay ?? null;
      if (ev) item.endDay = item.startDay !== null ? item.startDay + Math.max(0, ov.endDay !== undefined && ov.endDay !== null ? ov.endDay - item.startDay : span) : null;
    }
    if ("startMin" in ov) {
      item.startMin = ov.startMin ?? null;
      if (ev) { item.allDay = item.startMin === null; item.endMin = ov.endMin ?? (item.startMin !== null ? Math.min(item.startMin + 60, DAY_END) : null); }
    }
    if ("allDay" in ov && ev) {
      item.allDay = !!ov.allDay;
      if (item.allDay) { item.startMin = null; item.endMin = null; }
      else if (item.startMin === null) { item.startMin = req.min ?? 540; item.endMin = Math.min(item.startMin + 60, DAY_END); }
    }
    if ("color" in ov) item.color = ov.color ?? null;
    if ("categoryId" in ov) item.categoryId = ov.categoryId ?? null;
    if (item.startDay === null) item.startMin = null;
    const reminders = parsed.alerts.length
      ? parsed.alerts.map(([offsetMin, t]): Reminder => ({ id: 0, itemId: 0, offsetMin, type: t, soundUri: null }))
      : firstAlerts(item);
    return { item, reminders, tags: parsed.tags.join(" ") };
  };
  const [draft, setDraft] = useState<Draft>(() => {
    if (quick) return { item: newItem({ type: req.type, startDay: req.type === "EVENT" ? req.day : null, allDay: req.type === "EVENT" }), reminders: [], tags: "" };
    const min = req.min ?? 540;
    const item = newItem({ type: "EVENT", startDay: req.day, endDay: req.day, startMin: min, endMin: Math.min(min + 60, DAY_END) });
    return { item, reminders: firstAlerts(item), tags: "" };
  });
  // While small (and never grown), the quick panel's line and controls are what the editor opens with.
  const lineMode = quick && !everGrown;
  useEffect(() => { if (lineMode) setDraft(buildQuick()); }, [text, type, ov]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = draft.item;
  const setItem = (patch: Partial<Item>) => setDraft((x) => ({ ...x, item: { ...x.item, ...patch } }));
  const canGrow = !(quick && type === "NOTE");
  const canSave = lineMode ? text.trim() !== "" || type === "NOTE" : d.title.trim() !== "";
  // "timer 10 min", "alarm 7am weekdays": on the phone the line can start a timer or set an alarm clock.
  const clock = useMemo(() => (hasAlarms && lineMode && type !== "NOTE" ? parseClockCommand(text, new Date()) : null), [text, lineMode, type]);

  // The outline on the calendar follows the slot panel's day, time and colour.
  useEffect(() => {
    if (!onPreview || req.mode !== "slot") return;
    if (d.startDay === null || d.allDay || d.startMin === null) { onPreview(null); return; }
    const end = d.type === "EVENT" && d.endMin !== null && d.endMin > d.startMin ? d.endMin : Math.min(d.startMin + (d.type === "EVENT" ? 60 : 30), DAY_END);
    onPreview({ day: d.startDay, min: d.startMin, end, color: snapshot().colorOf(d) });
  }, [d.startDay, d.startMin, d.endMin, d.allDay, d.type, d.color, d.categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (clock) { onClose(); void runClock(clock); return; }
    if (lineMode && type === "NOTE") {
      const id = saveItem(newItem({ type: "NOTE", title: text.trim() }));
      onClose();
      go(`note/${id}`);
      return;
    }
    if (!canSave) return;
    // The editor saves what it holds (notes typed there included); before it exists, save the draft.
    if (saveRef.current) { saveRef.current(); return; }
    const it = d.type === "EVENT"
      ? { ...d, endDay: d.startDay !== null ? Math.max(d.endDay ?? d.startDay, d.startDay) : null, title: d.title.trim() }
      : { ...d, endDay: null, endMin: null, title: d.title.trim() };
    saveItem(it, { reminders: draft.reminders, tags: draft.tags.split(/\s+/).filter(Boolean) });
    onClose();
  };

  // ---------- Geometry ----------
  const [sp, api] = useSpring(() => ({ p: 0, down: 0, hidden: 1, kb: 0, ch: 0, h: window.innerHeight, nav: 0, lag: 0 }));
  useLayoutEffect(() => {
    const n = probe.current?.offsetHeight ?? 0;
    setNav(n);
    api.start({ nav: n, immediate: true });
    // In the app the page shrinks at once when the keyboard starts to rise (and grows at once when it
    // starts to fall), while the keyboard itself takes ~300 ms. The jump is taken back and eased away
    // with the keyboard's own curve, so the panel rides on top of it instead of leaping ahead.
    const onResize = () => {
      const old = sp.h.get(), h = window.innerHeight;
      setWinH(h);
      api.start({ h, immediate: true });
      if (Math.abs(old - h) > 80) {
        api.start({ lag: sp.lag.get() + old - h, immediate: true });
        api.start({ lag: 0, config: { duration: 300, easing: imeCurve } });
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [api, sp]);
  // The keyboard's own animation is about a quarter of a second; the panel rides on it.
  useEffect(() => { api.start({ kb, config: { duration: kb ? 260 : 220, easing: easings.easeOutCubic } }); }, [kb, api]);
  const measureRef = useRef(() => {});
  useLayoutEffect(() => {
    const el = compactRef.current;
    if (!el) return;
    // The panel is exactly as tall as its content. The first height is taken at once; later changes
    // (a chips row coming or going as the line is typed) slide the panel to its new height.
    const measure = () => {
      const h = el.offsetHeight, first = sp.ch.get() === 0;
      if (!first && sp.p.get() !== 0) return;
      if (h === sp.ch.goal) return;
      api.start({ ch: h, immediate: first, config: { duration: 180, easing: easings.easeOutCubic } });
    };
    measureRef.current = measure;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [api, sp]);

  const bottomOf = (k: number, n: number) => Math.max(k, n);
  const range = () => Math.max(1, sp.h.get() - bottomOf(sp.kb.get(), sp.nav.get()) - sp.ch.get());
  const y = to([sp.p, sp.down, sp.hidden, sp.kb, sp.ch, sp.h, sp.nav, sp.lag], (p, down, hidden, k, ch, h, n, lag) => {
    const b = bottomOf(k, n);
    const avail = h - b;
    const visible = ch + p * Math.max(0, avail - ch);
    return avail - visible + down + hidden * (ch + b) + lag;
  });
  const availH = winH - bottomOf(kb, nav);

  // ---------- Opening, closing ----------
  useLayoutEffect(() => {
    // The panel comes up on its own: the keyboard only when the title field is tapped.
    api.start({ hidden: 0, config: { duration: 150, easing: easings.easeOutCubic } });
    const t = window.setTimeout(() => setEditorReady(true), 250);
    return () => clearTimeout(t);
  }, [api]);
  useEffect(() => () => { (document.activeElement as HTMLElement | null)?.blur?.(); hideKeyboard(); }, []);

  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    onPreview?.(null);
    api.start({ down: sp.ch.get() + bottomOf(sp.kb.get(), sp.nav.get()) + 40, config: { duration: 150, easing: easings.easeInCubic }, onRest: () => onClose() });
  };
  useEffect(() => pushBack(() => dismiss()), []); // eslint-disable-line react-hooks/exhaustive-deps

  const settleTo = (target: number, velocity = 0) => {
    api.start({
      p: target, config: { ...SETTLE, velocity },
      onRest: ({ finished }) => {
        // Back to small: its content may have changed while it was the editor.
        if (finished && target === 0) measureRef.current();
        if (!finished || target !== 1 || grownRef.current) return;
        grownRef.current = true;
        // The editor's title takes the keyboard over if the small panel had it.
        const hadFocus = document.activeElement === inputRef.current;
        setGrown(true);
        setEverGrown(true);
        requestAnimationFrame(() => {
          const title = document.querySelector<HTMLInputElement>(".gp-full .pe-titleinput");
          if (hadFocus && title) title.focus({ preventScroll: true });
        });
      },
    });
  };
  const grow = () => { if (canGrow) settleTo(1); };

  // ---------- The drag ----------
  // Small, the whole panel drags (up and down: grow or close; sideways: Task or Event); grown, only the
  // editor's handle strip does (its content scrolls). The panel's transform is written here, in the
  // pointer's own event, so it never trails the finger; the springs are only told where it is.
  const panelRef = useRef<HTMLDivElement>(null);
  const typeTrack = useRef<((p: number | null, v?: number) => void) | null>(null);
  const live = useRef({ canGrow, type, lineMode, setType: (t: ItemType) => {} });
  live.current = {
    canGrow, type: lineMode ? type : d.type, lineMode,
    setType: (t: ItemType) => { if (lineMode) setType(t); else setDraft((x) => switchType(x, t)); },
  };
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    type G = { id: number; x0: number; y0: number; lastX: number; lastY: number; lastT: number; vx: number; vy: number; vt: VelocityTracker; mode: "" | "y" | "x"; p0: number; down0: number; from: "compact" | "full"; segW: number };
    let g: G | null = null;
    const panelY = () => {
      const b = bottomOf(sp.kb.get(), sp.nav.get());
      const avail = sp.h.get() - b, ch = sp.ch.get();
      return avail - (ch + sp.p.get() * Math.max(0, avail - ch)) + sp.down.get() + sp.hidden.get() * (ch + b) + sp.lag.get();
    };
    const onDown = (e: PointerEvent) => {
      if (g || closing.current || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      const t = e.target as Element;
      if (grownRef.current && !t.closest(".gp-drag")) return;
      if (t.closest(".p-dialog-scrim, .p-menu")) return;
      if (selectingText()) return; // text selected in the field: the browser's
      const seg = el.querySelector<HTMLElement>(".gp-compact .p-segmented");
      g = {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp, vx: 0, vy: 0, vt: new VelocityTracker(), mode: "",
        p0: sp.p.get(), down0: sp.down.get(), from: grownRef.current ? "full" : "compact", segW: seg ? seg.offsetWidth / TYPES.length : 120,
      };
    };
    const onMove = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      if (!g.mode && selectingText()) { g = null; return; }
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) {
        g.vx = 0.6 * ((e.clientX - g.lastX) / dt) + 0.4 * g.vx;
        g.vy = 0.6 * ((e.clientY - g.lastY) / dt) + 0.4 * g.vy;
        g.lastT = e.timeStamp;
      }
      g.lastX = e.clientX; g.lastY = e.clientY;
      g.vt.addEvent(e, "x");
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.mode) {
        if (Math.abs(dy) > TOUCH_SLOP && Math.abs(dy) >= Math.abs(dx)) {
          g.mode = "y"; g.y0 += Math.sign(dy) * TOUCH_SLOP;
          // Caught mid-settle: it carries on from where it is.
          sp.p.stop(); sp.down.stop();
          g.p0 = sp.p.get(); g.down0 = sp.down.get();
        }
        else if (Math.abs(dx) > TOUCH_SLOP && g.from === "compact") { g.mode = "x"; g.x0 += Math.sign(dx) * TOUCH_SLOP; }
        else return;
        try { el.setPointerCapture(e.pointerId); } catch { /* already gone */ }
        if (g.mode === "y" && g.from === "full") {
          // Pulled back down from the full editor: the small panel comes back as it shrinks (one redraw).
          grownRef.current = false;
          (document.activeElement as HTMLElement | null)?.blur?.();
          setGrown(false);
        }
      }
      if (g.mode === "x") {
        const i = TYPES.findIndex(([k]) => k === live.current.type);
        typeTrack.current?.(i + (SWIPE_GAIN * (e.clientX - g.x0)) / g.segW);
        return;
      }
      // Up: first undo any pull-down, then grow. Down: shrink, then pull away.
      const total = e.clientY - g.y0, r = range();
      let p = g.p0, down = g.down0;
      if (total < 0) {
        const up = -total;
        down = Math.max(0, g.down0 - up);
        const rest = up - (g.down0 - down);
        if (live.current.canGrow) p = Math.min(1, g.p0 + rest / r);
      } else {
        p = Math.max(0, g.p0 - total / r);
        down = g.down0 + Math.max(0, total - (g.p0 - p) * r);
      }
      sp.p.set(p);
      sp.down.set(down);
      el.style.transform = `translate3d(0,${snapPx(panelY())}px,0)`;
    };
    const onUp = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const cur = g;
      g = null;
      if (!cur.mode) return;
      swallowNextClick();
      const cancelled = e.type === "pointercancel";
      if (cur.mode === "x") {
        const i = TYPES.findIndex(([k]) => k === live.current.type);
        const vx = cancelled ? 0 : SWIPE_GAIN * cur.vt.velocity(e.timeStamp);
        const dir = cancelled ? 0 : -pageTarget(SWIPE_GAIN * (e.clientX - cur.x0), vx, cur.segW);
        const next = TYPES[Math.max(0, Math.min(TYPES.length - 1, i + dir))][0];
        if (next !== live.current.type) flushSync(() => live.current.setType(next));
        typeTrack.current?.(null, vx / cur.segW);
        return;
      }
      const v = cancelled ? 0 : cur.vy;
      const target = panelTarget(cur.from, sp.p.get(), sp.down.get(), range(), v);
      if (target === "close") { dismiss(); return; }
      if (sp.down.get() > 0) api.start({ down: 0, config: { ...SETTLE, velocity: v } });
      if (sp.p.get() > 0 || target === "full") settleTo(target === "full" ? 1 : 0, -v / range());
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Pickers (the keyboard steps aside while one is open, and comes back after) ----------
  const typing = useRef(false);
  const openPick = (p: Pick) => { typing.current = document.activeElement === inputRef.current; inputRef.current?.blur(); setPick(p); };
  const closePick = () => {
    setPick(null); setColorOpen(false);
    // The keyboard comes back only if it was up for the title before the picker opened.
    if (!grownRef.current && typing.current) { inputRef.current?.focus({ preventScroll: true }); showKeyboard(); }
    typing.current = false;
  };
  const pickDay = (e: number) => {
    if (lineMode) setOv((o) => ({ ...o, startDay: e }));
    else { const span = (d.endDay ?? d.startDay ?? e) - (d.startDay ?? e); setItem({ startDay: e, endDay: d.type === "EVENT" ? e + span : null }); }
  };
  const pickStart = (m: number) => {
    const len = d.startMin !== null && d.endMin !== null ? Math.max(15, d.endMin - d.startMin) : 60;
    const end = d.type === "EVENT" ? Math.min(DAY_END, m + len) : null;
    if (lineMode) setOv((o) => ({ ...o, startMin: m, endMin: end, allDay: false }));
    else setItem({ startMin: m, endMin: end, allDay: false });
  };
  const pickEnd = (m: number) => {
    const s = d.startMin ?? 0;
    const end = m > s ? m : Math.min(DAY_END, s + 15);
    if (lineMode) setOv((o) => ({ ...o, startMin: s, endMin: end, allDay: false }));
    else setItem({ endMin: end });
  };
  const setAllDay = (v: boolean) => {
    if (lineMode) setOv((o) => ({ ...o, allDay: v }));
    else setItem(v ? { allDay: true, startMin: null, endMin: null } : { allDay: false, startMin: d.startMin ?? req.min ?? 540, endMin: d.endMin ?? Math.min((d.startMin ?? req.min ?? 540) + 60, DAY_END) });
  };
  const color = snapshot().colorOf(d);
  /** Keeps the keyboard up through taps on the panel's own controls. */
  const keepFocus = (e: React.MouseEvent) => { if (!(e.target as Element).closest("input")) e.preventDefault(); };

  const parsedItem = lineMode && text.trim() && type !== "NOTE" && !clock ? d : null;
  const isEvent = d.type === "EVENT";

  /** Date, time, all day and colour: the settings the small panel can change. */
  const settings = (
    <div className="gp-chips edit">
      {(isEvent || d.startDay !== null || lineMode) && (
        <AssistChip icon="oCalendarToday" label={d.startDay === null ? "Date" : isEvent && d.endDay !== null && d.endDay > d.startDay
          ? `${formatDateShort(d.startDay)} – ${formatDateShort(d.endDay)}` : relativeDay(d.startDay)} onClick={() => openPick({ kind: "date" })} />
      )}
      {d.startDay !== null && !d.allDay && (
        <AssistChip icon="oSchedule" label={d.startMin !== null ? `${formatTime(d.startMin)}${isEvent && d.endMin !== null ? ` – ${formatTime(d.endMin)}` : ""}` : "Time"}
          onClick={() => openPick({ kind: "start" })} />
      )}
      {isEvent && <FilterChip selected={d.allDay} check onClick={() => setAllDay(!d.allDay)}>All day</FilterChip>}
      <button className="p-assist" onClick={() => { typing.current = document.activeElement === inputRef.current; inputRef.current?.blur(); setColorOpen(true); }}>
        <span className="gp-colordot" style={{ background: color }} /><span>Colour</span>
      </button>
    </div>
  );

  return (
    <div className="gp-root">
      <div ref={probe} className="gp-probe" />
      <animated.div className="gp-scrim" style={{ opacity: to([sp.hidden, sp.down, sp.ch], (h, down, ch) => 0.32 * (1 - h) * (1 - clamp01(down / Math.max(1, ch + 80)))) }}
        onMouseDown={(e) => e.preventDefault() /* the compatibility mousedown after a tap would take the focus (and keyboard) away */}
        onClick={() => { if (!grownRef.current && performance.now() - openedAt.current > 350) dismiss(); }} />
      <animated.div className="gp-panel" ref={panelRef} style={{ height: winH, transform: y.to((v) => `translate3d(0,${snapPx(v)}px,0)`) }}>
        <animated.div className="gp-bg" style={{ borderRadius: sp.p.to((p) => `${28 * (1 - p)}px ${28 * (1 - p)}px 0 0`) }} />
        {editorReady && canGrow && (
          <animated.div className={`gp-full ${grown ? "live" : ""}`} style={{ height: availH, opacity: sp.p.to((p) => clamp01(p * 12 - 0.6)) }}>
            <PhoneItemEditor id={0} occ={null} draft={draft} onDraft={setDraft} saveRef={saveRef} onClose={dismiss}
              header={<div className="gp-drag" aria-label="Drag down for the small panel"><span className="gp-handle" /></div>} />
          </animated.div>
        )}
        <animated.div ref={compactRef} className={`gp-compact ${lineMode ? "quick" : "slot"} ${grown ? "off" : ""}`} style={{ opacity: sp.p.to((p) => 1 - clamp01(p * 12)) }}
          onMouseDown={keepFocus}>
          <div className="gp-handle" />
          <Segmented<ItemType> value={lineMode ? type : d.type} options={TYPES} onChange={(t) => live.current.setType(t)} track={typeTrack} />
          {lineMode ? <>
            <input ref={inputRef} className="p-field" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" autoCapitalize="sentences"
              placeholder={type === "TASK" ? "Water plants every mon, thu 8am !alarm" : type === "EVENT" ? "Dentist tue 3pm remind 1h before #health" : "Note title"}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
            {type !== "NOTE" && !clock && settings}
            {clock && (
              <div className="gp-chips">
                <span className="p-assist static"><MIcon name={clock.kind === "timer" ? "oTimer" : "oAlarm"} size={18} /> {clockText(clock)}</span>
              </div>
            )}
            {parsedItem && <>
              {(parsedItem.freq !== "NONE" || parsed.alerts.length > 0 || parsedItem.priority > 0 || parsed.tags.length > 0 || parsed.category !== null || parsed.place !== null) && (
                <div className="gp-chips">
                  {parsed.category !== null && parsedItem.categoryId !== null && (
                    <span className="p-assist static"><span className="gp-colordot small" style={{ background: color }} /> {parsed.category}</span>
                  )}
                  {parsed.place !== null && <span className="p-assist static"><MIcon name="oLocationOn" size={18} /> {parsed.place}</span>}
                  {parsedItem.freq !== "NONE" && <span className="p-assist static"><MIcon name="oRepeat" size={18} /> {describe(parsedItem)}</span>}
                  {parsed.alerts.map(([o, t], i) => <span key={i} className="p-assist static"><MIcon name={t === "ALARM" ? "oAlarm" : "oNotificationsActive"} size={18} /> {t[0] + t.slice(1).toLowerCase()} · {offsetLabel(o)}</span>)}
                  {parsedItem.priority > 0 && <span className="p-assist static" role="img" aria-label={`${PRIORITIES[parsedItem.priority]} priority`} data-tip><MIcon name="fFlag" size={18} color={PRIORITY_COLORS_MUTED[parsedItem.priority]} /></span>}
                  {parsed.tags.map((t) => <span key={t} className="p-assist static"><MIcon name="oLabel" size={18} /> {t}</span>)}
                </div>
              )}
              <div className="gp-tip">Tip: dates (tomorrow, next fri, 27/10, 27 Oct till 8 Nov), times (at 18:30, 18-20h), "every mon", "alarm 30m before" or "10m after", #category, !1 to !4, @place{hasAlarms && <>; or "timer 10 min", "alarm 7am weekdays"</>}</div>
            </>}
          </> : <>
            <input ref={inputRef} className="gp-title" value={d.title} placeholder="Add title" enterKeyHint="done" autoCapitalize="sentences"
              onChange={(e) => setItem({ title: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
            <div className="gp-row">
              {isEvent && <FilterChip selected={d.allDay} check onClick={() => setAllDay(!d.allDay)}>All day</FilterChip>}
              <button className="p-assist" onClick={() => { typing.current = document.activeElement === inputRef.current; inputRef.current?.blur(); setColorOpen(true); }}>
                <span className="gp-colordot" style={{ background: color }} /><span>Colour</span>
              </button>
            </div>
            <div className="gp-row when">
              <MIcon name="oSchedule" />
              <TextButton onClick={() => openPick({ kind: "date" })}>{d.startDay !== null ? formatDate(d.startDay) : "Add date"}</TextButton>
              {d.startDay !== null && !d.allDay && <TextButton onClick={() => openPick({ kind: "start" })}>{formatTime(d.startMin ?? req.min ?? 540)}</TextButton>}
              {isEvent && !d.allDay && <>
                <span>–</span>
                <TextButton onClick={() => openPick({ kind: "end" })}>{formatTime(d.endMin ?? Math.min((d.startMin ?? 540) + 60, DAY_END))}</TextButton>
              </>}
            </div>
          </>}
          <div className="gp-actions">
            <TextButton onClick={() => { if (canGrow) grow(); else save(); }}>More options</TextButton>
            <span className="grow" />
            <button className="p-filled-btn" disabled={!canSave} onClick={save}>{clock ? (clock.kind === "timer" ? "Start" : "Set") : lineMode ? "Add" : "Save"}</button>
          </div>
        </animated.div>
      </animated.div>
      {pick?.kind === "date" && <DatePickerDialog value={d.startDay ?? req.day} onClose={closePick} onPick={pickDay} />}
      {pick?.kind === "start" && <TimePickerDialog value={d.startMin ?? req.min ?? 540} onClose={closePick} onPick={pickStart} />}
      {pick?.kind === "end" && <TimePickerDialog value={d.endMin ?? Math.min((d.startMin ?? 540) + 60, DAY_END)} onClose={closePick} onPick={pickEnd} />}
      {colorOpen && <ColorPickerDialog title="Colour" selected={d.color} onClose={closePick}
        onPick={(c) => { if (lineMode) setOv((o) => ({ ...o, color: c })); else setItem({ color: c }); }} />}
    </div>
  );
}
