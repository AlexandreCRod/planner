// The phone's add panel, after the native GrowingPanel: a small panel that comes up together with the
// keyboard and sits right on top of it. Dragging it up grows it continuously into the full editor
// (which is already there underneath, at full size, revealed as the panel grows); it follows the finger
// and rests anywhere until let go, then finishes opening or springs back by position and speed.
// Dragged down, it closes. Once open, the editor's own handle drags it back down the same way.
import { animated, easings, to, useSpring } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { describe } from "../../domain/recurrence.ts";
import { formatDate, formatTime, offsetLabel, relativeDay } from "../../domain/dates.ts";
import { parseQuickAdd } from "../../domain/quickadd.ts";
import { type Item, type ItemType, type Reminder, PRIORITIES, PRIORITY_COLORS, newItem } from "../../domain/types.ts";
import { saveItem, snapshot } from "../../store/store.ts";
import { go } from "../common.tsx";
import { FilterChip, MIcon } from "./chrome.tsx";
import { AssistChip, ColorPickerDialog, TextButton } from "./m3.tsx";
import { hideKeyboard, pushBack, showKeyboard, useKeyboardHeight } from "./native.ts";
import { type Draft, PhoneItemEditor, firstAlerts, switchType } from "./PhoneItem.tsx";
import { DatePickerDialog, TimePickerDialog } from "./pickers.tsx";

/** Whole device pixels: the panel is its own GPU layer, and one left at a fractional offset is drawn soft. */
const snapPx = (v: number) => Math.round(v * devicePixelRatio) / devicePixelRatio;

export interface AddRequest { mode: "quick" | "slot"; type: ItemType; day: number; min: number | null }
/** Where the new event will be, outlined on the calendar while the panel is open (Google Calendar's box). */
export interface SlotPreview { day: number; min: number; end: number; color: string }

/** Native: spring(stiffness = 600), critically damped. */
const SETTLE = { tension: 600, friction: 49 };
/** 900 dp/s, in px per ms. */
const FLING = 0.9;
const DAY_END = 24 * 60 - 1;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Close to Android's keyboard animation (fast out, slow in). */
const imeCurve = (t: number) => 1 - Math.pow(1 - t, 3.2);

