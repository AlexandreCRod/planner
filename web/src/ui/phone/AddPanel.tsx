// The phone's add panel, after the native GrowingPanel: a small panel that comes up together with the
// keyboard and sits right on top of it. Dragging it up grows it continuously into the full editor
// (which is already there underneath, at full size, revealed as the panel grows); it follows the finger
// and rests anywhere until let go, then finishes opening or springs back by position and speed.
// Dragged down, it closes.
import { animated, easings, to, useSpring } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { describe } from "../../domain/recurrence.ts";
import { formatDate, formatTime, offsetLabel, relativeDay } from "../../domain/dates.ts";
import { parseQuickAdd } from "../../domain/quickadd.ts";
import { type Item, type ItemType, type Reminder, PRIORITIES, PRIORITY_COLORS, newItem } from "../../domain/types.ts";
import { saveItem } from "../../store/store.ts";
import { Icon, go } from "../common.tsx";
import { type Draft, ItemEditor } from "../ItemEditor.tsx";
import { hapticLight, hideKeyboard, pushBack, showKeyboard, useKeyboardHeight } from "./native.ts";

/** Whole device pixels: the panel is its own GPU layer, and one left at a fractional offset is drawn soft. */
const snapPx = (v: number) => Math.round(v * devicePixelRatio) / devicePixelRatio;

export interface AddRequest { mode: "quick" | "slot"; type: ItemType; day: number; min: number | null }

/** Native: spring(stiffness = 600), critically damped. */
const SETTLE = { tension: 600, friction: 49 };
/** 900 dp/s, in px per ms. */
const FLING = 0.9;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Close to Android's keyboard animation (fast out, slow in). */
const imeCurve = (t: number) => 1 - Math.pow(1 - t, 3.2);

/** A new item's first alert, as the editor gives it: a reminder 15 min before an event, a silent notification for a dated task. */
function defaultAlerts(item: Item): Reminder[] {
  if (item.startDay === null) return [];
  const ev = item.type === "EVENT";
  return [{ id: 0, itemId: 0, offsetMin: ev && item.startMin !== null ? 15 : 0, type: ev ? "REMINDER" : "NOTIFICATION", soundUri: null }];
}

