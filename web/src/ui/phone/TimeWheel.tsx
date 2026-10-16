// The time wheel: hours and minutes on spinning wheels, like a clock app's picker. A vertical swipe
// turns a wheel 1:1 with the finger; let go, it coasts with the finger's speed and slows onto a whole
// row (motion.ts's coast), with a light tick for each row going by. Nothing re-renders while it turns:
// WheelDrive writes the transform itself, once per frame.
//
// Used by Today (hold an event's time to move it) and the Alarms page (hold an alarm's hours or
// minutes and swipe). The row maths is in wheelMath.ts (tested in test/wheel.test.ts).
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { use24h } from "../../domain/dates.ts";
import { TextButton } from "./m3.tsx";
import { type Animation, VelocityTracker, animateCoast, bandClamp, snapIndex } from "./motion.ts";
import { hapticLift, hapticTick, pushBack } from "./native.ts";
import { TOUCH_SLOP } from "./press.ts";
import { joinTime, splitTime, wheelHours, wheelMinutes } from "./wheelMath.ts";

/** A row's height in the big wheel (px). */
export const ROW_H = 52;

export interface WheelOptions {
  count: number;
  rowH: number;
  index: number;
  /** Shows the wheel turned [offset] px (row i is centred at i·rowH). */
  write: (offset: number) => void;
  /** A new row reached the centre (while turning). */
  onRow?: (i: number) => void;
  /** The wheel came to rest on row i. */
  onSettle?: (i: number) => void;
}

/** One wheel's motion, apart from React: grab, move and release it with a finger's positions. */
export class WheelDrive {
  offset: number;
  private row: number;
  private anim: Animation | null = null;
  private vt = new VelocityTracker();
  private y0 = 0;
  private o0 = 0;
  private held = false;
  private moved = false;
  constructor(private o: WheelOptions) {
    this.offset = o.index * o.rowH;
    this.row = o.index;
  }
  /** The row in the middle now. */
  get index() { return this.row; }
  get busy() { return this.held || this.anim !== null; }
  private draw(off: number) {
    this.offset = off;
    this.o.write(off);
    const r = Math.max(0, Math.min(this.o.count - 1, Math.round(off / this.o.rowH)));
    if (r !== this.row) { this.row = r; this.o.onRow?.(r); }
  }
  grab(y: number, t: number) {
    this.anim?.stop();
    this.anim = null;
    this.held = true;
    this.moved = false;
    this.y0 = y;
    this.o0 = this.offset;
    this.vt.reset();
    this.vt.add(t, y);
  }
  move(y: number, t: number) {
    if (!this.held) return;
    this.vt.add(t, y);
    if (Math.abs(y - this.y0) > TOUCH_SLOP / 2) this.moved = true;
    const max = (this.o.count - 1) * this.o.rowH;
    this.draw(bandClamp(this.o0 - (y - this.y0), 0, max, this.o.rowH * 3));
  }
  /** Lets go: the wheel coasts onto a row. Returns whether the finger turned it (not a tap). */
  release(t: number): boolean {
    if (!this.held) return false;
    this.held = false;
    const v = -this.vt.velocity(t);
    this.glide(snapIndex(this.offset, v, this.o.rowH, 0, this.o.count - 1), v);
    return this.moved;
  }
  /** Turns to row [i], starting at [v] px/ms. */
  glide(i: number, v = 0) {
    this.anim?.stop();
    const to = Math.max(0, Math.min(this.o.count - 1, i)) * this.o.rowH;
    this.anim = animateCoast(this.offset, to, v, (x) => this.draw(x), () => { this.anim = null; this.o.onSettle?.(Math.round(to / this.o.rowH)); });
  }
  /** Shows row [i] at once. */
  set(i: number) {
    this.anim?.stop();
    this.anim = null;
    this.offset = i * this.o.rowH;
    this.row = i;
    this.o.write(this.offset);
  }
  stop() { this.anim?.stop(); this.anim = null; this.held = false; }
}

