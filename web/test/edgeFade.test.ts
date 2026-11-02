// The chip rows' edge fades (232): which ends of a sideways-scrolling row hide chips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fadeEnds } from "../src/ui/phone/edgeFade.ts";

test("a row that fits shows no fade", () => {
  assert.deepEqual(fadeEnds(0, 390, 390), { left: false, right: false });
  assert.deepEqual(fadeEnds(0, 390, 390.6), { left: false, right: false }); // rounding isn't overflow
});

test("an overflowing row fades on the right only until it's scrolled", () => {
  assert.deepEqual(fadeEnds(0, 390, 700), { left: false, right: true });
  assert.deepEqual(fadeEnds(120, 390, 700), { left: true, right: true });
});

test("scrolled to its end, only the left fades", () => {
  assert.deepEqual(fadeEnds(310, 390, 700), { left: true, right: false });
  assert.deepEqual(fadeEnds(309.5, 390, 700), { left: true, right: false });
});
