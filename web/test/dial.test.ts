import assert from "node:assert/strict";
import { test } from "node:test";
import { magnetMinute } from "../src/ui/phone/dial.ts";

const at = (m: number) => magnetMinute(m / 60);

test("the minute hand is drawn gently onto multiples of five", () => {
  assert.equal(at(0), 0);
  assert.equal(at(0.7), 0);
  assert.equal(at(59.3), 0);
  assert.equal(at(14.3), 15);
  assert.equal(at(15.75), 15);
  // In between, the nearest minute.
  assert.equal(at(14.1), 14);
  assert.equal(at(12.4), 12);
  assert.equal(at(17.8), 18);
  // Every minute can still be reached, the fives with the most room.
  const turns = Array.from({ length: 6000 }, (_, i) => at(i / 100));
  assert.equal(new Set(turns).size, 60);
  const room = (m: number) => turns.filter((x) => x === m).length;
  assert.ok(room(15) > 2 * room(14) && room(15) > 2 * room(16));
});
