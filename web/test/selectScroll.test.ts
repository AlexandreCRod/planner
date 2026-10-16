import assert from "node:assert/strict";
import { test } from "node:test";
import { limitScroll, selectScrollSpeed } from "../src/ui/phone/selectScroll.ts";

test("a selection drag scrolls slowly inside the page and faster at its edge, never racing", () => {
  assert.ok(selectScrollSpeed(0) < 0.1);
  assert.ok(selectScrollSpeed(0.5) > selectScrollSpeed(0));
  assert.ok(selectScrollSpeed(1) > selectScrollSpeed(0.5));
  assert.equal(selectScrollSpeed(5), selectScrollSpeed(1.25)); // past the edge it tops out
  assert.ok(selectScrollSpeed(5) < 0.8); // under 800 px a second
  assert.equal(selectScrollSpeed(-3), selectScrollSpeed(0));
});

test("a scroll jump while selecting is held to the allowed speed, either way", () => {
  assert.equal(limitScroll(100, 700, 16, 0.5), 108);
  assert.equal(limitScroll(100, -500, 16, 0.5), 92);
  assert.equal(limitScroll(100, 104, 16, 0.5), 104); // within the limit: as it was
  assert.equal(limitScroll(100, 700, 1000, 0.5), 125); // a long gap counts as at most 50 ms
});