/** What the quick panel's own date, time, all-day and colour controls changed (they win over the typed line). */
interface Overrides { startDay?: number | null; startMin?: number | null; endMin?: number | null; allDay?: boolean; color?: number | null }
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
  const parsed = useMemo(() => parseQuickAdd(text), [text]);
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
      endDay: ev ? day : null,
      endMin: ev ? parsed.endMin ?? (start !== null ? Math.min(start + 60, DAY_END) : null) : null,
      allDay: ev && start === null,
      freq: parsed.freq, interval: parsed.interval, weekDays: parsed.weekDays,
      priority: type === "TASK" ? parsed.priority : 0,
    });
    if ("startDay" in ov) { item.startDay = ov.startDay ?? null; if (ev) item.endDay = item.startDay; }
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

  // The outline on the calendar follows the slot panel's day, time and colour.
  useEffect(() => {
    if (!onPreview || req.mode !== "slot") return;
    if (d.startDay === null || d.allDay || d.startMin === null) { onPreview(null); return; }
    const end = d.type === "EVENT" && d.endMin !== null && d.endMin > d.startMin ? d.endMin : Math.min(d.startMin + (d.type === "EVENT" ? 60 : 30), DAY_END);
    onPreview({ day: d.startDay, min: d.startMin, end, color: snapshot().colorOf(d) });
  }, [d.startDay, d.startMin, d.endMin, d.allDay, d.type, d.color, d.categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (lineMode && type === "NOTE") {
      const id = saveItem(newItem({ type: "NOTE", title: text.trim() }));
      onClose();
      go(`note/${id}`);
      return;
    }
    if (!canSave) return;
    // The editor saves what it holds (notes typed there included); before it exists, save the draft.
    if (saveRef.current) { saveRef.current(); return; }
    const it = d.type === "EVENT" ? { ...d, endDay: d.startDay, title: d.title.trim() } : { ...d, endDay: null, endMin: null, title: d.title.trim() };
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
  useLayoutEffect(() => {
    const el = compactRef.current;
    if (!el) return;
    const measure = () => { if (sp.p.get() === 0 || sp.ch.get() === 0) api.start({ ch: el.offsetHeight, immediate: true }); };
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
    // Focus first, in the same tap, so the keyboard comes up with the panel.
    inputRef.current?.focus({ preventScroll: true });
    showKeyboard();
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
  // Small, the whole panel drags; grown, only the editor's handle strip does (its content scrolls).
  const downOnHandle = useRef(false);
  const dragging = useRef(false);
  // A tap that wobbles less than the touch slop (8 dp) is still a tap (use-gesture's default of 3 px,
  // counted along the finger's whole path, swallowed the clicks of real fingers).
  const bind = useDrag(({ first, delta: [, dy], last, tap, velocity: [, vy], direction: [, dirY] }) => {
    if (first) dragging.current = !closing.current && (!grownRef.current || downOnHandle.current);
    if (tap || !dragging.current) return;
    if (grownRef.current) {
      // Pulled back down from the full editor: the small panel comes back as it shrinks.
      grownRef.current = false;
      (document.activeElement as HTMLElement | null)?.blur?.();
      setGrown(false);
    }
    if (!last) {
      let p = sp.p.get(), down = sp.down.get();
      // Finger up: first undo any pull-down, then grow. Finger down: shrink, then pull away.
      if (dy < 0) {
        const up = -dy;
        if (down > 0) down = Math.max(0, down - up);
        else if (canGrow) p = Math.min(1, p + up / range());
      } else {
        if (p > 0) p = Math.max(0, p - dy / range());
        else down += dy;
      }
      api.start({ p, down, immediate: true });
      return;
    }
    dragging.current = false;
    // Decided on release only: where it is, and a fling wins over that.
    const v = vy * dirY; // px per ms, positive downwards
    const p = sp.p.get(), down = sp.down.get();
    if (down > 0) {
      if (v > FLING || down > sp.ch.get() * 0.35) dismiss();
      else api.start({ down: 0, config: SETTLE });
    } else if (p > 0) {
      const target = v < -FLING ? 1 : v > FLING ? 0 : p > 0.5 ? 1 : 0;
      settleTo(target, -v / range());
    }
  }, { axis: "y", threshold: 8, filterTaps: true, tapsThreshold: 10, pointer: { capture: false } });

  // ---------- Pickers (the keyboard steps aside while one is open, and comes back after) ----------
  const openPick = (p: Pick) => { inputRef.current?.blur(); setPick(p); };
  const closePick = () => { setPick(null); setColorOpen(false); if (!grownRef.current) { inputRef.current?.focus({ preventScroll: true }); showKeyboard(); } };
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

  const parsedItem = lineMode && text.trim() && type !== "NOTE" ? d : null;
  const isEvent = d.type === "EVENT";

  /** Date, time, all day and colour: the settings the small panel can change. */
  const settings = (
    <div className="gp-chips edit">
      {(isEvent || d.startDay !== null || lineMode) && (
        <AssistChip icon="oCalendarToday" label={d.startDay !== null ? relativeDay(d.startDay) : "Date"} onClick={() => openPick({ kind: "date" })} />
      )}
      {d.startDay !== null && !d.allDay && (
        <AssistChip icon="oSchedule" label={d.startMin !== null ? `${formatTime(d.startMin)}${isEvent && d.endMin !== null ? ` – ${formatTime(d.endMin)}` : ""}` : "Time"}
          onClick={() => openPick({ kind: "start" })} />
      )}
      {isEvent && <FilterChip selected={d.allDay} check onClick={() => setAllDay(!d.allDay)}>All day</FilterChip>}
      <button className="p-assist" onClick={() => { inputRef.current?.blur(); setColorOpen(true); }}>
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
      <animated.div className="gp-panel" style={{ height: winH, transform: y.to((v) => `translate3d(0,${snapPx(v)}px,0)`) }}
        onPointerDownCapture={(e) => { downOnHandle.current = !!(e.target as Element).closest(".gp-drag"); }} {...bind()}>
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
          {lineMode ? <>
            <div className="p-seg">
              {(["TASK", "EVENT", "NOTE"] as ItemType[]).map((t) => (
                <button key={t} className={type === t ? "on" : ""} onClick={() => setType(t)}>{type === t && <span className="tick">✓</span>}{t[0] + t.slice(1).toLowerCase()}</button>
              ))}
            </div>
            <input ref={inputRef} className="p-field" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" autoCapitalize="sentences"
              placeholder={type === "TASK" ? "Water plants every mon, thu 8am !alarm" : type === "EVENT" ? "Dentist tue 3pm remind 1h before #health" : "Note title"}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
            {type !== "NOTE" && settings}
            {parsedItem && <>
              {(parsedItem.freq !== "NONE" || parsed.alerts.length > 0 || parsedItem.priority > 0 || parsed.tags.length > 0) && (
                <div className="gp-chips">
                  {parsedItem.freq !== "NONE" && <span className="p-assist static"><MIcon name="oRepeat" size={18} /> {describe(parsedItem)}</span>}
                  {parsed.alerts.map(([o, t], i) => <span key={i} className="p-assist static"><MIcon name={t === "ALARM" ? "oAlarm" : "oNotificationsActive"} size={18} /> {t[0] + t.slice(1).toLowerCase()} · {offsetLabel(o)}</span>)}
                  {parsedItem.priority > 0 && <span className="p-assist static"><MIcon name="oFlag" size={18} color={PRIORITY_COLORS[parsedItem.priority]} /> {PRIORITIES[parsedItem.priority]} priority</span>}
                  {parsed.tags.map((t) => <span key={t} className="p-assist static"><MIcon name="oLabel" size={18} /> {t}</span>)}
                </div>
              )}
              <div className="gp-tip">Tip: dates (tomorrow, fri, 12/3), times (3pm, 15:30), "every mon, wed", "remind 30m before", !alarm, !high, #tag</div>
            </>}
          </> : <>
            <input ref={inputRef} className="gp-title" value={d.title} placeholder="Add title" enterKeyHint="done" autoCapitalize="sentences"
              onChange={(e) => setItem({ title: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
            <div className="gp-row">
              {(["EVENT", "TASK"] as const).map((t) => (
                <FilterChip key={t} selected={d.type === t} onClick={() => setDraft((x) => switchType(x, t))}>{t === "EVENT" ? "Event" : "Task"}</FilterChip>
              ))}
              {isEvent && <FilterChip selected={d.allDay} check onClick={() => setAllDay(!d.allDay)}>All day</FilterChip>}
              <button className="p-assist" onClick={() => { inputRef.current?.blur(); setColorOpen(true); }}>
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
            <button className="p-filled-btn" disabled={!canSave} onClick={save}>{lineMode ? "Add" : "Save"}</button>
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
