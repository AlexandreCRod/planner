// Parallel stopwatches (327): the page reads the engine's first stopwatch and the ones added beside it, names
// them, and decides the new one's id and the limit of five.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_STOPWATCHES, elapsed, newStopwatchId, stopwatchLabel, stopwatchesOf } from "../src/domain/alarms.ts";

const sw = (o: Partial<{ id: number; name: string; startedAt: number | null; accumulatedMs: number; laps: number[] }> = {}) =>
  ({ startedAt: null, accumulatedMs: 0, laps: [], ...o });

test("an engine from before 327 (one stopwatch, no id, no list) reads as the first, still running", () => {
  const list = stopwatchesOf({ stopwatch: sw({ startedAt: 1_000, accumulatedMs: 500 }) });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 0);
  assert.equal(elapsed(list[0], 3_000), 2_500);
});

test("the added ones follow the first, in the engine's order", () => {
  const list = stopwatchesOf({ stopwatch: sw({ id: 0 }), moreStopwatches: [sw({ id: 7, startedAt: 10 }), sw({ id: 3, name: "Rest" })] });
  assert.deepEqual(list.map((x) => x.id), [0, 7, 3]);
  assert.deepEqual(list.map((x, i) => stopwatchLabel(x, i)), ["Stopwatch", "Stopwatch 2", "Rest"]);
});

test("a blank or spaces-only name falls back to its place", () => {
  assert.equal(stopwatchLabel({ name: "  " }, 2), "Stopwatch 3");
  assert.equal(stopwatchLabel({ name: " Intervals " }, 1), "Intervals");
});

test("a new one gets its own id, and none once there are five", () => {
  const now = 1_800_000_000_000;
  assert.equal(newStopwatchId([{ id: 0 }], now), now);
  // Two added within the same millisecond don't share an id.
  assert.equal(newStopwatchId([{ id: 0 }, { id: now }, { id: now + 1 }], now), now + 2);
  const five = Array.from({ length: MAX_STOPWATCHES }, (_, i) => ({ id: i }));
  assert.equal(newStopwatchId(five, now), null);
  assert.equal(newStopwatchId(five.slice(0, 4), now), now);
});
