// The slide stepper's numbers (SlideStepper.tsx): how far a sideways slide has gone in steps, and the value
// that gives, kept within its limits and rounded so 0.1 steps never drift into 78.60000001. Pure, checked
// by test/stepMath.test.ts.

/** One step per this many px of sideways movement. */
export const STEP_PX = 12;

/** Decimals written in [n] (2.5 → 1, 0.1 → 1, 3 → 0), at most 4. */
export function decimalsOf(n: number): number {
  for (let d = 0; d < 4; d++) if (Math.abs(Math.round(n * 10 ** d) - n * 10 ** d) < 1e-9) return d;
  return 4;
}

/** [v] rounded to [d] decimals. */
export const roundTo = (v: number, d: number) => Number(v.toFixed(d));

/** [v] kept within [min]–[max]. */
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Whole steps for a slide of [dx] px: left is up, right down (264: the finger pulls the tick tape like a
 * ruler, so bigger numbers come in from the right), a step only once it's fully passed.
 */
export const slideSteps = (dx: number) => Math.trunc(-dx / STEP_PX) || 0;

/** [from] moved by [steps] of [step], within [min]–[max], as precise as the step or [from] (whichever is finer). */
export function stepValue(from: number, steps: number, step: number, min: number, max: number): number {
  const d = Math.max(decimalsOf(step), decimalsOf(from));
  return roundTo(clamp(from + steps * step, min, max), d);
}

/** A typed number ("78,5" is fine), within [min]–[max]; whole when [decimal] is off. Null when it isn't one. */
export function typedValue(text: string, min: number, max: number, decimal: boolean): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "" || !/^\d*\.?\d*$/.test(t) || t === ".") return null;
  const v = Number(t);
  return clamp(decimal ? roundTo(v, 2) : Math.round(v), min, max);
}
