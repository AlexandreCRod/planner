import assert from "node:assert/strict";
import { test } from "node:test";
import { count, plural } from "../src/domain/plural.ts";
import { offsetLabel } from "../src/domain/dates.ts";

test("one takes the singular, every other count the plural", () => {
  assert.equal(count(1, "task"), "1 task");
  assert.equal(count(5, "task"), "5 tasks");
  assert.equal(count(0, "result"), "0 results");
  assert.equal(count(2, "entry", "entries"), "2 entries");
  assert.equal(plural(1, "entry", "entries"), "entry");
});

test("reminder offsets read as words", () => {
  assert.equal(offsetLabel(60), "1 hour before");
  assert.equal(offsetLabel(120), "2 hours before");
  assert.equal(offsetLabel(1440), "1 day before");
  assert.equal(offsetLabel(10080 * 2), "2 weeks before");
});
