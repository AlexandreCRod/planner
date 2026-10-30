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
