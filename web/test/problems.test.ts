import assert from "node:assert/strict";
import { test } from "node:test";
import { type Problem, type ProblemLogRecord, deviceLabel, problemLogRecord } from "../src/problems.ts";

const p = (at: number, message: string): Problem => ({ at, kind: "error", message, detail: "" });

test("the synced log: one record per device, the newest 50, rewritten only when it changes (265)", () => {
  const list = Array.from({ length: 60 }, (_, i) => p(1000 - i, `m${i}`));
  const rec = problemLogRecord("phone-abc", "Android phone", "2.8.4", list, undefined, 5)!;
  assert.equal(rec.id, "phone-abc");
  assert.equal(rec.entries.length, 50);
  assert.equal(rec.entries[0].message, "m0");          // newest first
  assert.equal(rec.updatedAt, 5);
  assert.equal(problemLogRecord("phone-abc", "Android phone", "2.8.4", list, rec, 9), null); // nothing new
  const more = problemLogRecord("phone-abc", "Android phone", "2.8.4", [p(2000, "new"), ...list], rec, 9) as ProblemLogRecord;
  assert.equal(more.entries[0].message, "new");
  assert.equal(problemLogRecord("phone-abc", "Android phone", "2.8.5", list, rec, 9)?.app, "2.8.5"); // a new version says so
  assert.deepEqual(problemLogRecord("phone-abc", "Android phone", "2.8.4", [], rec, 9)?.entries, []); // cleared
});

test("the device's label", () => {
  assert.equal(deviceLabel(true, "anything"), "Android phone");
  assert.equal(deviceLabel(false, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "Browser (Windows)");
});
