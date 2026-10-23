// Material 3 date and time pickers, as the native app shows them (Compose's DatePickerDialog and the
// TimePicker dial in an AlertDialog, see DatePickDialog / TimePickDialog in Common.kt), instead of the
// browser's own <input type=date|time> pop-ups.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addMonths, daysInMonth, epochOf, formatDate, monthLong, startOfWeek, today as todayEpoch, use24h, ymd } from "../../domain/dates.ts";
import { IconButton, MIcon, ModalLayer } from "./chrome.tsx";
import { BottomSheet, TextButton } from "./m3.tsx";
import { pushBack } from "./native.ts";
import { feel } from "./haptics.ts";
import { useSwipePager } from "./pager.ts";
import { magnetMinute } from "./dial.ts";

const mondayFirst = () => localStorage.getItem("weekStartsMonday") !== "false";
const WD = ["M", "T", "W", "T", "F", "S", "S"];

/** The modal scrim and container both pickers sit in; back and a tap outside cancel. */
function PickerShell({ onClose, className, children }: { onClose: () => void; className: string; children: React.ReactNode }) {
  useEffect(() => pushBack(onClose), []); // eslint-disable-line react-hooks/exhaustive-deps
  return <ModalLayer onClose={onClose}><div className={className} role="dialog">{children}</div></ModalLayer>;
}

// ---------- Date ----------

/** M3 modal date picker: the chosen date as the headline, months that swipe, a year list, Cancel / OK. */
export function DatePickerDialog({ value, onPick, onClose }: { value: number | null; onPick: (day: number) => void; onClose: () => void }) {
  const t = todayEpoch();
  const [sel, setSel] = useState(value ?? t);
  const [month, setMonth] = useState(() => { const { y, m } = ymd(value ?? t); return epochOf(y, m, 1); });
  const [years, setYears] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const pager = useSwipePager<HTMLDivElement>({ layers: () => [strip.current], onStep: (dir) => setMonth((m) => addMonths(m, dir)) });
  const { y, m } = ymd(month);
  return (
    <PickerShell onClose={onClose} className="p-datepicker">
      <div className="p-dp-title">Select date</div>
      <div className="p-dp-headline">{formatDate(sel)}</div>
      <div className="p-divider" />
      <div className="p-dp-nav">
        <button className="p-dp-month" onClick={() => setYears(!years)}>
          {monthLong(m)} {y}<MIcon name="fArrowDropDown" size={18} />
        </button>
        <span className="grow" />
        {!years && <>
          <IconButton icon="fKeyboardArrowLeft" label="Previous month" onClick={() => setMonth(addMonths(month, -1))} />
          <IconButton icon="fKeyboardArrowRight" label="Next month" onClick={() => setMonth(addMonths(month, 1))} />
        </>}
      </div>
      {years ? (
        <YearList year={y} onPick={(yy) => { setMonth(epochOf(yy, m, 1)); setYears(false); }} />
      ) : <>
        <div className="p-dp-week">{weekLabels().map((l, i) => <span key={i}>{l}</span>)}</div>
        <div className="p-hpager p-dp-pager" ref={pager}>
          <div className="p-hstrip" ref={strip}>
            {[addMonths(month, -1), month, addMonths(month, 1)].map((first, i) => (
              <div key={first} className={`p-hpanel ${i === 1 ? "cur" : ""}`} style={{ left: `${(i - 1) * 100}%` }} aria-hidden={i !== 1}>
                <MonthDays first={first} sel={sel} today={t} onPick={setSel} />
              </div>
            ))}
          </div>
        </div>
      </>}
      <div className="p-dp-actions">
        <TextButton onClick={onClose}>Cancel</TextButton>
        <TextButton onClick={() => { onPick(sel); onClose(); }}>OK</TextButton>
      </div>
    </PickerShell>
  );
}

/**
 * Several days on a calendar: tap a day to pick it or leave it, or drag across days to pick (or, from
 * a picked day, leave) all of them at once. Days before [from] can't be picked. Months turn with the
 * arrows, so a sideways drag is always a range.
 */
