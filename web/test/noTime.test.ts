import assert from "node:assert/strict";
import { test } from "node:test";
import { noTimePatch } from "../src/domain/itemWhen.ts";
import { newItem } from "../src/domain/types.ts";

// 376: a task's or event's time can be taken off ("No time") without losing the other edits (repeat days etc.).
test("No time takes only the time off a task, keeping its date and repeat", () => {
  const t = newItem({ type: "TASK", title: "Stretch", startDay: 20764, startMin: 480, freq: "WEEKLY", weekDays: 0b0010101 });
  const after = { ...t, ...noTimePatch(t) };
  assert.equal(after.startMin, null);
  assert.equal(after.startDay, 20764);
  assert.equal(after.freq, "WEEKLY");
  assert.equal(after.weekDays, 0b0010101);
});

test("No time makes an event all-day, keeping its days", () => {
  const e = newItem({ type: "EVENT", title: "Trip", startDay: 20764, endDay: 20766, startMin: 600, endMin: 660 });
  const after = { ...e, ...noTimePatch(e) };
  assert.deepEqual([after.allDay, after.startMin, after.endMin, after.startDay, after.endDay], [true, null, null, 20764, 20766]);
});
