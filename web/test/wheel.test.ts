import assert from "node:assert/strict";
import { test } from "node:test";
import { joinTime, moveKeepingLength, nearestSlot, splitTime, wheelHours, wheelMinutes, wrapIndex } from "../src/ui/phone/wheelMath.ts";
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
