import assert from "node:assert/strict";
import { test } from "node:test";
import { WEEKDAYS, WEEKEND } from "../src/domain/alarms.ts";
import { shownBy, toggleFilter } from "../src/domain/clockList.ts";

const fri = new Date(2026, 9, 30, 9, 0); // a Friday
const alarm = (h: number, m: number, days = 0, enabled = true, more: object = {}) => ({ id: h * 60 + m, hour: h, minute: m, days, enabled, ...more });

test("the alarm filters: none on shows everything, a chip filters, a second tap clears it (71)", () => {
  const list = [alarm(6, 30, WEEKDAYS), alarm(8, 30, WEEKEND), alarm(13, 15, 0, false), alarm(21, 45, 127)];
  const ids = (f: Parameters<typeof shownBy>[1]) => list.filter((a) => shownBy(a, f, fri)).map((a) => a.id);
  assert.deepEqual(ids(null), list.map((a) => a.id));
  assert.deepEqual(ids("on"), [390, 510, 1305]);
  assert.deepEqual(ids("off"), [795]);
  assert.deepEqual(ids("weekdays"), [390, 795, 1305]); // the one-off rings today, a Friday
  assert.deepEqual(ids("weekend"), [510, 1305]);
  assert.equal(toggleFilter(null, "on"), "on");
  assert.equal(toggleFilter("on", "weekend"), "weekend");
  assert.equal(toggleFilter("weekend", "weekend"), null);
});
