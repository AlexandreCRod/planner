import assert from "node:assert/strict";
import { test } from "node:test";
import { ROW_QUIET_MS, calmRows, quietRows, rowsQuiet, swipeRemoves } from "../src/ui/phone/rowGuard.ts";

const W = 390;

test("on Tasks a fling alone never deletes, however fast", () => {
  assert.equal(swipeRemoves(-100, -3, W, true), false);
  assert.equal(swipeRemoves(-150, -8, W, true), false);
});

test("on Tasks a row dragged past the mark still deletes, slowly or not", () => {
  assert.equal(swipeRemoves(-170, -0.1, W, true), true);
  assert.equal(swipeRemoves(-170, -3, W, true), true);
});

test("on every other list a fling still deletes", () => {
  assert.equal(swipeRemoves(-100, -3, W, false), true);
  assert.equal(swipeRemoves(-40, -3, W, false), false); // too short
  assert.equal(swipeRemoves(-100, -0.2, W, false), false); // too slow
  assert.equal(swipeRemoves(-100, 3, W, false), false); // going back
});

test("rows are quiet while the list moves and until 0.8 s after its last step", () => {
  calmRows();
  assert.equal(rowsQuiet(1000), false);
  quietRows(1000);
  quietRows(1300); // still sliding
  assert.equal(rowsQuiet(1300 + ROW_QUIET_MS - 1), true);
  assert.equal(rowsQuiet(1300 + ROW_QUIET_MS), false);
});

test("a slide that went back to where it was leaves the rows free at once", () => {
  quietRows(1000);
  calmRows();
  assert.equal(rowsQuiet(1001), false);
});
