// A tap on a word in the note's text places the caret there ourselves (255). Left to the WebView, a tap
// on a word with a red spelling underline opens Chromium's suggestion pop-up, which takes the keyboard
// away; the underline itself stays (spellcheck stays on). Only a plain short tap with one finger on a
// word is taken: a long press, a drag, a tap on a box, a link or blank space keep the system's own
// behaviour. Chromium on Android shows a word's spelling suggestions on a tap (not a long press), so a
// tap on the word the caret is already in is left to it too (263): the first tap on a word places the
// caret, a second one on the same word opens the suggestions. Pure, tested in test/spellTap.test.ts;
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

/** The word around [at] in [text] as [start, end] (end exclusive); null when [at] touches no word. */
export function wordAround(text: string, at: number): [number, number] | null {
  let a = at, b = at;
  while (a > 0 && WORD.test(text[a - 1])) a--;
  while (b < text.length && WORD.test(text[b])) b++;
  return a === b ? null : [a, b];
}

/**
 * Whether a tap at [tapAt] lands in the same word as the caret at [caretAt] (both offsets in the same
 * text, the caret collapsed; its edges count): then the tap is left to the WebView, which opens the
 * word's spelling suggestions (263).
 */
export function tapInCaretWord(text: string, caretAt: number, tapAt: number): boolean {
  const w = wordAround(text, tapAt);
  return !!w && caretAt >= w[0] && caretAt <= w[1];
}