export function MultiDatePickerDialog({ title, value, from, onPick, onClose }: {
  title: string; value: number[]; from: number; onPick: (days: number[]) => void; onClose: () => void;
}) {
  const t = todayEpoch();
  const [sel, setSel] = useState<ReadonlySet<number>>(() => new Set(value.filter((d) => d >= from)));
  const [month, setMonth] = useState(() => {
    const first = value.filter((d) => d >= from).sort((a, b) => a - b)[0] ?? Math.max(t, from);
    const { y, m } = ymd(first);
    return epochOf(y, m, 1);
  });
  const drag = useRef<{ id: number; from: number; add: boolean; base: ReadonlySet<number>; last: number } | null>(null);
  const dayAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
    const d = el ? Number(el.dataset.day) : NaN;
    return Number.isFinite(d) && d >= from ? d : null;
  };
  const apply = (d: NonNullable<typeof drag.current>, to: number) => {
    const next = new Set(d.base);
    for (let x = Math.min(d.from, to); x <= Math.max(d.from, to); x++) if (x >= from) { if (d.add) next.add(x); else next.delete(x); }
    setSel(next);
  };
  const { y, m } = ymd(month);
  const lead = month - startOfWeek(month, mondayFirst());
  const n = daysInMonth(y, m);
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: n }, (_, i) => month + i)];
  while (cells.length < 42) cells.push(null);
  const count = sel.size;
  return (
    <PickerShell onClose={onClose} className="p-datepicker p-mdp">
      <div className="p-dp-title">{title}</div>
      <div className="p-dp-headline">{count === 0 ? "No days" : count === 1 ? formatDate([...sel][0]) : `${count} days`}</div>
      <div className="p-divider" />
      <div className="p-dp-nav">
        <span className="p-dp-month static">{monthLong(m)} {y}</span>
        <span className="grow" />
        <IconButton icon="fKeyboardArrowLeft" label="Previous month" onClick={() => setMonth(addMonths(month, -1))} />
        <IconButton icon="fKeyboardArrowRight" label="Next month" onClick={() => setMonth(addMonths(month, 1))} />
      </div>
      <div className="p-dp-week">{weekLabels().map((l, i) => <span key={i}>{l}</span>)}</div>
      <div className="p-dp-days p-mdp-days"
        onPointerDown={(e) => {
          if (drag.current || (e.pointerType === "mouse" && e.button !== 0)) return;
          const d = dayAt(e.clientX, e.clientY);
          if (d === null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, from: d, add: !sel.has(d), base: sel, last: d };
          apply(drag.current, d);
          feel("tick");
        }}
        onPointerMove={(e) => {
          const g = drag.current;
          if (!g || e.pointerId !== g.id) return;
          const d = dayAt(e.clientX, e.clientY);
          if (d === null || d === g.last) return;
          g.last = d;
          apply(g, d);
          feel("tick");
        }}
        onPointerUp={(e) => { if (drag.current?.id === e.pointerId) drag.current = null; }}
        onPointerCancel={(e) => { if (drag.current?.id === e.pointerId) drag.current = null; }}>
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const on = sel.has(d), col = i % 7;
          const cls = [on ? "sel" : "", d === t ? "today" : "", d < from ? "past" : "",
            on && col > 0 && sel.has(d - 1) ? "joinl" : "", on && col < 6 && sel.has(d + 1) ? "joinr" : ""].join(" ");
          return <button key={i} data-day={d} className={cls} disabled={d < from} aria-pressed={on}><span>{ymd(d).d}</span></button>;
        })}
      </div>
      <div className="p-dp-actions">
        {count > 0 && <TextButton onClick={() => setSel(new Set())}>Clear</TextButton>}
        <span className="grow" />
        <TextButton onClick={onClose}>Cancel</TextButton>
        <TextButton onClick={() => { onPick([...sel].sort((a, b) => a - b)); onClose(); }}>OK</TextButton>
      </div>
    </PickerShell>
  );
}

/**
 * Going to a day (Today's title): the app's bottom sheet with a month that swipes or turns with the
 * arrows; a tap on a day goes there and closes it.
 */
