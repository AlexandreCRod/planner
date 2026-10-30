import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleRecords } from "../src/domain/sample.ts";
import { occursOn } from "../src/domain/recurrence.ts";
import type { Item } from "../src/domain/types.ts";

const today = 20_390, now = 1_761_800_000_000;

test("the sample week: unique ids, the same on every reset, no reminders", () => {
  const a = sampleRecords(today, now), b = sampleRecords(today, now);
  assert.deepEqual(a, b);
  const keys = a.map(({ kind, rec }) => `${kind}/${"id" in rec ? rec.id : JSON.stringify(rec)}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(!a.some((r) => (r.kind as string) === "reminders"));
  const items = a.filter((r) => r.kind === "items").map((r) => r.rec as Item);
  assert.ok(items.length >= 15);
  for (const i of items) { assert.equal(i.updatedAt, now); assert.equal(i.deletedAt, null); }
});

test("the sample week has something on today", () => {
  const items = sampleRecords(today, now).filter((r) => r.kind === "items").map((r) => r.rec as Item);
  const onToday = items.filter((i) => i.startDay !== null && occursOn(i, today));
  assert.ok(onToday.some((i) => i.type === "EVENT"));
  assert.ok(onToday.some((i) => i.type === "TASK" && i.routine === true));
  assert.ok(items.some((i) => i.type === "NOTE" && i.noteDay === today));
});
