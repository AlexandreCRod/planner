import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_RECORD_CHARS, canonical, deletionGuard, isKind, keyOf, kindsIn, parseSnapshot, recordsOf, tokensMatch } from "../src/records.ts";

test("composite keys for join tables", () => {
  assert.equal(keyOf("completions", { itemId: 3, day: 20374 }), "3:20374");
  assert.equal(keyOf("links", { sourceId: 1, targetId: 9, auto: false }), "1:9");
  assert.equal(keyOf("items", { id: 42 }), "42");
});

test("canonical JSON ignores key order", () => {
  assert.equal(canonical({ b: 1, a: { d: [1, 2], c: null } }), canonical({ a: { c: null, d: [1, 2] }, b: 1 }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});

test("snapshot validation keeps only the kinds sent, and rejects bad shapes", () => {
  const ok = parseSnapshot({ items: [{ id: 1, title: "x" }], trainingEntries: [{ id: "p:t1" }] });
  assert.ok(typeof ok !== "string");
  assert.deepEqual(kindsIn(ok).sort(), ["items", "trainingEntries"]); // links weren't sent: a push leaves them alone
  assert.deepEqual(recordsOf(ok, "links"), []);
  assert.equal(typeof parseSnapshot({ items: {} }), "string");
  assert.equal(typeof parseSnapshot({ completions: [{ itemId: 1 }] }), "string");
  assert.equal(typeof parseSnapshot("nope"), "string");
});

test("deletion guard blocks wiping the store", () => {
  assert.ok(deletionGuard(5, 0));
  assert.ok(deletionGuard(100, 30));
  assert.equal(deletionGuard(100, 90), null);
  assert.equal(deletionGuard(0, 0), null);
  assert.equal(deletionGuard(10, 2), null); // small stores can shrink freely
});

test("token comparison", () => {
  assert.ok(tokensMatch("abc", "abc"));
  assert.ok(!tokensMatch("abc", "abd"));
  assert.ok(!tokensMatch("abc", "abcd"));
  assert.ok(!tokensMatch("", "abc"));
});

import { clientWins, isPhone, parseSyncBody, syncDeletionGuard } from "../src/records.ts";

test("sync body validation", () => {
  const ok = parseSyncBody({ since: 3, changes: [{ kind: "items", id: "7", data: { id: 7 } }, { kind: "links", id: "1:2", data: null }] });
  assert.ok(typeof ok !== "string");
  assert.equal(ok.changes.length, 2);
  assert.equal(typeof parseSyncBody({ since: -1, changes: [] }), "string");
  assert.equal(typeof parseSyncBody({ since: 0, changes: [{ kind: "Nope!", id: "1", data: null }] }), "string");
  assert.equal(typeof parseSyncBody({ since: 0, changes: [{ kind: "__proto__", id: "1", data: null }] }), "string");
  assert.equal(typeof parseSyncBody({ since: 0, changes: [{ kind: "items", id: "8", data: { id: 7 } }] }), "string");
});

test("conflict rules", () => {
  // two edits of an item: later updatedAt wins
  assert.equal(clientWins("items", { updatedAt: 5 }, { updatedAt: 9 }), false);
  assert.equal(clientWins("items", { updatedAt: 9 }, { updatedAt: 5 }), true);
  // an edit beats a delete, in both directions
  assert.equal(clientWins("items", null, { updatedAt: 1 }), false);
  assert.equal(clientWins("items", { updatedAt: 1 }, null), true);
  // other kinds: the syncing client wins
  assert.equal(clientWins("reminders", { offsetMin: 5 }, { offsetMin: 10 }), true);
  // phone against PC: the phone wins, whatever the times
  assert.equal(clientWins("items", { updatedAt: 5 }, { updatedAt: 9 }, true, false), true);
  assert.equal(clientWins("items", { updatedAt: 9 }, { updatedAt: 5 }, false, true), false);
  assert.equal(clientWins("reminders", { offsetMin: 5 }, { offsetMin: 10 }, false, true), false);
  // ...but an edit still beats a delete
  assert.equal(clientWins("items", null, { updatedAt: 1 }, true, false), false);
  assert.equal(isPhone("Google Pixel 6a"), true);
  assert.equal(isPhone("PC browser"), false);
  assert.equal(isPhone(null), false);
});

test("sync deletion guard", () => {
  assert.equal(syncDeletionGuard(30, 0), null);
  assert.ok(syncDeletionGuard(30, 20));
  assert.ok(syncDeletionGuard(3, 3));
  assert.equal(syncDeletionGuard(30, 5), null);
});

test("item fields pass through untouched, new ones included (e.g. routine)", () => {
  const item = { id: 7, type: "TASK", title: "Stretch", freq: "DAILY", routine: true, updatedAt: 3 };
  const ok = parseSyncBody({ since: 0, changes: [{ kind: "items", id: "7", data: item }] });
  assert.ok(typeof ok !== "string");
  assert.deepEqual(ok.changes[0].data, item);
  // What the store writes and later sends back keeps the field.
  assert.deepEqual(JSON.parse(canonical(ok.changes[0].data)), item);
});

test("newer record kinds need no Worker change; their records are keyed by id", () => {
  assert.ok(isKind("items") && isKind("trainingEntries") && isKind("insightsDays"));
  assert.ok(!isKind("Training") && !isKind("a") && !isKind("training-entries") && !isKind(""));
  const ok = parseSyncBody({ since: 0, changes: [{ kind: "trainingEntries", id: "hm:t004", data: { id: "hm:t004", day: 1, updatedAt: 2 } }] });
  assert.ok(typeof ok !== "string");
  assert.equal(keyOf("trainingLifts", { id: "hm:t005:x001" }), "hm:t005:x001");
  assert.equal(typeof parseSyncBody({ since: 0, changes: [{ kind: "trainingEntries", id: "x", data: { id: "y" } }] }), "string");
});

test("a record too large is refused by name", () => {
  const big = { id: "p:Plan.md", text: "x".repeat(MAX_RECORD_CHARS) };
  const r = parseSyncBody({ since: 0, changes: [{ kind: "trainingFiles", id: "p:Plan.md", data: big }] });
  assert.equal(typeof r, "string");
  assert.match(r as string, /^Too large: trainingFiles\/p:Plan\.md/);
});

test("newer kinds with edit times: the later edit wins between devices of the same kind", () => {
  assert.equal(clientWins("trainingEntries", { updatedAt: 5 }, { updatedAt: 9 }), false);
  assert.equal(clientWins("trainingEntries", { updatedAt: 9 }, { updatedAt: 5 }), true);
  assert.equal(clientWins("trainingEntries", { updatedAt: 5 }, { updatedAt: 9 }, true, false), true); // the phone still wins over the PC
  assert.equal(isPhone("plan-script"), false);
});
