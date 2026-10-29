// A tap on a word in the note's text places the caret there ourselves (255). Left to the WebView, a tap
// on a word with a red spelling underline opens Chromium's suggestion pop-up, which takes the keyboard
// away; the underline itself stays (spellcheck stays on). Only a plain short tap with one finger on a
// word is taken: a long press, a drag, a tap on a box, a link or blank space keep the system's own
// behaviour, so suggestions can still be reached with a long press. Pure, tested in test/spellTap.test.ts;
// RichEditor does the DOM side.
import { LONG_PRESS, TOUCH_SLOP } from "../phone/press.ts";

/** A letter or digit of a word (any script), or an apostrophe inside one. */
const WORD = /[\p{L}\p{N}'’]/u;

/**
 * Whether a finished touch is a tap the editor places the caret for: one finger, short (well under a
 * long press), not moved, and landing in or at the edge of a word ([before] and [after]: the characters
 * on either side of where the caret would go, "" at a line's ends).
 */
export function takesTap(t: { fingers: number; ms: number; moved: number }, before: string, after: string): boolean {
  if (t.fingers !== 1 || t.ms >= LONG_PRESS - 50 || t.moved > TOUCH_SLOP) return false;
  return WORD.test(before.slice(-1)) || WORD.test(after.slice(0, 1));
}
