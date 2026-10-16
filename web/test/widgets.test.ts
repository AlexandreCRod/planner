import assert from "node:assert/strict";
import { test } from "node:test";
import { CompletionIndex } from "../src/domain/schedule.ts";
import { newItem } from "../src/domain/types.ts";
import { buildWidgets } from "../src/domain/widgets.ts";

const f = { time: (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`, date: (d: number) => `day ${d}`, color: () => "#123456" };

test("the widgets get today's and tomorrow's tasks, and the coming events", () => {
  const items = [
    newItem({ type: "TASK", id: 1, title: "Pills", startDay: 100, startMin: 480 }),
    newItem({ type: "TASK", id: 2, title: "Late", startDay: 98, overduePolicy: "SHOW_OVERDUE" }),
    newItem({ type: "TASK", id: 3, title: "Tomorrow", startDay: 101 }),
    newItem({ type: "TASK", id: 4, title: "Whenever" }),
    newItem({ type: "EVENT", id: 5, title: "Dentist", startDay: 102, startMin: 900, endMin: 960 }),
    newItem({ type: "EVENT", id: 6, title: "Past", startDay: 99 }),
    newItem({ type: "EVENT", id: 7, title: "Holiday", startDay: 100 }),
    newItem({ type: "NOTE", id: 8, title: "Note", startDay: 100 }),
  ];
  const done = new CompletionIndex([{ itemId: 1, day: 100, completedAt: 1 }]);
  const w = buildWidgets(items, done, 100, f);
  assert.deepEqual(w.days.map((d) => d.day), [100, 101]);
  const today = w.days[0].tasks;
  assert.deepEqual(today.map((t) => t.title).sort(), ["Late", "Pills"]); // no "anytime" task
  const pills = today.find((t) => t.id === 1)!;
  assert.equal(pills.done, true);
  assert.equal(pills.label, "8:00");
  const late = today.find((t) => t.id === 2)!;
  assert.deepEqual([late.overdue, late.label, late.day], [true, "Overdue", 98]);
  assert.ok(w.days[1].tasks.some((t) => t.title === "Tomorrow"));
  assert.deepEqual(w.events.map((e) => [e.title, e.day, e.time]), [["Holiday", 100, "All day"], ["Dentist", 102, "15:00"]]);
  assert.equal(w.events[1].date, "day 102");
  // When each one is over, so the widget drops it during the day: an untimed one at the end of its day.
  assert.deepEqual(w.events.map((e) => [e.endDay, e.endMin]), [[100, null], [102, 960]]);
});
