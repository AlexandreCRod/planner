// Material 3 date and time pickers, as the native app shows them (Compose's DatePickerDialog and the
// time picker, now scroll wheels (220)), instead of the browser's own <input type=date|time> pop-ups.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addMonths, daysInMonth, epochOf, formatDate, formatDateShort, monthLong, startOfWeek, today as todayEpoch, ymd } from "../../domain/dates.ts";
import { IconButton, MIcon, ModalLayer } from "./chrome.tsx";
import { BottomSheet, TextButton } from "./m3.tsx";
import { pushBack } from "./native.ts";
import { feel } from "./haptics.ts";
import { useSwipePager } from "./pager.ts";
import { TimeWheels } from "./TimeWheel.tsx";
import { type RangePick, rangeRole, slideRange, slideTicks, tapRange } from "./range.ts";

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
 * A run of days (a multi-day event's dates), in one calendar like the skip-days picker: tap the start
 * day, then the end day; or press the start day and slide across the days (down, across, or both), the
 * range following the finger and ending where it lifts; off the calendar, the last day it was on
 * counts. The ends are filled circles, the days between a band in the same tone; a light tick when the
 * finger moves on to another day, spaced well apart (range.ts), and one for a tap.
 * [next] is the end a first tap sets (the end, when opened from the end date).
 */
export function RangeDatePickerDialog({ title = "Select dates", start, end, next = "start", onPick, onClose }: {
  title?: string; start: number; end: number; next?: "start" | "end"; onPick: (start: number, end: number) => void; onClose: () => void;
}) {
  const t = todayEpoch();
  const [r, setR] = useState<RangePick>(() => ({ start, end: Math.max(start, end), next }));
  const [month, setMonth] = useState(() => { const { y, m } = ymd(next === "end" ? Math.max(start, end) : start); return epochOf(y, m, 1); });
  const drag = useRef<{ id: number; anchor: number; last: number; moved: boolean; base: RangePick } | null>(null);
  const tickAt = useRef(-Infinity);
  const dayAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
    const d = el ? Number(el.dataset.day) : NaN;
    return Number.isFinite(d) ? d : null;
  };
  const { y, m } = ymd(month);
  const lead = month - startOfWeek(month, mondayFirst());
  const n = daysInMonth(y, m);
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: n }, (_, i) => month + i)];
  while (cells.length < 42) cells.push(null);
  const end1 = r.next === "end" && drag.current === null; // the end is still to be picked
  return (
    <PickerShell onClose={onClose} className="p-datepicker p-mdp p-rdp">
      <div className="p-dp-title">{title}</div>
      <div className="p-dp-headline p-rdp-head">
        <span className={r.next === "start" ? "on" : ""}>{formatDateShort(r.start)}</span>
        <span className="sep">–</span>
        <span className={r.next === "end" ? "on" : ""}>{end1 ? "End" : formatDateShort(r.end)}</span>
      </div>
      <div className="p-divider" />
      <div className="p-dp-nav">
        <span className="p-dp-month static">{monthLong(m)} {y}</span>
        <span className="grow" />
        <IconButton icon="fKeyboardArrowLeft" label="Previous month" onClick={() => setMonth(addMonths(month, -1))} />
        <IconButton icon="fKeyboardArrowRight" label="Next month" onClick={() => setMonth(addMonths(month, 1))} />
      </div>
      <div className="p-dp-week">{weekLabels().map((l, i) => <span key={i}>{l}</span>)}</div>
      <div className="p-dp-days p-mdp-days p-rdp-days"
        onPointerDown={(e) => {
          if (drag.current || (e.pointerType === "mouse" && e.button !== 0)) return;
          const d = dayAt(e.clientX, e.clientY);
          if (d === null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, anchor: d, last: d, moved: false, base: r };
        }}
        onPointerMove={(e) => {
          const g = drag.current;
          if (!g || e.pointerId !== g.id) return;
          // Off the calendar: the last day the finger was on stays.
          const d = dayAt(e.clientX, e.clientY);
          if (d === null || d === g.last) return;
          const now = performance.now();
          if (slideTicks(g.last, d, now, tickAt.current)) { tickAt.current = now; feel("tick"); }
          g.moved = true;
          g.last = d;
          setR(slideRange(g.anchor, d));
        }}
        onPointerUp={(e) => {
          const g = drag.current;
          if (!g || g.id !== e.pointerId) return;
          drag.current = null;
          if (!g.moved) { setR(tapRange(g.base, g.anchor)); tickAt.current = performance.now(); feel("tick"); }
          else setR(slideRange(g.anchor, g.last));
        }}
        onPointerCancel={(e) => { if (drag.current?.id === e.pointerId) drag.current = null; }}>
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const role = end1 ? (d === r.start ? "single" : null) : rangeRole(r, d), col = i % 7;
          const cls = [
            role && role !== "inside" ? "sel" : "", role ? "band" : "", role === "single" ? "one" : "", role === "start" ? "rs" : "", role === "end" ? "re" : "",
            col === 0 ? "c0" : "", col === 6 ? "c6" : "", d === month ? "m0" : "", d === month + n - 1 ? "m1" : "", d === t ? "today" : "",
          ].join(" ");
          return <button key={i} data-day={d} className={cls} aria-pressed={!!role}><span>{ymd(d).d}</span></button>;
        })}
      </div>
      <div className="p-dp-actions">
        <TextButton onClick={onClose}>Cancel</TextButton>
        <TextButton onClick={() => { onPick(r.start, end1 ? r.start : r.end); onClose(); }}>OK</TextButton>
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

/**
 * The time picker (220, pick B): scroll wheels for the hours and the minutes (and AM/PM on a 12-hour
 * clock), the picked time in a band across the middle, Cancel / OK. Minutes go by [step]: 5 for events
 * and tasks (keeping an odd minute the time already has), 1 for alarms.
 */
export function TimePickerDialog({ value, onPick, onClose, step = 5 }: { value: number | null; onPick: (min: number) => void; onClose: () => void; step?: number }) {
  const [min, setMin] = useState(value ?? 9 * 60);
  return (
    <PickerShell onClose={onClose} className="p-timepicker">
      <div className="p-tp-title">Select time</div>
      <TimeWheels value={min} step={step} onChange={setMin} />
      <div className="p-dp-actions">
        <TextButton onClick={onClose}>Cancel</TextButton>
        <TextButton onClick={() => { onPick(min); onClose(); }}>OK</TextButton>
      </div>
    </PickerShell>
  );
}
