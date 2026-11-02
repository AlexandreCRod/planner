import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate, today } from "../src/domain/dates.ts";
import { whenText } from "../src/domain/itemWhen.ts";
import { type Item, newItem } from "../src/domain/types.ts";

const t = today();
const task = (extra: Partial<Item>) => newItem({ id: 1, type: "TASK", title: "T", startDay: t - 5, startMin: 21 * 60 + 30, freq: "DAILY", ...extra });

test("a routine's page says its day, not a deadline; a plain task keeps \"Due\" (286)", () => {
  const routine = whenText(task({ routine: true }), t);
  assert.match(routine, /^Today at /);
  assert.doesNotMatch(routine, /Due/);
  assert.match(whenText(task({ routine: true }), t + 1), /^Tomorrow at /);
  assert.match(whenText(task({}), t), new RegExp(`^Due ${formatDate(t)} at `));
});

test("a routine event says Today with its times (286)", () => {
  const ev = newItem({ id: 2, type: "EVENT", title: "E", startDay: t - 3, endDay: t - 3, startMin: 7 * 60, endMin: 8 * 60, freq: "DAILY", routine: true });
  assert.match(whenText(ev, t), /^Today · /);
  assert.match(whenText({ ...ev, routine: false }, t), new RegExp(`^${formatDate(t)} · `));
});
