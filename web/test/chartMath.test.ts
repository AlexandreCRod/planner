import assert from "node:assert/strict";
import { test } from "node:test";
import { dayOf } from "../src/domain/training.ts";
import { allWindows, dayMonth, hasEarlier, inRange, nearestBar, nearestIndex, niceTicks, panTarget, rangeStart, rangeWindow, scale, signed, spanWindow, xDomain } from "../src/ui/phone/chartMath.ts";

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

// ---------- Moving through time (302) ----------

test("a reading is in exactly one window as a card moves back, and none is skipped", () => {
  const t = d("2026-10-31"), first = d("2024-02-29");
  const days = Array.from({ length: t - first + 1 }, (_, i) => first + i);
  for (const key of ["1M", "3M", "6M", "1Y"] as const) {
    const seen = new Map<number, number>();
    let back = 0, w = spanWindow(key, t, days, back);
    for (;;) {
      for (const p of inRange(days.map((day) => ({ day })), w.from, w.to)) seen.set(p.day, (seen.get(p.day) ?? 0) + 1);
      if (!w.earlier) break;
      w = spanWindow(key, t, days, ++back);
    }
    assert.equal(seen.size, days.length, key);
    assert.ok([...seen.values()].every((n) => n === 1), key);
  }
});

test("now, a card's window is what it showed before panning; a window back ends the day before", () => {
  const t = d("2026-10-27"), days = [d("2026-01-05"), d("2026-10-20")];
  const now = spanWindow("3M", t, days);
  assert.deepEqual([now.from, now.to, now.domain], [d("2026-07-27"), null, xDomain("3M", t, days)]);
  const back = spanWindow("3M", t, days, 1);
  assert.deepEqual([back.from, back.to, back.domain], [d("2026-04-27"), d("2026-07-26"), [d("2026-04-27"), d("2026-07-26")]]);
  assert.equal(back.label, "27 Apr – 26 Jul");
});

test("moving back stops at the window holding the first reading, and All has nowhere to go", () => {
  const t = d("2026-10-27"), days = [d("2026-03-01"), d("2026-10-20")];
  assert.equal(spanWindow("3M", t, days, 0).earlier, true);
  assert.equal(spanWindow("3M", t, days, 1).earlier, true);    // 27 Apr – 26 Jul: March is still before it
  assert.equal(spanWindow("3M", t, days, 2).earlier, false);   // 27 Jan – 26 Apr holds the first reading
  assert.equal(spanWindow("All", t, days).earlier, false);
  assert.equal(spanWindow("3M", t, []).earlier, false);
});

test("Cardio's windows stop at the first day with data", () => {
  const t = d("2026-10-28"); // a Wednesday
  const first = d("2026-10-12");
  assert.equal(hasEarlier("1W", t, first, 0), true);   // last week starts 19 Oct
  assert.equal(hasEarlier("1W", t, first, 1), true);   // the week of the 12th is before it
  assert.equal(hasEarlier("1W", t, first, 2), false);
  assert.equal(hasEarlier("All", t, d("2020-01-01"), 0), false);
  const list = allWindows("1W", t, first);
  assert.deepEqual(list.map((w) => w.from), [d("2026-10-26"), d("2026-10-19"), d("2026-10-12")]);
  assert.deepEqual(list[2], rangeWindow("1W", t, first, 2));
});

test("a swipe moves a window past 40 px or on a flick, older to the right, and not where there's nothing", () => {
  assert.equal(panTarget(60, 0, true, true), 1);
  assert.equal(panTarget(-60, 0, true, true), -1);
  assert.equal(panTarget(30, 0, true, true), 0);        // too short, too slow: springs back
  assert.equal(panTarget(30, 0.6, true, true), 1);      // a flick
  assert.equal(panTarget(30, -0.6, true, true), 0);     // pulled back as it let go
  assert.equal(panTarget(80, 0, false, true), 0);       // at the first window
  assert.equal(panTarget(-80, 0, true, false), 0);      // at now
});

test("inRange can end too", () => {
  const xs = [{ day: 5 }, { day: 10 }, { day: 15 }];
  assert.deepEqual(inRange(xs, 6, 10), [{ day: 10 }]);
  assert.deepEqual(inRange(xs, null, 10), [{ day: 5 }, { day: 10 }]);
});

test("a bar reads by its middle: anywhere on a bar is that bar, line points by their own day", () => {
  const bars = [0, 1, 2, 3, 4, 5, 6];
  const half = () => 0.5;
  assert.equal(nearestBar(bars, half, 1.6), 1);   // the right half of Tuesday's bar is Tuesday
  assert.equal(nearestBar(bars, half, 1.05), 1);
  assert.equal(nearestBar(bars, half, 1.95), 1);
  assert.equal(nearestBar(bars, half, 2.05), 2);
  assert.equal(nearestBar(bars, half, 6.9), 6);
  assert.equal(nearestBar([0, 7, 14], () => 3.5, 13.5), 1);  // weeks
  assert.equal(nearestBar([0, 31, 59], (d) => (d === 0 ? 15.5 : 14), 58.5), 1);  // months of different lengths
  assert.equal(nearestBar(bars, () => 0, 1.6), 2);  // no bars: the nearest point
});
