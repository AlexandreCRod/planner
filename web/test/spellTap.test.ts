import assert from "node:assert/strict";
import { test } from "node:test";
import { takesTap } from "../src/ui/shared/spellTap.ts";

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
