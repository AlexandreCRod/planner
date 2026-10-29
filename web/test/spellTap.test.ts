import assert from "node:assert/strict";
import { test } from "node:test";
import { takesTap, tapInCaretWord, wordAround } from "../src/ui/shared/spellTap.ts";

const tap = { fingers: 1, ms: 120, moved: 2 };

test("A short tap on a word places the caret there ourselves (255)", () => {
  assert.equal(takesTap(tap, "Helo wr", "old"), true); // inside a word
  assert.equal(takesTap(tap, "speling", ""), true); // just after the last word of the text
  assert.equal(takesTap(tap, "", "Helo"), true); // just before the first
  assert.equal(takesTap(tap, "don", "’t"), true);
  assert.equal(takesTap(tap, "Привет мі", "р"), true); // any script
});

test("Long presses, drags, two fingers and taps off words stay the system's (255)", () => {
  assert.equal(takesTap({ ...tap, ms: 600 }, "wr", "old"), false); // a long press: the system's menu, suggestions included
  assert.equal(takesTap({ ...tap, moved: 30 }, "wr", "old"), false); // a drag or scroll
  assert.equal(takesTap({ ...tap, fingers: 2 }, "wr", "old"), false); // a pinch
  assert.equal(takesTap(tap, "Helo ", " "), false); // between spaces
  assert.equal(takesTap(tap, "☐", " Milk"), false); // between a box and its space
  assert.equal(takesTap(tap, "", ""), false); // an empty line
});

test("A tap on the word the caret is already in goes to the WebView, for its suggestions (263)", () => {
  const text = "Helo wrold, don’t";
  assert.deepEqual(wordAround(text, 7), [5, 10]); // "wrold"
  assert.deepEqual(wordAround(text, 10), [5, 10]); // at its end
  assert.deepEqual(wordAround(text, 14), [12, 17]); // "don’t"
  assert.equal(wordAround(text, 11), null); // after ", "
  assert.equal(tapInCaretWord(text, 6, 9), true); // caret in "wrold", tap in "wrold"
  assert.equal(tapInCaretWord(text, 10, 5), true); // caret at its end, tap at its start
  assert.equal(tapInCaretWord(text, 5, 10), true); // caret at its start
  assert.equal(tapInCaretWord(text, 2, 7), false); // caret in "Helo": the first tap on "wrold" places it
  assert.equal(tapInCaretWord(text, 4, 6), false); // caret just after "Helo", tap in "wrold"
  assert.equal(tapInCaretWord(text, 11, 7), false); // caret after the comma
  assert.equal(tapInCaretWord(text, 11, 11), false); // a tap on no word
  assert.equal(tapInCaretWord("", 0, 0), false);
});
