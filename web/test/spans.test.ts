import assert from "node:assert/strict";
import { test } from "node:test";
import { barsShownOver, lanesOver, spanLanes } from "../src/domain/spans.ts";

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