export function DayPickerSheet({ value, onPick, onClose }: { value: number; onPick: (day: number) => void; onClose: () => void }) {
  const t = todayEpoch();
  const [month, setMonth] = useState(() => { const { y, m } = ymd(value); return epochOf(y, m, 1); });
  const strip = useRef<HTMLDivElement>(null);
  const pager = useSwipePager<HTMLDivElement>({ layers: () => [strip.current], onStep: (dir) => setMonth((m) => addMonths(m, dir)) });
  const { y, m } = ymd(month);
  const thisMonth = (() => { const n = ymd(t); return epochOf(n.y, n.m, 1); })();
  return (
    <BottomSheet onClose={onClose} className="p-daysheet">{(close) => <>
      <div className="p-dp-nav">
        <span className="p-dp-month static">{monthLong(m)} {y}</span>
        <span className="grow" />
        {month !== thisMonth && <TextButton onClick={() => { onPick(t); close(); }}>Today</TextButton>}
        <IconButton icon="fKeyboardArrowLeft" label="Previous month" onClick={() => setMonth(addMonths(month, -1))} />
        <IconButton icon="fKeyboardArrowRight" label="Next month" onClick={() => setMonth(addMonths(month, 1))} />
      </div>
      <div className="p-dp-week">{weekLabels().map((l, i) => <span key={i}>{l}</span>)}</div>
      <div className="p-hpager p-dp-pager" ref={pager}>
        <div className="p-hstrip" ref={strip}>
          {[addMonths(month, -1), month, addMonths(month, 1)].map((first, i) => (
            <div key={first} className={`p-hpanel ${i === 1 ? "cur" : ""}`} style={{ left: `${(i - 1) * 100}%` }} aria-hidden={i !== 1}>
              <MonthDays first={first} sel={value} today={t} onPick={(d) => { onPick(d); close(); }} />
            </div>
          ))}
        </div>
      </div>
    </>}</BottomSheet>
  );
}

function weekLabels() {
  return mondayFirst() ? WD : [WD[6], ...WD.slice(0, 6)];
}

function MonthDays({ first, sel, today, onPick }: { first: number; sel: number; today: number; onPick: (d: number) => void }) {
  const { y, m } = ymd(first);
  const lead = first - startOfWeek(first, mondayFirst());
  const n = daysInMonth(y, m);
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: n }, (_, i) => first + i)];
  while (cells.length < 42) cells.push(null);
  return (
    <div className="p-dp-days">
      {cells.map((d, i) => d === null ? <span key={i} /> : (
        <button key={i} className={`${d === sel ? "sel" : ""} ${d === today ? "today" : ""}`} onClick={() => onPick(d)}>
          <span>{ymd(d).d}</span>
        </button>
      ))}
    </div>
  );
}

function YearList({ year, onPick }: { year: number; onPick: (y: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const list = useMemo(() => Array.from({ length: 201 }, (_, i) => 1926 + i), []);
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(".sel");
    if (el && box.current) box.current.scrollTop = el.offsetTop - box.current.clientHeight / 2 + 18;
  }, []);
  return (
    <div className="p-dp-years" ref={box}>
      {list.map((yy) => <button key={yy} className={yy === year ? "sel" : ""} onClick={() => onPick(yy)}><span>{yy}</span></button>)}
    </div>
  );
}

// ---------- Time ----------

const DIAL = 256, C = DIAL / 2, OUTER = 101, INNER = 69;

/**
 * M3 time picker dial: the hour and minute boxes (the chosen one filled), AM / PM in the 12-hour
 * clock, and the clock face: touch or drag the hand to a number. Picking the hour moves on to the
 * minutes. The 24-hour face has 12–23 on an inner ring, as Compose's.
 */
