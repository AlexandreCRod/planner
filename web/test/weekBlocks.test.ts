import assert from "node:assert/strict";
import { test } from "node:test";
import { blockLines } from "../src/ui/phone/blockLines.ts";

// 231: a block's title takes the whole lines the block holds; two or more, and it wraps.
test("a block's title gets every whole line of its height, one line for a short block", () => {
  const hour = 68; // px per hour, zoomed in a little
  const tall = (min: number) => (min / 60) * hour;
  assert.equal(blockLines(tall(15)), 1);   // a 15-minute block: one line, faded at its end
  assert.equal(blockLines(tall(30)), 2);   // half an hour: wraps to two
  assert.equal(blockLines(tall(60)), 5);   // "Physiotherapy appointment…" over five lines, not "Phys…"
  assert.equal(blockLines(23.9), 1);
  assert.equal(blockLines(24), 2);
  assert.equal(blockLines(0), 1);          // never none
});