/** Feeds a pointer's moves and release to [drive] (with every sample merged into each event). */
export function pointerTo(drive: WheelDrive, el: HTMLElement, e: PointerEvent | React.PointerEvent, onUp?: (turned: boolean, e: PointerEvent) => void) {
  const id = e.pointerId;
  drive.grab(e.clientY, e.timeStamp);
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    const list = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [];
    for (const c of list.length ? list : [ev]) drive.move(c.clientY, c.timeStamp);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    onUp?.(drive.release(ev.timeStamp), ev);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

/**
 * One wheel: [rows] rows showing, the middle one in the strong colour inside a soft band. [onChange]
 * is called once it comes to rest on a row; [onRow] while it turns.
 */
export const WheelColumn = memo(function WheelColumn({ values, index, onChange, onRow, rows = 5, rowH = ROW_H, label, driveRef, className = "" }: {
  values: string[]; index: number; onChange: (i: number) => void; onRow?: (i: number) => void; rows?: number; rowH?: number; label: string;
  driveRef?: React.MutableRefObject<WheelDrive | null>; className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const lists = useRef<HTMLDivElement[]>([]);
  const cb = useRef({ onChange, onRow });
  cb.current = { onChange, onRow };
  const mid = ((rows - 1) / 2) * rowH;
  const [drive] = useState(() => new WheelDrive({
    count: values.length, rowH, index,
    write: (off) => { for (const l of lists.current) if (l) l.style.transform = `translate3d(0,${mid - off}px,0)`; },
    onRow: (i) => { hapticTick(); cb.current.onRow?.(i); root.current?.setAttribute("aria-valuetext", values[i]); },
    onSettle: (i) => cb.current.onChange(i),
  }));
  if (driveRef) driveRef.current = drive;
  useLayoutEffect(() => { drive.set(index); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A new value from outside (AM/PM switching the hour, say): turn to it.
  useEffect(() => { if (!drive.busy && drive.index !== index) drive.glide(index); }, [index, drive]);
  useEffect(() => () => drive.stop(), [drive]);

  const rowsEl = (on: boolean) => values.map((v, i) => <div key={i} className={`tw-row ${on ? "on" : ""}`} style={{ height: rowH }}>{v}</div>);
  return (
    <div ref={root} className={`tw-col ${className}`} style={{ height: rows * rowH, ["--mid" as string]: `${mid}px`, ["--row" as string]: `${rowH}px` }}
      role="spinbutton" tabIndex={0} aria-label={label} aria-valuetext={values[index]}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); drive.glide(drive.index + (e.key === "ArrowUp" ? -1 : 1)); }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const el = root.current!;
        el.setPointerCapture(e.pointerId);
        const y0 = e.clientY;
        pointerTo(drive, el, e, (turned) => {
          if (turned) return;
          // A tap on a row above or below the middle turns the wheel to it.
          const r = el.getBoundingClientRect();
          const steps = Math.round((y0 - (r.top + mid + rowH / 2)) / rowH);
          if (steps) drive.glide(drive.index + steps);
        });
      }}>
      <div className="tw-list" ref={(el) => { if (el) lists.current[0] = el; }}>{rowsEl(false)}</div>
      <div className="tw-band">
        <div className="tw-list" ref={(el) => { if (el) lists.current[1] = el; }} aria-hidden="true">{rowsEl(true)}</div>
      </div>
    </div>
  );
});

const two = (n: number) => String(n).padStart(2, "0");

/** The hour and minute wheels (and AM/PM on a 12-hour clock) for minute-of-day [value]. */
function useTimeWheels(value: number) {
  const h24 = use24h();
  const minutes = useMemo(() => wheelMinutes(5, value % 60), []); // eslint-disable-line react-hooks/exhaustive-deps
  const hours = useMemo(() => wheelHours(h24), [h24]);
  const start = useMemo(() => splitTime(value, h24, minutes), []); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = useRef({ ...start });
  return { h24, minutes, hours, start, cur, time: () => joinTime(cur.current.hour, cur.current.minute, cur.current.pm, h24, minutes) };
}

export interface TimeWheelRequest {
  title: string;
  value: number;
  /** Shown under the wheels for the time on them (e.g. "Until 11:30"). */
  note?: (min: number) => string;
  okLabel?: string;
  onPick: (min: number) => void;
  /** A finger still down from the long press that opened it: it turns the hours, and letting go picks. */
  pointerId?: number;
}

let request: TimeWheelRequest | null = null;
const listeners = new Set<() => void>();
/** Opens the big time wheel (one at a time). */
export function openTimeWheel(r: TimeWheelRequest) { request = r; listeners.forEach((l) => l()); }

/** Where the time wheel opens: once, in the phone shell. */
export function TimeWheelHost() {
  const [r, setR] = useState<TimeWheelRequest | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = () => { setR(request); setN((x) => x + 1); };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);
  if (!r) return null;
  return <TimeWheelDialog key={n} {...r} onClose={() => { request = null; setR(null); }} />;
}

