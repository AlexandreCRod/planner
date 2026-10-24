import assert from "node:assert/strict";
import { test } from "node:test";
import { barsShownOver, lanesOver, spanLanes, spanPieces } from "../src/domain/spans.ts";

test("bars across days get the lowest free lane and never overlap", () => {
  const lanes = spanLanes([
    { key: "trip", from: 2, to: 6 },
    { key: "fest", from: 3, to: 4 },
    { key: "camp", from: 5, to: 9 },
    { key: "old", from: -3, to: 0 },
    { key: "gone", from: -9, to: -2 },
  ], 0, 6);
  const by = Object.fromEntries(lanes.map((l) => [l.key, l]));
  assert.deepEqual(by.old, { key: "old", lane: 0, first: 0, last: 0 }); // clipped to the row
  assert.deepEqual(by.trip, { key: "trip", lane: 0, first: 2, last: 6 });
  assert.equal(by.fest.lane, 1);
  assert.equal(by.camp.lane, 1); // free again after the fest
  assert.deepEqual([by.camp.first, by.camp.last], [5, 6]);
  assert.equal(by.gone, undefined);
});

test("the longer of two starting together goes on top", () => {
  const lanes = spanLanes([{ key: "a", from: 1, to: 2 }, { key: "b", from: 1, to: 5 }], 0, 6);
  assert.deepEqual(lanes.map((l) => [l.key, l.lane]), [["b", 0], ["a", 1]]);
});

test("the room bars take over each day", () => {
  const lanes = spanLanes([{ key: "x", from: 0, to: 3 }, { key: "y", from: 2, to: 4 }, { key: "z", from: 2, to: 2 }], 0, 6);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((c) => lanesOver(lanes, c)), [1, 1, 3, 2, 2, 0]);
  assert.equal(barsShownOver(lanes, 2, 2), 2);
  assert.equal(barsShownOver(lanes, 2, 3), 3);
});

// Item 150: a bar over two weeks shows in each week as its own bar (title and left edge in each).
test("over the hours' three weeks, each week lays out its own bars", () => {
  // Days 0..20 (three weeks of 7); a trip from day 5 to day 9 crosses into the second week.
  const lanes = spanLanes([{ key: "trip", from: 5, to: 9 }, { key: "fest", from: 8, to: 8 }], 0, 20, 7);
  const trip = lanes.filter((l) => l.key === "trip").map((l) => [l.first, l.last]);
  assert.deepEqual(trip, [[5, 6], [7, 9]]);
  // The second week's piece starts that week again at the top lane.
  assert.equal(lanes.find((l) => l.key === "trip" && l.first === 7)!.lane, 0);
  assert.equal(lanes.find((l) => l.key === "fest")!.lane, 1);
  // One day at a time: a bar for each day.
  assert.equal(spanLanes([{ key: "x", from: 0, to: 2 }], 0, 2, 1).length, 3);
  // No page, or a page as long as the row: as before.
  assert.deepEqual(spanLanes([{ key: "trip", from: 5, to: 9 }], 0, 20), [{ key: "trip", lane: 0, first: 5, last: 9 }]);
});

test("days taken out of a span split it into a bar for each run of days left", () => {
  assert.deepEqual(spanPieces({ key: "a", from: 1, to: 6, skip: [3, 4] }), [{ from: 1, to: 2 }, { from: 5, to: 6 }]);
  assert.deepEqual(spanPieces({ key: "a", from: 1, to: 3, skip: [1, 9] }), [{ from: 2, to: 3 }]);
  assert.deepEqual(spanPieces({ key: "a", from: 1, to: 3 }), [{ from: 1, to: 3 }]);
  const lanes = spanLanes([{ key: "a", from: 1, to: 6, skip: [3] }, { key: "b", from: 3, to: 3 }], 0, 6);
  assert.deepEqual(lanes.filter((l) => l.key === "a").map((l) => [l.lane, l.first, l.last]), [[0, 1, 2], [0, 4, 6]]);
  // The day taken out is free: another bar can use the lane there.
  assert.equal(lanes.find((l) => l.key === "b")!.lane, 0);
  assert.deepEqual([0, 1, 2, 3, 4].map((c) => lanesOver(lanes, c)), [0, 1, 1, 1, 1]);
});