export function AddPanel({ req, onClose }: { req: AddRequest; onClose: () => void }) {
  const kb = useKeyboardHeight();
  const [winH, setWinH] = useState(window.innerHeight);
  const [nav, setNav] = useState(0);
  const probe = useRef<HTMLDivElement>(null);
  const compactRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<(() => void) | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [grown, setGrown] = useState(false);
  const closing = useRef(false);
  // The tap that opened the panel (on a calendar slot) ends with a click that lands on the new scrim.
  const openedAt = useRef(performance.now());
  const grownRef = useRef(false);

  // ---------- What's being added ----------
  const [type, setType] = useState<ItemType>(req.type);
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const quick = req.mode === "quick";
  const buildQuick = (): Draft => {
    const day = parsed.day ?? (type === "EVENT" ? req.day : null);
    const start = parsed.startMin;
    const item = newItem({
      type: type === "NOTE" ? "TASK" : type,
      title: parsed.title || text.trim(),
      startDay: day ?? (parsed.freq !== "NONE" ? req.day : null),
      startMin: start,
      endDay: type === "EVENT" ? day : null,
      endMin: type === "EVENT" ? parsed.endMin ?? (start !== null ? Math.min(start + 60, 1439) : null) : null,
      allDay: type === "EVENT" && start === null,
      freq: parsed.freq, interval: parsed.interval, weekDays: parsed.weekDays,
      priority: type === "TASK" ? parsed.priority : 0,
    });
    const reminders = parsed.alerts.length
      ? parsed.alerts.map(([offsetMin, t]): Reminder => ({ id: 0, itemId: 0, offsetMin, type: t, soundUri: null }))
      : defaultAlerts(item);
    return { item, reminders, tags: parsed.tags.join(" ") };
  };
  const [draft, setDraft] = useState<Draft>(() => {
    if (quick) return { item: newItem({ type: req.type, startDay: req.type === "EVENT" ? req.day : null, allDay: req.type === "EVENT" }), reminders: [], tags: "" };
    const min = req.min ?? 540;
    const item = newItem({ type: "EVENT", startDay: req.day, endDay: req.day, startMin: min, endMin: Math.min(min + 60, 1439) });
    return { item, reminders: defaultAlerts(item), tags: "" };
  });
  // While small, the quick panel's line is what the editor will open with.
  useEffect(() => { if (quick && !grownRef.current) setDraft(buildQuick()); }, [text, type]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = draft.item;
  const canGrow = !(quick && type === "NOTE");
  const canSave = quick ? text.trim() !== "" || type === "NOTE" : d.title.trim() !== "";

  const save = () => {
    if (quick && type === "NOTE") {
      const id = saveItem(newItem({ type: "NOTE", title: text.trim() }));
      onClose();
      go(`note/${id}`);
      return;
    }
    if (!canSave) return;
    hapticLight();
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
  }, [api, sp, grown]);

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
        requestAnimationFrame(() => {
          const title = document.querySelector<HTMLInputElement>(".gp-full .title-input");
          if (hadFocus && title) title.focus({ preventScroll: true });
        });
      },
    });
  };
  const grow = () => { if (canGrow) settleTo(1); };

  // ---------- The drag ----------
  // A tap that wobbles less than the touch slop (8 dp) is still a tap (use-gesture's default of 3 px,
  // counted along the finger's whole path, swallowed the clicks of real fingers).
  const bind = useDrag(({ delta: [, dy], last, tap, velocity: [, vy], direction: [, dirY] }) => {
    if (tap || grownRef.current || closing.current) return;
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

  const parsedItem = quick && text.trim() && type !== "NOTE" ? draft.item : null;

  return (
    <div className="gp-root">
      <div ref={probe} className="gp-probe" />
      <animated.div className="gp-scrim" style={{ opacity: to([sp.hidden, sp.down, sp.ch], (h, down, ch) => 0.32 * (1 - h) * (1 - clamp01(down / Math.max(1, ch + 80)))) }}
        onMouseDown={(e) => e.preventDefault() /* the compatibility mousedown after a tap would take the focus (and keyboard) away */}
        onClick={() => { if (!grownRef.current && performance.now() - openedAt.current > 350) dismiss(); }} />
      <animated.div className="gp-panel" style={{ height: winH, transform: y.to((v) => `translate3d(0,${snapPx(v)}px,0)`) }} {...(grown ? {} : bind())}>
        <animated.div className="gp-bg" style={{ borderRadius: sp.p.to((p) => `${28 * (1 - p)}px ${28 * (1 - p)}px 0 0`) }} />
        {editorReady && canGrow && (
          <animated.div className={`gp-full ${grown ? "live" : ""}`} style={{ height: availH, opacity: sp.p.to((p) => clamp01(p * 12 - 0.6)) }}>
            <ItemEditor id={0} occurrence={null} isNewPlaceholder draft={draft} onDraft={setDraft} embedded saveRef={saveRef} onClose={onClose} />
          </animated.div>
        )}
        {!grown && (
          <animated.div ref={compactRef} className={`gp-compact ${quick ? "quick" : "slot"}`} style={{ opacity: sp.p.to((p) => 1 - clamp01(p * 12)) }}>
            <div className="gp-handle" />
            {quick ? <>
              <div className="p-seg">
                {(["TASK", "EVENT", "NOTE"] as ItemType[]).map((t) => (
                  <button key={t} className={type === t ? "on" : ""} onClick={() => setType(t)}>{type === t && <span className="tick">✓</span>}{t[0] + t.slice(1).toLowerCase()}</button>
                ))}
              </div>
              <input ref={inputRef} className="p-field" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" autoCapitalize="sentences"
                placeholder={type === "TASK" ? "Water plants every mon, thu 8am !alarm" : type === "EVENT" ? "Dentist tue 3pm remind 1h before #health" : "Note title"}
                onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
              {parsedItem && <>
                <div className="gp-chips">
                  {parsedItem.startDay !== null && <span className="p-assist"><Icon name="calendar" size={16} /> {relativeDay(parsedItem.startDay)}</span>}
                  {parsedItem.startMin !== null && <span className="p-assist"><Icon name="schedule" size={16} /> {formatTime(parsedItem.startMin)}{parsedItem.endMin !== null ? ` – ${formatTime(parsedItem.endMin)}` : ""}</span>}
                  {parsedItem.freq !== "NONE" && <span className="p-assist"><Icon name="repeat" size={16} /> {describe(parsedItem)}</span>}
                  {parsed.alerts.map(([o, t], i) => <span key={i} className="p-assist"><Icon name={t === "ALARM" ? "alarm" : "bell"} size={16} /> {t[0] + t.slice(1).toLowerCase()} · {offsetLabel(o)}</span>)}
                  {parsedItem.priority > 0 && <span className="p-assist"><Icon name="flag" size={16} color={PRIORITY_COLORS[parsedItem.priority]} /> {PRIORITIES[parsedItem.priority]} priority</span>}
                  {parsed.tags.map((t) => <span key={t} className="p-assist"><Icon name="label" size={16} /> {t}</span>)}
                </div>
                <div className="gp-tip">Tip: dates (tomorrow, fri, 12/3), times (3pm, 15:30), "every mon, wed", "remind 30m before", !alarm, !high, #tag</div>
              </>}
            </> : <>
              <input ref={inputRef} className="gp-title" value={d.title} placeholder="Add title" enterKeyHint="done" autoCapitalize="sentences"
                onChange={(e) => setDraft({ ...draft, item: { ...d, title: e.target.value } })} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
              <div className="gp-row">
                {(["EVENT", "TASK"] as const).map((t) => (
                  <button key={t} className={`p-filter ${d.type === t ? "on" : ""}`} onClick={() => {
                    const item = t === "EVENT"
                      ? { ...d, type: t, endDay: d.startDay, endMin: d.startMin !== null ? Math.min(d.startMin + 60, 1439) : null }
                      : { ...d, type: t, endDay: null, endMin: null };
                    setDraft({ ...draft, item, reminders: defaultAlerts(item) });
                  }}>{d.type === t && <span className="tick">✓</span>}{t === "EVENT" ? "Event" : "Task"}</button>
                ))}
              </div>
              <div className="gp-row when">
                <Icon name="schedule" size={22} />
                <PickButton kind="date" label={formatDate(d.startDay ?? req.day)} value={d.startDay} onPick={(v) => setDraft({ ...draft, item: { ...d, startDay: v, endDay: d.type === "EVENT" ? v : null } })} />
                <PickButton kind="time" label={formatTime(d.startMin ?? 540)} value={d.startMin} onPick={(v) => {
                  const len = Math.max(15, (d.endMin ?? (d.startMin ?? 540) + 60) - (d.startMin ?? 540));
                  setDraft({ ...draft, item: { ...d, startMin: v, endMin: d.type === "EVENT" ? Math.min(1439, v + len) : null } });
                }} />
                {d.type === "EVENT" && <>
                  <span>–</span>
                  <PickButton kind="time" label={formatTime(d.endMin ?? 600)} value={d.endMin} onPick={(v) => setDraft({ ...draft, item: { ...d, endMin: v > (d.startMin ?? 0) ? v : Math.min(1439, (d.startMin ?? 0) + 15) } })} />
                </>}
              </div>
            </>}
            <div className="gp-actions">
              <button className="p-text-btn" onClick={() => { if (canGrow) grow(); else save(); }}>More options</button>
              <span className="grow" />
              <button className="p-filled-btn" disabled={!canSave} onClick={save}>{quick ? "Add" : "Save"}</button>
            </div>
          </animated.div>
        )}
      </animated.div>
    </div>
  );
}

/** A text button that opens Android's own date or time picker. */
function PickButton({ kind, label, value, onPick }: { kind: "date" | "time"; label: string; value: number | null; onPick: (v: number) => void }) {
  const v = value === null ? "" : kind === "time"
    ? `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
    : new Date(value * 86_400_000).toISOString().slice(0, 10);
  return (
    <label className="p-text-btn pick">
      {label}
      <input type={kind} value={v} onChange={(e) => {
        const s = e.target.value;
        if (!s) return;
        if (kind === "time") { const [h, m] = s.split(":").map(Number); onPick(h * 60 + m); }
        else { const [y, m, dd] = s.split("-").map(Number); onPick(Math.round(Date.UTC(y, m - 1, dd) / 86_400_000)); }
      }} />
    </label>
  );
}
