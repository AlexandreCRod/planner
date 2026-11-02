import assert from "node:assert/strict";
import { test } from "node:test";
import { newItem } from "../src/domain/types.ts";
import { filterOn, filterShows, noFilter } from "../src/ui/phone/calFilter.ts";

const ev = (categoryId: number | null) => newItem({ type: "EVENT", title: "E", categoryId });
const task = (categoryId: number | null) => newItem({ type: "TASK", title: "T", categoryId });

test("the chip shows only while something is hidden", () => {
  assert.equal(filterOn(noFilter(), [1, 2]), false);
  assert.equal(filterOn({ ...noFilter(), events: false }, [1, 2]), true);
  assert.equal(filterOn({ ...noFilter(), tasks: false }, []), true);
  assert.equal(filterOn({ ...noFilter(), hidden: new Set([2]) }, [1, 2]), true);
});

test("a hidden category that was deleted since doesn't count as a filter", () => {
  assert.equal(filterOn({ ...noFilter(), hidden: new Set([9]) }, [1, 2]), false);
});

test("events, tasks and categories hide what they say; notes never show", () => {
  const f = { events: true, tasks: false, hidden: new Set([2]) };
  assert.equal(filterShows(f, ev(1)), true);
  assert.equal(filterShows(f, ev(null)), true);
  assert.equal(filterShows(f, ev(2)), false);
  assert.equal(filterShows(f, task(1)), false);
  assert.equal(filterShows(noFilter(), task(2)), true);
  assert.equal(filterShows(noFilter(), newItem({ type: "NOTE", title: "N" })), false);
});

// Review of 2.10, finding 7: the calendar's "Routines 1/3 ›" counts from what the filter shows.
test("the calendar's routines line counts only the routines the filter shows", async () => {
  const { routinesOnDay } = await import("../src/domain/routines.ts");
  const { CompletionIndex } = await import("../src/domain/schedule.ts");
  const D = 20_000;
  const r = (id: number, type: "TASK" | "EVENT", categoryId: number | null) =>
    newItem({ id, type, title: `R${id}`, startDay: D, startMin: type === "EVENT" ? 600 : null, endMin: type === "EVENT" ? 660 : null, freq: "DAILY", routine: true, categoryId });
  const items = [r(1, "TASK", null), r(2, "TASK", 5), r(3, "EVENT", null)];
  const count = (f: ReturnType<typeof noFilter>) => routinesOnDay(items.filter((i) => filterShows(f, i)), new CompletionIndex([]), D, D).length;
  assert.equal(count(noFilter()), 3);
  assert.equal(count({ ...noFilter(), tasks: false }), 1);
  assert.equal(count({ ...noFilter(), hidden: new Set([5]) }), 2);
});
