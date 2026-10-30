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

test("only alarms with exactly the same days bundle (73)", async () => {
  const { bundleAlarms } = await import("../src/domain/clockList.ts");
  const names = (g: { hour: number; minute: number }[][]) => g.map((x) => x.map((a) => `${a.hour}:${String(a.minute).padStart(2, "0")}`));
  // The review's case: a Tue/Thu 07:15 gym alarm no longer joins the weekday 06:30–06:50 ones.
  const list = [alarm(6, 30, WEEKDAYS), alarm(6, 40, WEEKDAYS), alarm(6, 50, WEEKDAYS), alarm(7, 15, 0b0001010), alarm(7, 20, 0b0001010), alarm(6, 45, WEEKEND)];
  assert.deepEqual(names(bundleAlarms(list, fri)), [["6:30", "6:40", "6:50"], ["6:45"], ["7:15", "7:20"]]);
  // Chosen dates bundle only with the same dates; one-offs with those ringing the same day.
  const dated = [alarm(9, 0, 0, true, { dates: [20760, 20761] }), alarm(9, 5, 0, true, { dates: [20761, 20760] }), alarm(9, 10, 0, true, { dates: [20760] })];
  assert.deepEqual(names(bundleAlarms(dated, fri)), [["9:00", "9:05"], ["9:10"]]);
  // At 09:00 a one-off at 08:50 rings tomorrow, one at 09:10 today: not the same day.
  assert.deepEqual(names(bundleAlarms([alarm(8, 50), alarm(9, 10), alarm(9, 5)], fri)), [["8:50"], ["9:05", "9:10"]]);
  // Skips don't split a bundle.
  assert.equal(bundleAlarms([alarm(6, 30, WEEKDAYS, true, { skip: [20761] }), alarm(6, 40, WEEKDAYS)], fri).length, 1);
});

test("moving a bundle's heading time shifts every alarm, and the bundles form again (110)", async () => {
  const { bundleAlarms, shiftBundle } = await import("../src/domain/clockList.ts");
  const hm = (l: { hour: number; minute: number }[]) => l.map((a) => a.hour * 60 + a.minute);
  const group = [alarm(6, 30, WEEKDAYS), alarm(6, 40, WEEKDAYS), alarm(6, 55, WEEKDAYS)];
  assert.deepEqual(hm(shiftBundle(group, 7 * 60)), [420, 430, 445]);
  assert.deepEqual(hm(shiftBundle(group, 6 * 60)), [360, 370, 385]);
  // Never past midnight: the last alarm stops at 23:59, the first at 00:00.
  assert.deepEqual(hm(shiftBundle(group, 23 * 60 + 50)), [1414, 1424, 1439]);
  assert.deepEqual(hm(shiftBundle([alarm(0, 10, 1), alarm(0, 20, 1)], 23 * 60 + 50)), [1429, 1439]);
  assert.deepEqual(hm(shiftBundle([alarm(0, 10, 1), alarm(0, 20, 1)], 0)), [0, 10]);
  // After the shift, a nearby alarm with the same days joins; the window decides (19 min by default).
  const other = alarm(7, 20, WEEKDAYS);
  assert.equal(bundleAlarms([...group, other], fri).length, 2); // 06:55, then 07:20: 25 min apart
  assert.equal(bundleAlarms([...shiftBundle(group, 6 * 60 + 40), other], fri).length, 1); // 07:05, then 07:20: joins
  assert.equal(bundleAlarms([...shiftBundle(group, 6 * 60), other], fri).length, 2);
  // A window of 0 bundles nothing; a wider one takes more.
  assert.equal(bundleAlarms(group, fri, 0).length, 3);
  assert.equal(bundleAlarms([...group, other], fri, 25).length, 1);
});
