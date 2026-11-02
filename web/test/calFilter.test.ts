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