function TimeWheelDialog({ title, value, note, okLabel = "OK", onPick, pointerId, onClose }: TimeWheelRequest & { onClose: () => void }) {
  const { h24, minutes, hours, start, cur, time } = useTimeWheels(value);
  const noteEl = useRef<HTMLDivElement>(null);
  const hourDrive = useRef<WheelDrive | null>(null);
  const [leaving, setLeaving] = useState(false);
  const closing = useRef(false);
  const close = () => { if (closing.current) return; closing.current = true; setLeaving(true); window.setTimeout(onClose, 160); };
  const pick = () => { if (closing.current) return; onPick(time()); close(); };
  useEffect(() => pushBack(close), []); // eslint-disable-line react-hooks/exhaustive-deps

  // The note follows the wheels as they turn, written straight into the page.
  const show = () => {
    const t = time();
    if (noteEl.current && note) noteEl.current.textContent = note(t);
  };

  // The finger that held the time: its vertical moves turn the hours; letting go after turning picks.
  const handing = useRef(pointerId !== undefined);
  const pickOnRest = useRef(false);
  useEffect(() => {
    if (pointerId === undefined) return;
    let grabbed = false;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || !handing.current || !hourDrive.current) return;
      const d = hourDrive.current;
      if (!grabbed) { grabbed = true; d.grab(e.clientY, e.timeStamp); }
      const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const c of list.length ? list : [e]) d.move(c.clientY, c.timeStamp);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || !handing.current) return;
      handing.current = false;
      if (grabbed && hourDrive.current?.release(e.timeStamp)) pickOnRest.current = true;
      done();
    };
    // While the finger turns the wheel, the page under the dialog mustn't scroll.
    const noScroll = (e: TouchEvent) => { if (handing.current && e.cancelable) e.preventDefault(); };
    const done = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      document.removeEventListener("touchmove", noScroll, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    document.addEventListener("touchmove", noScroll, { capture: true, passive: false });
    return done;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onHour = (i: number) => { cur.current.hour = i; show(); };
  const onHourRest = (i: number) => { cur.current.hour = i; show(); if (pickOnRest.current) { pickOnRest.current = false; pick(); } };
  const onMinute = (i: number) => { cur.current.minute = i; show(); };
  const [pm, setPm] = useState(start.pm);

  return (
    <div className={`p-dialog-scrim tw-scrim ${leaving ? "out" : ""}`} onPointerDown={(e) => { if (e.target === e.currentTarget && !handing.current) close(); }}>
      <div className="tw-dialog" role="dialog" aria-label={title}>
        <div className="p-tp-title">{title}</div>
        <div className="tw-wheels">
          <WheelColumn label="Hours" values={hours.map((h) => (h24 ? two(h) : String(h)))} index={start.hour} onRow={onHour} onChange={onHourRest} driveRef={hourDrive} />
          <span className="tw-colon">:</span>
          <WheelColumn label="Minutes" values={minutes.map(two)} index={start.minute} onRow={onMinute} onChange={onMinute} />
          {!h24 && (
            <WheelColumn label="AM or PM" className="tw-ampm" values={["AM", "PM"]} index={pm ? 1 : 0}
              onRow={(i) => { cur.current.pm = i === 1; show(); }} onChange={(i) => { cur.current.pm = i === 1; setPm(i === 1); show(); }} />
          )}
        </div>
        {note && <div className="tw-note" ref={noteEl}>{note(value)}</div>}
        <div className="p-dp-actions">
          <TextButton onClick={close}>Cancel</TextButton>
          <TextButton onClick={pick}>{okLabel}</TextButton>
        </div>
      </div>
    </div>
  );
}

// ---------- Holding a time ----------

const HOLD_MS = 450;
let hold: { id: number; x0: number; y0: number; timer: number; fired: boolean } | null = null;
let swallowClick = false;

/**
 * Props for something that opens a time wheel when held (450 ms, with the lift haptic): [onHold] gets
 * the finger's pointer id, so the same finger can go on to turn the wheel. The click after a hold is
 * swallowed, so the row under it doesn't open too.
 */
export function holdProps(onHold: (pointerId: number) => void): HTMLAttributes<HTMLElement> {
  return {
    onPointerDown: (e) => {
      if (e.button !== 0 || !e.isPrimary) return;
      if (hold) clearTimeout(hold.timer);
      swallowClick = false;
      const h = { id: e.pointerId, x0: e.clientX, y0: e.clientY, fired: false, timer: 0 };
      h.timer = window.setTimeout(() => { h.fired = true; swallowClick = true; hapticLift(); onHold(h.id); }, HOLD_MS);
      hold = h;
    },
    onPointerMove: (e) => {
      const h = hold;
      if (!h || h.fired || e.pointerId !== h.id) return;
      if (Math.hypot(e.clientX - h.x0, e.clientY - h.y0) > TOUCH_SLOP) { clearTimeout(h.timer); hold = null; }
    },
    onPointerUp: () => { if (hold && !hold.fired) clearTimeout(hold.timer); hold = null; },
    onPointerCancel: () => { if (hold && !hold.fired) clearTimeout(hold.timer); hold = null; },
    onClickCapture: (e) => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } },
    onContextMenu: (e) => e.preventDefault(),
  };
}

export { useTimeWheels };
