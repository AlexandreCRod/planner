import assert from "node:assert/strict";
import { test } from "node:test";
import { dayOf } from "../src/domain/training.ts";
import { dayMonth, inRange, nearestIndex, niceTicks, rangeStart, scale, signed, xDomain } from "../src/ui/phone/chartMath.ts";

const d = (iso: string) => dayOf(iso)!;

test("ranges count back calendar months from today; All has no start", () => {
  const t = d("2026-10-27");
  assert.equal(rangeStart("1M", t), d("2026-09-27"));
  assert.equal(rangeStart("3M", t), d("2026-07-27"));
  assert.equal(rangeStart("6M", t), d("2026-04-27"));
  assert.equal(rangeStart("1Y", t), d("2025-10-27"));
  assert.equal(rangeStart("All", t), null);
  assert.equal(rangeStart("1M", d("2026-03-31")), d("2026-02-28"));   // no 31 Feb: the month's last day
});

test("inRange keeps the readings from the start on, in order", () => {
  const xs = [{ day: 5 }, { day: 10 }, { day: 15 }];
  assert.deepEqual(inRange(xs, 10), [{ day: 10 }, { day: 15 }]);
  assert.deepEqual(inRange(xs, null), xs);
  assert.deepEqual(inRange(xs, 20), []);
});

test("the time axis runs from the range's start (All: the first reading) to today", () => {
  const t = d("2026-10-27");
  assert.deepEqual(xDomain("1M", t, [d("2026-10-01")]), [d("2026-09-27"), t]);
  assert.deepEqual(xDomain("All", t, [d("2025-05-01"), d("2026-10-01")]), [d("2025-05-01"), t]);
  assert.deepEqual(xDomain("All", t, []), [t - 1, t]);                    // nothing: still a width
  assert.deepEqual(xDomain("All", t, [t]), [t - 1, t]);
  assert.deepEqual(xDomain("3M", t, [t + 2]), [rangeStart("3M", t), t + 2]); // a reading after today stays on
});

test("scale maps a domain onto a range, either way round", () => {
  const y = scale(90, 110, 100, 0);
  assert.equal(y(90), 100);
  assert.equal(y(110), 0);
  assert.equal(y(100), 50);
  assert.equal(scale(5, 5, 0, 10)(5), 5);                                    // an empty domain: the middle
});

test("ticks are round steps with every value inside", () => {
  assert.deepEqual(niceTicks(91, 103), { lo: 90, hi: 105, ticks: [90, 95, 100, 105] });
  assert.deepEqual(niceTicks(0, 12).ticks, [0, 5, 10, 15]);
  assert.deepEqual(niceTicks(0, 9).ticks, [0, 5, 10]);
  assert.deepEqual(niceTicks(0, 1.2).ticks, [0, 0.5, 1, 1.5]);
  const t = niceTicks(70, 103);
  assert.ok(t.lo <= 70 && t.hi >= 103 && t.ticks.length <= 5, JSON.stringify(t));
  const flat = niceTicks(80, 80);
  assert.ok(flat.lo < 80 && flat.hi > 80, JSON.stringify(flat));
  const small = niceTicks(2.5, 12.5);
  assert.ok(small.ticks.every((v) => Number.isFinite(v)) && small.lo <= 2.5 && small.hi >= 12.5);
  assert.deepEqual(niceTicks(103, 91).ticks, niceTicks(91, 103).ticks);     // given the wrong way round
});

test("the nearest reading to a finger, the earlier on a tie", () => {
  const xs = [10, 20, 40];
  assert.equal(nearestIndex(xs, 0), 0);
  assert.equal(nearestIndex(xs, 14), 0);
  assert.equal(nearestIndex(xs, 15), 0);
  assert.equal(nearestIndex(xs, 16), 1);
  assert.equal(nearestIndex(xs, 31), 2);
  assert.equal(nearestIndex(xs, 99), 2);
  assert.equal(nearestIndex([7], 0), 0);
  assert.equal(nearestIndex([], 3), -1);
});

test("short dates and signed changes", () => {
  const t = d("2026-10-27");
  assert.equal(dayMonth(d("2026-10-27"), t), "27 Oct");
  assert.equal(dayMonth(d("2025-04-03"), t), "3 Apr 2025");
  assert.equal(signed(12), "+12");
  assert.equal(signed(-3.5), "−3.5");
  assert.equal(signed(0.1), "0");
  assert.equal(signed(2.26), "+2.5");
});
