// The time picker's minute hand: a drag picks any minute, but near a multiple of five (the numbers on
// the face) the hand is drawn onto it, so the round minutes are easy to land on. Checked by test/dial.test.ts.

/** How close (in minutes) the finger must come to a multiple of five to be drawn onto it. */
export const MINUTE_PULL = 0.8;

/** The minute for the hand at [turn] (0..1 clockwise from 12): the nearest one, or the multiple of five it's close to. */
export function magnetMinute(turn: number): number {
  const raw = ((turn % 1) + 1) % 1 * 60;
  const five = Math.round(raw / 5) * 5;
  return (Math.abs(raw - five) <= MINUTE_PULL ? five : Math.round(raw)) % 60;
}
