// The one place the phone's touch feel comes from. Four named strengths, each a single short, soft
// pulse played by the app's own Device plugin (android/.../device/Feel.kt): "tick" for each value or
// slot passed (wheels, drags, a swipe reaching its point), "pickup" when something is grabbed (a held
// row, a dragged block or node), "settle" when it lands, "confirm" for a done. Pulses are spaced by
// hapticGate.ts, so fast ticks thin out instead of buzzing. In a browser there's no feel at all.
import { canFeel, playFeel } from "./device.ts";
import { type Feel, HapticGate } from "./hapticGate.ts";

export type { Feel };

const gate = new HapticGate();

/** Plays [kind] unless it would come too close to the last pulse. */
export function feel(kind: Feel) {
  if (canFeel && gate.allow(kind, performance.now())) playFeel(kind);
}
