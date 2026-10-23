import assert from "node:assert/strict";
import { test } from "node:test";
import { AFTER_STRONG_MS, ANY_GAP_MS, HapticGate, SAME_GAP_MS, TICK_GAP_MS } from "../src/ui/phone/hapticGate.ts";

test("a fast wheel's ticks thin out instead of buzzing", () => {
  const g = new HapticGate();
  // A tick every 10 ms for half a second (a fling): only one per TICK_GAP_MS gets through.
  let played = 0;
  for (let t = 1000; t < 1500; t += 10) if (g.allow("tick", t)) played++;
  assert.ok(played <= Math.ceil(500 / TICK_GAP_MS));
  assert.ok(played >= Math.floor(500 / (TICK_GAP_MS + 10)));
  // Slow turning: every tick plays.
  const slow = new HapticGate();
  assert.deepEqual([0, 80, 160, 240].map((t) => slow.allow("tick", 5000 + t)), [true, true, true, true]);
});

test("a tick never lands on top of a pick-up, settle or confirm", () => {
  const g = new HapticGate();
  assert.equal(g.allow("pickup", 1000), true);
  assert.equal(g.allow("tick", 1000 + AFTER_STRONG_MS - 1), false);
  assert.equal(g.allow("tick", 1000 + AFTER_STRONG_MS), true);
});

test("no two pulses are ever stacked, and the same strong one doesn't fire twice", () => {
  const g = new HapticGate();
  assert.equal(g.allow("tick", 1000), true);
  assert.equal(g.allow("settle", 1000 + ANY_GAP_MS - 1), false); // right on the tick
  assert.equal(g.allow("settle", 1000 + ANY_GAP_MS), true);
  assert.equal(g.allow("settle", 1000 + ANY_GAP_MS + SAME_GAP_MS - 1), false); // a double fire
  assert.equal(g.allow("confirm", 1000 + ANY_GAP_MS + 60), true); // a different act
  assert.equal(g.allow("settle", 1000 + ANY_GAP_MS + SAME_GAP_MS + 100), true);
});
