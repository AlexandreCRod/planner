// A number set by sliding sideways on it, with no keyboard: one step per STEP_PX moved (left up, right
// down, 264), a soft tick for each, a tick tape under it moving with the finger. A tap on it (not a slide)
// turns it into a field to type in, the only way the keyboard opens. On the PC a mouse drag does the
// same, and the arrow keys step it. Used by a set's weight and reps and by a custom reminder time.
import { useEffect, useRef, useState } from "react";
import { IconButton } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { TOUCH_SLOP } from "./press.ts";
import { slideSteps, stepValue, typedValue } from "./stepMath.ts";

interface Slide { id: number; x0: number; y0: number; from: number; moved: boolean }

/**
 * [value] (null: none yet, shown as "–") in steps of [step] within [min]–[max], written by [format] with
 * [unit] small beside it. [decimal] lets a typed value have decimals; [clearable] lets typing nothing
 * clear it to null. [buttons] adds − and + beside it.
 */
export function SlideStepper({ value, onChange, step, min = 0, max, format = String, unit, decimal = false, clearable = false, buttons = false, label }: {
  value: number | null; onChange: (v: number | null) => void; step: number; min?: number; max: number;
  format?: (v: number) => string; unit?: string; decimal?: boolean; clearable?: boolean; buttons?: boolean; label: string;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const slide = useRef<Slide | null>(null);
  const shown = useRef(value);
  shown.current = value;
  const tape = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => { if (typing !== null) field.current?.select(); }, [typing !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Moves to [steps] from [from]; a tick only when the value really changes (none when pinned at a limit). */
  const go = (from: number, steps: number) => {
    const v = stepValue(from, steps, step, min, max);
    if (v === shown.current) return;
    shown.current = v;
    feel("tick");
    onChange(v);
  };
  const bump = (d: number) => go(shown.current ?? min, d);

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (typing !== null || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    slide.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, from: shown.current ?? min, moved: false };
    setHeld(true);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = slide.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x0;
    if (!s.moved && Math.hypot(dx, e.clientY - s.y0) < TOUCH_SLOP) return;
    s.moved = true;
    if (tape.current) tape.current.style.backgroundPositionX = `${dx}px`;
    go(s.from, slideSteps(dx));
  };
  const up = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const s = slide.current;
    if (!s || s.id !== e.pointerId) return;
    slide.current = null;
    setHeld(false);
    if (!s.moved && !cancelled) setTyping(value === null ? "" : format(value));
  };

  const commit = () => {
    if (typing === null) return;
    const v = typedValue(typing, min, max, decimal);
    if (v !== null) onChange(v);
    else if (clearable && typing.trim() === "") onChange(null);
    setTyping(null);
  };
  const key = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (d) { e.preventDefault(); bump(d); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTyping(value === null ? "" : format(value)); }
  };
  const by = step === 1 ? null : format(step);

  return (
    <div className="p-stepper-box">
      <div className="p-stepper">
        {buttons && <IconButton icon="fRemove" label={by ? `Less by ${by}` : "One less"} onClick={() => bump(-1)} />}
        <div className={`p-slide${held ? " held" : ""}`} role="spinbutton" tabIndex={typing === null ? 0 : -1} aria-label={label}
          aria-valuenow={value ?? undefined} aria-valuemin={min} aria-valuemax={max} aria-valuetext={value === null ? "none" : `${format(value)}${unit ? ` ${unit}` : ""}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={(e) => up(e, false)} onPointerCancel={(e) => up(e, true)} onKeyDown={typing === null ? key : undefined}>
          <div className="p-slide-num">
            {typing === null ? <span>{value === null ? "–" : format(value)}</span>
              : <input ref={field} className="p-slide-field" inputMode={decimal ? "decimal" : "numeric"} enterKeyHint="done" autoFocus aria-label={label}
                value={typing} onChange={(ev) => setTyping(ev.target.value)} onBlur={commit}
                onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); commit(); } }} />}
            {unit && <small>{unit}</small>}
          </div>
          <div ref={tape} className="p-slide-tape" />
          <span className="p-slide-chev" aria-hidden>‹</span><span className="p-slide-chev end" aria-hidden>›</span>
        </div>
        {buttons && <IconButton icon="fAdd" label={by ? `More by ${by}` : "One more"} onClick={() => bump(1)} />}
      </div>
      <div className="p-stepper-hint">Slide left for more · tap to type</div>
    </div>
  );
}
