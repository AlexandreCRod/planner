import assert from "node:assert/strict";
import { test } from "node:test";
import { dragEdgeTimes, durationRows, joinDuration, joinTime, moveKeepingLength, nearestSlot, splitDuration, splitTime, wheelHours, wheelMinutes, wheelRowLook, wrapIndex } from "../src/ui/phone/wheelMath.ts";
import { snapIndex } from "../src/ui/phone/motion.ts";

test("minutes come in fives, keeping an odd minute the item already has", () => {
  assert.equal(wheelMinutes().length, 12);
  assert.deepEqual(wheelMinutes(5, 7).slice(0, 4), [0, 5, 7, 10]);
  assert.equal(wheelMinutes(5, 10).length, 12);
});

test("a time splits into wheel rows and back, on 24 and 12 hours", () => {
  const mins = wheelMinutes();
  for (const h24 of [true, false]) {
    for (const t of [0, 35, 12 * 60, 13 * 60 + 5, 23 * 60 + 55]) {
      const r = splitTime(t, h24, mins);
      assert.equal(joinTime(r.hour, r.minute, r.pm, h24, mins), t, `${t} on ${h24 ? 24 : 12} h`);
    }
  }
  // 12-hour rows: 12 AM is row 0 of [12, 1, ..., 11]; 1 PM is row 1 with PM.
  assert.equal(wheelHours(false)[splitTime(0, false, mins).hour], 12);
  assert.deepEqual(splitTime(13 * 60, false, mins), { hour: 1, minute: 0, pm: true });
});

test("a minute between the rows lands on the nearest", () => {
  const mins = wheelMinutes();
  assert.equal(mins[splitTime(10 * 60 + 8, true, mins).minute], 10);
  assert.equal(mins[splitTime(10 * 60 + 2, true, mins).minute], 0);
});

test("the wheel lands on a whole row, carried by a flick", () => {
  const h = 56;
  assert.equal(snapIndex(3.4 * h, 0, h, 0, 23), 3);
  assert.equal(snapIndex(3.6 * h, 0, h, 0, 23), 4);
  assert.ok(snapIndex(3 * h, 1.5, h, 0, 23) > 6); // a flick down the list goes several rows on
  assert.equal(snapIndex(3 * h, -20, h, 0, 23), 0); // never past the first row
});

test("a moved event keeps its length, within the day", () => {
  assert.deepEqual(moveKeepingLength(600, 540, 600), { startMin: 600, endMin: 660 });
  assert.deepEqual(moveKeepingLength(23 * 60 + 30, 540, 660), { startMin: 1410, endMin: 1439 });
  assert.deepEqual(moveKeepingLength(600, 540, null), { startMin: 600, endMin: null });
});

test("a drum goes round: 23 is next to 00, and the nearest way round is taken", () => {
  assert.equal(wrapIndex(-1, 24), 23);
  assert.equal(wrapIndex(24, 24), 0);
  assert.equal(wrapIndex(49, 24), 1);
  assert.equal(nearestSlot(0, 23, 24), -1); // from 00 to 23: one row back, not 23 on
  assert.equal(nearestSlot(22, 1, 24), 25); // from 22 to 01: three rows on
  assert.equal(nearestSlot(30, 6, 24), 30);
  assert.equal(wrapIndex(nearestSlot(-50, 5, 60), 60), 5);
});

test("the new event's handles move its start or end in quarter hours", () => {
  // 9:00–10:00; the bottom handle dragged 50 minutes down: the end lands on the nearest quarter, 10:45.
  assert.deepEqual(dragEdgeTimes("bottom", 540, 600, 50), { start: 540, end: 645 });
  // Less than half a step: nothing changes.
  assert.deepEqual(dragEdgeTimes("bottom", 540, 600, 7), { start: 540, end: 600 });
  // The top handle dragged up 70 minutes: 7:45 (on the clock's quarters, from an odd start too).
  assert.deepEqual(dragEdgeTimes("top", 540, 600, -70), { start: 465, end: 600 });
  assert.deepEqual(dragEdgeTimes("top", 545, 600, -8), { start: 540, end: 600 });
  // Never shorter than a quarter hour, never past the day's ends.
  assert.deepEqual(dragEdgeTimes("top", 540, 600, 300), { start: 585, end: 600 });
  assert.deepEqual(dragEdgeTimes("bottom", 540, 600, -300), { start: 540, end: 555 });
  assert.deepEqual(dragEdgeTimes("top", 30, 90, -200), { start: 0, end: 90 });
  assert.deepEqual(dragEdgeTimes("bottom", 1380, 1410, 200), { start: 1380, end: 1439 });
});

test("picker wheel rows: the middle one full size, smaller and fainter away from the band (220)", () => {
  assert.deepEqual(wheelRowLook(0), { scale: 1, opacity: 1 });
  assert.ok(Math.abs(wheelRowLook(1).scale - 22 / 30) < 1e-9);
  assert.ok(Math.abs(wheelRowLook(-2).scale - 20 / 30) < 1e-9);
  assert.equal(wheelRowLook(3).opacity, 0);
  let last = 2;
  for (let d = 0; d <= 3; d += 0.25) { const o = wheelRowLook(d).opacity; assert.ok(o <= last, `fades at ${d}`); last = o; }
  assert.deepEqual(wheelRowLook(1.5), wheelRowLook(-1.5));
});

test("a timer's length splits into hour, minute and second rows and back (220)", () => {
  for (const ms of [0, 1000, 59_000, 60_000, 25 * 60_000, 3_600_000 + 61_000, 23 * 3_600_000 + 59 * 60_000 + 59_000]) {
    assert.equal(joinDuration(splitDuration(ms)), ms);
  }
  assert.deepEqual(splitDuration(90 * 60_000 + 5_000), { h: 1, m: 30, s: 5 });
  assert.equal(splitDuration(30 * 3_600_000).h, 23);
  assert.deepEqual(durationRows(60, true).slice(0, 2), ["00", "01"]);
  assert.equal(durationRows(24, false)[9], "9");
});

test("alarm wheels go by the minute, event wheels by five", () => {
  assert.equal(wheelMinutes(1).length, 60);
  const mins = wheelMinutes(1);
  assert.equal(joinTime(splitTime(7 * 60 + 13, true, mins).hour, splitTime(7 * 60 + 13, true, mins).minute, false, true, mins), 7 * 60 + 13);
});
