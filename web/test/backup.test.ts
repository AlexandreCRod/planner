import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backupDue, backupFileName, backupFileTime, backupsToDrop, gunzipJson, gzipJson, makeBackup, parseBackup, restoreEntries, restorePlan,
} from "../src/domain/backup.ts";

type Rec = Record<string, unknown>;
const KINDS = ["items", "completions", "categories", "trainingEntries", "healthDays"];
const now = 1_800_000_000_000;
const item = (id: number, title: string, updatedAt = 1000): [string, Rec] => [`items/${id}`, { id, title, updatedAt, deletedAt: null }];

test("a backup survives gzip and parsing, record for record", async () => {
  const recs: [string, Rec][] = [item(1, "A"), ["completions/1:20000", { itemId: 1, day: 20000, completedAt: 5 }]];
  const b = makeBackup(recs, now, "2.9", "Phone (web app)");
  const bytes = await gzipJson(b);
  assert.equal(bytes[0], 0x1f);
  assert.deepEqual(parseBackup(await gunzipJson(bytes)), b);
  // A plain (unzipped) JSON file reads too.
  assert.deepEqual(parseBackup(await gunzipJson(new TextEncoder().encode(JSON.stringify(b)))), b);
});

test("other files are refused with a plain message", () => {
  assert.throws(() => parseBackup({ hello: 1 }), /isn't a Planner backup/);
  assert.throws(() => parseBackup(null), /isn't a Planner backup/);
  assert.throws(() => parseBackup({ format: "planner-backup", version: 99, createdAt: 1, records: [] }), /newer version/);
  assert.throws(() => parseBackup({ format: "planner-backup", version: 1, records: [] }), /damaged/);
  // Broken entries are dropped, the rest kept.
  const b = parseBackup({ format: "planner-backup", version: 1, createdAt: 1, records: [item(1, "A"), ["nokind", {}], ["items/2", "x"], 5] });
  assert.equal(b.records.length, 1);
});

test("restore puts back what's missing or different, with a new edit time, and deletes nothing", () => {
  const b = makeBackup([item(1, "Same"), item(2, "Old title"), item(3, "Deleted here"), ["completions/3:20000", { itemId: 3, day: 20000, completedAt: 5 }]], now - 86_400_000, "2.9", "PC browser");
  const current = new Map<string, Rec>([item(1, "Same", 9999), item(2, "New title", 5000), item(4, "Added since")]);
  const plan = restorePlan(b, current, KINDS, now);
  assert.deepEqual(plan.missing.map(([k]) => k), ["items/3", "completions/3:20000"]);
  assert.deepEqual(plan.changed.map(([k]) => k), ["items/2"]);
  assert.equal(plan.missing[0][1].updatedAt, now);
  assert.equal(plan.changed[0][1].title, "Old title");
  assert.equal(plan.changed[0][1].updatedAt, now);
  // A record without an edit time comes back as it was.
  assert.deepEqual(plan.missing[1][1], { itemId: 3, day: 20000, completedAt: 5 });
  // Missing only, or changed too; never anything that would remove items/4.
  assert.equal(restoreEntries(plan, false).length, 2);
  assert.equal(restoreEntries(plan, true).length, 3);
  assert.ok(!restoreEntries(plan, true).some(([k]) => k === "items/4"));
});

test("restore leaves the plan's files and the problem logs alone", () => {
  const b = makeBackup([["trainingFiles/plan", { id: "plan" }], ["problemLogs/phone-x", { id: "phone-x" }], ["trainingEntries/e1", { id: "e1", updatedAt: 3 }]], now, "2.9", "x");
  const plan = restorePlan(b, new Map(), KINDS, now);
  assert.deepEqual(plan.missing.map(([k]) => k), ["trainingEntries/e1"]);
  assert.equal(plan.skipped, 2);
});

test("an identical backup restores nothing", () => {
  const recs: [string, Rec][] = [item(1, "A"), item(2, "B")];
  const plan = restorePlan(makeBackup(recs, now, "", ""), new Map(recs), KINDS, now);
  assert.equal(plan.missing.length + plan.changed.length, 0);
});

test("file names sort by date and read back", () => {
  const at = new Date(2026, 9, 30, 8, 5).getTime();
  assert.equal(backupFileName(at), "planner-backup-2026-10-30-0805.json.gz");
  assert.equal(backupFileTime(backupFileName(at)), at);
  assert.equal(backupFileTime("notes.txt"), null);
});

test("the newest 14 are kept, other files never touched", () => {
  const names = Array.from({ length: 17 }, (_, i) => backupFileName(new Date(2026, 9, i + 1, 9, 0).getTime()));
  const drop = backupsToDrop([...names, "other.txt"].reverse());
  assert.deepEqual(drop.sort(), names.slice(0, 3));
});

test("the daily backup is due once per local day", () => {
  const morning = new Date(2026, 9, 30, 8, 0).getTime();
  assert.equal(backupDue(null, morning), true);
  assert.equal(backupDue(morning, new Date(2026, 9, 30, 23, 0).getTime()), false);
  assert.equal(backupDue(morning, new Date(2026, 9, 31, 0, 1).getTime()), true);
  assert.equal(backupDue(morning + 3_600_000, morning), true); // clock set back
});
