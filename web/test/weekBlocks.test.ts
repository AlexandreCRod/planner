import assert from "node:assert/strict";
import { test } from "node:test";
import { blockLines } from "../src/ui/phone/blockLines.ts";

// 231: a block's title takes the whole lines the block holds; two or more, and it wraps.
test("a block's title gets every whole line of its height, one line for a short block", () => {
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
