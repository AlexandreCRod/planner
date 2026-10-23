// Spacing for the touch feel (haptics.ts): ticks never come faster than the finger can tell them apart,
// a tick never lands on top of a stronger pulse, and no pulse is ever stacked on another, so nothing
// turns into a buzz. Pure, checked by test/haptics.test.ts.

export type Feel = "tick" | "pickup" | "settle" | "confirm";

/** At most one tick in this many ms (about 22 a second; a fast wheel skips some rather than buzz). */
export const TICK_GAP_MS = 45;
/** No tick this soon after a pick-up, settle or confirm (the stronger pulse is the one felt). */
export const AFTER_STRONG_MS = 90;
/** The same pick-up, settle or confirm never twice this close (a double fire, not two acts). */
export const SAME_GAP_MS = 160;
/** No two pulses of any kind closer than this. */
export const ANY_GAP_MS = 28;

export class HapticGate {
  private lastAt = -Infinity;
  private lastKind: Feel | null = null;
  private strongAt = -Infinity;

  /** Whether a [kind] pulse may play at [now] (ms); when it may, it's counted as played. */
  allow(kind: Feel, now: number): boolean {
    const since = now - this.lastAt;
    if (since < ANY_GAP_MS) return false;
    if (kind === "tick") {
      if (since < TICK_GAP_MS || now - this.strongAt < AFTER_STRONG_MS) return false;
    } else {
      if (kind === this.lastKind && since < SAME_GAP_MS) return false;
      this.strongAt = now;
    }
    this.lastAt = now;
    this.lastKind = kind;
    return true;
  }
}
