import assert from "node:assert/strict";
import { test } from "node:test";
import { EDGE_HOLD, EDGE_REPEAT, EdgeHold, dropColumn, edgeOf } from "../src/ui/phone/edgeTurn.ts";

test("the edges of the grid, and past them, count; the middle doesn't", () => {
  assert.equal(edgeOf(100, 40, 400), 0);
  assert.equal(edgeOf(50, 40, 400), -1);
  assert.equal(edgeOf(10, 40, 400), -1);
  assert.equal(edgeOf(390, 40, 400), 1);
  assert.equal(edgeOf(600, 40, 400), 1);
});

test("the period turns after a short hold at the edge, then again if it stays", () => {
  const h = new EdgeHold();
  assert.equal(h.feed(0, 0), 0);
  assert.equal(h.feed(1, 100), 0);
  assert.equal(h.feed(1, 100 + EDGE_HOLD - 1), 0);
  assert.equal(h.feed(1, 100 + EDGE_HOLD), 1);
  assert.equal(h.feed(1, 100 + EDGE_HOLD + 1), 0);
  assert.equal(h.feed(1, 100 + EDGE_HOLD + EDGE_REPEAT), 1);
});

test("leaving the edge or going to the other one starts the hold again", () => {
  const h = new EdgeHold();
  h.feed(1, 0);
  h.feed(0, EDGE_HOLD - 10);
  h.feed(1, EDGE_HOLD);
  assert.equal(h.feed(1, EDGE_HOLD + 10), 0);
  h.feed(-1, EDGE_HOLD + 20);
  assert.equal(h.feed(-1, 2 * EDGE_HOLD + 19), 0);
  assert.equal(h.feed(-1, 2 * EDGE_HOLD + 20), -1);
});

test("a block lands in the column it's over, held within the days in view", () => {
  assert.equal(dropColumn(2, 0, 50, 7), 2);
  assert.equal(dropColumn(2, 74, 50, 7), 3);
  assert.equal(dropColumn(2, 76, 50, 7), 4);
  assert.equal(dropColumn(2, 400, 50, 7), 6);
  assert.equal(dropColumn(2, -400, 50, 7), 0);
});
