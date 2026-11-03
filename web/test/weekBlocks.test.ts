import assert from "node:assert/strict";
import { test } from "node:test";
import { blockLines, tickOwnLine } from "../src/ui/phone/blockLines.ts";

// 231 / 334: the whole lines a block holds (its text box is cut to them, never through a line's letters).
test("a block holds every whole line of its height, one for a short block", () => {
  const hour = 68; // px per hour, zoomed in a little
  const tall = (min: number) => (min / 60) * hour;
  assert.equal(blockLines(tall(15)), 1);   // a 15-minute block: one line, faded at its end
  assert.equal(blockLines(tall(30)), 2);   // half an hour (34 px, 30 px of room): wraps to two
  assert.equal(blockLines(tall(60)), 5);   // "Physiotherapy appointment…" over five lines (64 px of room), not "Phys…"
  // The text has the block's height less its border and top padding, 4 px (review of 2.10, finding 4):
  assert.equal(blockLines(24), 1);         // 20 px of room: a second line would be cut through its letters
  assert.equal(blockLines(27.9), 1);
  assert.equal(blockLines(28), 2);
  // At 48, 72 and 96 px an hour every 15 minutes is a multiple of 12 px; the last line still shows whole.
  for (const hour of [48, 72, 96]) for (let min = 30; min <= 180; min += 15) {
    const h = (min / 60) * hour, n = blockLines(h);
    assert.ok(n * 12 <= h - 4 && (n + 1) * 12 > h - 4, `${hour} px/h, ${min} min: ${n} lines in ${h} px`);
  }
  assert.equal(blockLines(0), 1);          // never none
});

// 334: the title is one line; the tick takes the first line by itself once the block holds two.
test("a routine's or task's tick sits above the title when there's room, beside it when not", () => {
  const hour = 68, tall = (min: number) => (min / 60) * hour;
  assert.equal(tickOwnLine(tall(15), true), false); // 15 min: tick and title share the one line
  assert.equal(tickOwnLine(tall(30), true), true);  // 30 min: tick on top, the title under it, full width
  assert.equal(tickOwnLine(tall(60), true), true);
  assert.equal(tickOwnLine(tall(60), false), false); // an event without a tick: the title starts at the top
  assert.equal(tickOwnLine(27.9, true), false);
  assert.equal(tickOwnLine(28, true), true);
});
