// A night over a clock change (review of 2.9.6, finding 11). Stage minutes are real time, bed and wake are local
// clocks, so on those two nights a year they part by an hour. Lisbon: back on 25 Oct 2026, forward on 28 Mar 2027.
process.env.TZ = "Europe/Lisbon";
import assert from "node:assert/strict";
import { test } from "node:test";
import { clockAfter, clockChange, inBedMin, isNap, mergedNights } from "../src/domain/sleep.ts";
import { dayOf } from "../src/domain/training.ts";
import type { HealthNight } from "../src/domain/health.ts";

const BACK = ["2026-10-24T23:30", "2026-10-25T06:30"] as const, FORWARD = ["2027-03-27T23:30", "2027-03-28T07:30"] as const;

test("clocks back: 8 h in bed for 7 h on the clock", () => assert.equal(inBedMin(...BACK), 480));
test("clocks forward: 7 h in bed for 8 h on the clock", () => assert.equal(inBedMin(...FORWARD), 420));
test("an ordinary night is what the clocks say", () => {
  assert.equal(inBedMin("2026-10-31T23:15", "2026-11-01T07:30"), 495);
  assert.equal(clockChange("2026-10-31T23:15", "2026-11-01T07:30"), null);
});

test("the change is found at its minute, and by how much", () => {
  assert.deepEqual(clockChange(...BACK), { at: 150, by: -60 });    // 02:00 summer time, 2 h 30 after bed
  assert.deepEqual(clockChange(...FORWARD), { at: 90, by: 60 });   // 01:00, an hour and a half after bed
});

test("a stretch reads the clock of its moment: before the change as it was, after it as it is, ending at the wake time", () => {
  const c = clockChange(...BACK)!;
  assert.equal(clockAfter(BACK[0], 120, c), "01:30");
  assert.equal(clockAfter(BACK[0], 149, c), "01:59");
  assert.equal(clockAfter(BACK[0], 150, c), "01:00");
  assert.equal(clockAfter(BACK[0], 480, c), "06:30");
  const f = clockChange(...FORWARD)!;
  assert.equal(clockAfter(FORWARD[0], 89, f), "00:59");
  assert.equal(clockAfter(FORWARD[0], 90, f), "02:00");
  assert.equal(clockAfter(FORWARD[0], 420, f), "07:30");
});

test("the nap rule is real time: 3 h 30 asleep over clocks back is a night, 2 h 30 over clocks forward a nap", () => {
  assert.equal(isNap({ bed: "2026-10-25T00:00", wake: "2026-10-25T02:30" }), false);
  assert.equal(isNap({ bed: "2027-03-28T00:00", wake: "2027-03-28T03:30" }), true);
  const night = { id: "n", day: dayOf("2026-10-25")!, bed: "2026-10-25T00:00", wake: "2026-10-25T02:30", totalMin: 200, awakeMin: 10, deepMin: 50, lightMin: 100, remMin: 50, stages: [["light", 0, 200]], source: "x", updatedAt: 1 } as HealthNight;
  assert.equal(mergedNights([], [night], [])[0]?.totalMin, 200);
});