export function TimePickerDialog({ value, onPick, onClose }: { value: number | null; onPick: (min: number) => void; onClose: () => void }) {
  const h24 = use24h();
  const [min, setMin] = useState(value ?? 9 * 60);
  const [mode, setMode] = useState<"h" | "m">("h");
  const hour = Math.floor(min / 60), minute = min % 60;
  const dial = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const minRef = useRef(min);
  minRef.current = min;

  const fromPoint = (clientX: number, clientY: number, snap: boolean) => {
    const r = dial.current!.getBoundingClientRect();
    const dx = clientX - (r.left + C), dy = clientY - (r.top + C);
    let a = Math.atan2(dx, -dy) / (2 * Math.PI);
    if (a < 0) a += 1;
    const cur = minRef.current;
    const h = Math.floor(cur / 60), mm = cur % 60;
    if (modeRef.current === "h") {
      let i = Math.round(a * 12) % 12;
      let nh: number;
      if (h24) {
        const inner = Math.hypot(dx, dy) < (OUTER + INNER) / 2;
        nh = inner ? (i === 0 ? 12 : i + 12) : i;
        if (inner && i === 0) nh = 12;
        if (!inner && i === 0) nh = 0;
      } else {
        if (i === 0) i = 12;
        nh = (i % 12) + (h >= 12 ? 12 : 0);
      }
      setMin(nh * 60 + mm);
    } else {
      // A touch lands on the nearest five; a drag can stop on any minute, drawn gently onto the fives.
      const nm = snap ? (Math.round(a * 12) * 5) % 60 : magnetMinute(a);
      if (!snap && nm !== mm && nm % 5 === 0) feel("tick");
      setMin(h * 60 + nm);
    }
  };

  useEffect(() => {
    const el = dial.current;
    if (!el) return;
    let id: number | null = null;
    let moved = false;
    const down = (e: PointerEvent) => { id = e.pointerId; moved = false; el.setPointerCapture(e.pointerId); fromPoint(e.clientX, e.clientY, true); };
    const move = (e: PointerEvent) => { if (e.pointerId !== id) return; moved = true; fromPoint(e.clientX, e.clientY, false); };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!moved) fromPoint(e.clientX, e.clientY, true);
      if (modeRef.current === "h") setMode("m");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The numbers on the face, and where the hand points.
  const labels: { text: string; x: number; y: number; on: boolean; inner?: boolean }[] = [];
  let handAngle: number, handR = OUTER;
  if (mode === "h") {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      const outerHour = h24 ? i : i === 0 ? 12 : i;
      labels.push({ text: h24 ? String(outerHour).padStart(2, "0") : String(outerHour), x: C + OUTER * Math.sin(a), y: C - OUTER * Math.cos(a), on: h24 ? hour === i : hour % 12 === i % 12 });
      if (h24) {
        const innerHour = i === 0 ? 12 : i + 12;
        labels.push({ text: String(innerHour), x: C + INNER * Math.sin(a), y: C - INNER * Math.cos(a), on: hour === innerHour, inner: true });
      }
    }
    handAngle = ((hour % 12) / 12) * 360;
    if (h24 && hour >= 12) handR = INNER;
  } else {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      labels.push({ text: String(i * 5).padStart(2, "0"), x: C + OUTER * Math.sin(a), y: C - OUTER * Math.cos(a), on: minute === i * 5 });
    }
    handAngle = (minute / 60) * 360;
  }
  const hx = C + handR * Math.sin((handAngle * Math.PI) / 180), hy = C - handR * Math.cos((handAngle * Math.PI) / 180);
  const hourText = h24 ? String(hour).padStart(2, "0") : String(hour % 12 === 0 ? 12 : hour % 12);

  return (
    <PickerShell onClose={onClose} className="p-timepicker">
      <div className="p-tp-title">Select time</div>
      <div className="p-tp-display">
        <button className={`p-tp-box ${mode === "h" ? "on" : ""}`} onClick={() => setMode("h")}>{hourText}</button>
        <span className="p-tp-colon">:</span>
        <button className={`p-tp-box ${mode === "m" ? "on" : ""}`} onClick={() => setMode("m")}>{String(minute).padStart(2, "0")}</button>
        {!h24 && (
          <div className="p-tp-period">
            <button className={hour < 12 ? "on" : ""} onClick={() => { if (hour >= 12) setMin(min - 720); }}>AM</button>
            <button className={hour >= 12 ? "on" : ""} onClick={() => { if (hour < 12) setMin(min + 720); }}>PM</button>
          </div>
        )}
      </div>
      <div className="p-tp-dial" ref={dial}>
        <svg width={DIAL} height={DIAL} aria-hidden="true">
          <line x1={C} y1={C} x2={hx} y2={hy} className="hand" />
          <circle cx={C} cy={C} r={4} className="hub" />
          <circle cx={hx} cy={hy} r={24} className="knob" />
        </svg>
        {labels.map((l, i) => (
          <span key={i} className={`num ${l.on ? "on" : ""} ${l.inner ? "inner" : ""}`} style={{ left: l.x - 24, top: l.y - 24 }}>{l.text}</span>
        ))}
      </div>
      <div className="p-dp-actions">
        <TextButton onClick={onClose}>Cancel</TextButton>
        <TextButton onClick={() => { onPick(min); onClose(); }}>OK</TextButton>
      </div>
    </PickerShell>
  );
}
