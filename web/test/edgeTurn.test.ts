import assert from "node:assert/strict";
import { test } from "node:test";
import { EDGE_HOLD, EDGE_REPEAT, EDGE_TRAVEL, EDGE_ZONE, EdgeHold, dropColumn, edgeOf, edgeZone } from "../src/ui/phone/edgeTurn.ts";

test("the edges of the grid, and past them, count; the middle doesn't", () => {
  assert.equal(edgeOf(100, 40, 400), 0);
  assert.equal(edgeOf(50, 40, 400), -1);
  assert.equal(edgeOf(10, 40, 400), -1);
  assert.equal(edgeOf(390, 40, 400), 1);
  assert.equal(edgeOf(600, 40, 400), 1);
});

/** A drag at x, reported to the hold as the calendar does on each frame: x on a grid from 0 to 360. */
const at = (h: EdgeHold, x: number, t: number, zone = EDGE_ZONE) => h.feed(edgeOf(x, 0, 360, zone), t, x);

test("the period turns after a short hold at the edge, then again if it stays", () => {
  const h = new EdgeHold();
  assert.equal(at(h, 200, 0), 0);
  assert.equal(at(h, 350, 100), 0);
  assert.equal(at(h, 350, 100 + EDGE_HOLD - 1), 0);
  assert.equal(at(h, 350, 100 + EDGE_HOLD), 1);
  assert.equal(at(h, 350, 100 + EDGE_HOLD + 1), 0);
  assert.equal(at(h, 350, 100 + EDGE_HOLD + EDGE_REPEAT), 1);
});

test("leaving the edge or going to the other one starts the hold again", () => {
  const h = new EdgeHold();
  at(h, 200, 0);
  at(h, 350, 0);
  at(h, 200, EDGE_HOLD - 10);
  at(h, 350, EDGE_HOLD);
  assert.equal(at(h, 350, EDGE_HOLD + 10), 0);
  at(h, 10, EDGE_HOLD + 20);
  assert.equal(at(h, 10, 2 * EDGE_HOLD + 19), 0);
  assert.equal(at(h, 10, 2 * EDGE_HOLD + 20), -1);
});

test("picked up at the edge and held there, nothing turns", () => {
  const h = new EdgeHold();
  for (let t = 0; t < 5000; t += 16) assert.equal(at(h, 350, t), 0);
});

test("dragged up and down the outer column from a lift at the edge, nothing turns", () => {
  const h = new EdgeHold();
  // The finger wanders a little, as a finger does, always inside the zone.
  for (let t = 0; t < 5000; t += 16) assert.equal(at(h, 345 + (t % 100) / 10, t), 0);
});

test("picked up at the edge, the hold starts once it has left and come back", () => {
  const h = new EdgeHold();
  at(h, 350, 0);
  at(h, 300, 100);
  assert.equal(at(h, 350, 200), 0);
  assert.equal(at(h, 350, 200 + EDGE_HOLD), 1);
});

test("picked up at the edge, a deliberate push past it counts as a move to the edge", () => {
  const h = new EdgeHold();
  at(h, 10, 0);
  assert.equal(at(h, 10 - EDGE_TRAVEL + 1, 100), 0);
  assert.equal(at(h, 10 - EDGE_TRAVEL, 200), 0); // that starts the hold
  assert.equal(at(h, 10 - EDGE_TRAVEL, 200 + EDGE_HOLD), -1);
});

test("moving back from the edge inside the zone doesn't count as moving to it", () => {
  const h = new EdgeHold();
  at(h, 355, 0);
  for (let t = 100; t < 3000; t += 100) assert.equal(at(h, 355 - EDGE_TRAVEL, t, 40), 0);
});

test("on a phone's week and month the outer column stays usable; the day view keeps the wide edge", () => {
  // 360 px phone: week columns (316 / 7) and month columns (360 / 7).
  for (const col of [316 / 7, 360 / 7]) {
    const zone = edgeZone(col);
    assert.ok(zone < EDGE_ZONE);
    assert.ok(zone <= col * 0.4, `only ${zone} px of a ${col} px column turns the page`);
    // The middle of the last column is clear of it.
    assert.equal(edgeOf(360 - col / 2, 0, 360, zone), 0);
    // The last few pixels still reach it.
    assert.equal(edgeOf(350, 0, 360, zone), 1);
  }
  assert.equal(edgeZone(316), EDGE_ZONE);
  // A wide window's columns are wide enough for the whole zone.
  assert.equal(edgeZone(190), EDGE_ZONE);
});

test("a block lands in the column it's over, held within the days in view", () => {
  assert.equal(dropColumn(2, 0, 50, 7), 2);
  assert.equal(dropColumn(2, 74, 50, 7), 3);
  assert.equal(dropColumn(2, 76, 50, 7), 4);
  assert.equal(dropColumn(2, 400, 50, 7), 6);
  assert.equal(dropColumn(2, -400, 50, 7), 0);
});
