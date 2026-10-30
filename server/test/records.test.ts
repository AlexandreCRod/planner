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

test("a to-do's dragged place (241, listOrder on a task) round-trips, fractions included", () => {
  const item = { id: 1790000000123, type: "TASK", title: "Buy milk", startDay: null, freq: "NONE", priority: 0, listOrder: 17900000001234.5, updatedAt: 5 };
  const ok = parseSyncBody({ since: 0, changes: [{ kind: "items", id: String(item.id), data: item }] });
  assert.ok(typeof ok !== "string");
  assert.deepEqual(JSON.parse(canonical(ok.changes[0].data)), item);
});

test("futsal as events (240): an item's futsal mark and an entry's itemId/convertedTo round-trip", () => {
  const item = { id: 1234567890123, type: "EVENT", title: "Football", startDay: 20760, allDay: true, freq: "NONE", futsal: true, updatedAt: 100 };
  const log = { id: "futsal:1234567890123:20760", planId: "p", kind: "futsal", itemId: 1234567890123, day: null, durationMin: 60, updatedAt: 100 };
  const old = { id: "futsal-abc", planId: "p", kind: "futsal", day: 20760, convertedTo: 1234567890123, updatedAt: 101 };
  const ok = parseSyncBody({ since: 0, changes: [
    { kind: "items", id: String(item.id), data: item }, { kind: "trainingEntries", id: log.id, data: log }, { kind: "trainingEntries", id: old.id, data: old },
  ] });
  assert.ok(typeof ok !== "string");
  assert.deepEqual(ok.changes.map((c) => JSON.parse(canonical(c.data))), [item, log, old]);
});

test("newer record kinds need no Worker change; their records are keyed by id", () => {
  assert.ok(isKind("items") && isKind("trainingEntries") && isKind("trainingHidden") && isKind("insightsDays"));
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

// Item 141: changes that carry the copy they started from merge field by field.
import { FEATURES, conflictCopy, mergeFields, needsCopy, newItemId } from "../src/records.ts";

const note = (extra: Record<string, unknown> = {}) => ({
  id: 7, type: "NOTE", title: "Shopping", content: "<p>milk</p>", categoryId: 3, pinned: false, updatedAt: 10, deletedAt: null, ...extra,
});

test("edits of different fields on two devices both stand, with no clash", () => {
  const base = note();
  const { merged, clashes } = mergeFields(base, note({ title: "Groceries", updatedAt: 20 }), note({ pinned: true, pinOrder: 1, updatedAt: 15 }), false);
  assert.deepEqual(clashes, []);
  assert.deepEqual(merged, note({ title: "Groceries", pinned: true, pinOrder: 1, updatedAt: 20 }));
  assert.ok(!needsCopy("items", merged, clashes));
});

test("a field both sides changed goes to the winner, and a note's title or content clash asks for a copy", () => {
  const base = note();
  const mine = note({ content: "<p>milk, eggs</p>", updatedAt: 20 });
  const theirs = note({ content: "<p>milk, bread</p>", updatedAt: 30 });
  const won = mergeFields(base, mine, theirs, true);
  assert.deepEqual(won.clashes, ["content"]);
  assert.equal(won.merged.content, "<p>milk, eggs</p>");
  assert.equal(won.merged.updatedAt, 30, "the later edit time is kept, never a clash");
  assert.equal(mergeFields(base, mine, theirs, false).merged.content, "<p>milk, bread</p>");
  assert.ok(needsCopy("items", won.merged, won.clashes));
  // Tasks and events merge the same way, but never get copies; nor does a clash of another field.
  assert.ok(!needsCopy("items", { ...won.merged, type: "TASK" }, won.clashes));
  assert.ok(!needsCopy("items", won.merged, ["color"]));
  // Both making the same change is no clash.
  assert.deepEqual(mergeFields(base, mine, { ...mine, updatedAt: 25 }, false).clashes, []);
});

test("fields added or removed on one side merge too", () => {
  const { merged, clashes } = mergeFields(note({ hidden: true }), note({ hidden: true, location: "Home" }), note(), true);
  assert.deepEqual(clashes, []);
  assert.deepEqual(merged, note({ location: "Home" }), "the other side's removal of hidden stands, and the new field too");
});

test("the conflicted copy keeps the losing title and content, the note's category, and is new and unpinned", () => {
  const merged = note({ content: "<p>mine</p>", pinned: true, pinOrder: 2, listOrder: 5 });
  const copy = conflictCopy(merged, note({ content: "<p>theirs</p>" }), 99, 1234);
  assert.deepEqual(copy, note({ id: 99, title: "Shopping (conflicted copy)", content: "<p>theirs</p>", createdAt: 1234, updatedAt: 1234 }));
  assert.equal(conflictCopy(merged, note({ title: "  " }), 99, 1).title, "Conflicted copy");
  const id = newItemId();
  assert.ok(Number.isSafeInteger(id) && id >= 2 ** 40);
});

test("sync bodies keep a change's base only for edits, and refuse a malformed one", () => {
  const ok = parseSyncBody({ since: 0, changes: [
    { kind: "items", id: "7", data: note(), base: note({ title: "Old" }) },
    { kind: "items", id: "8", data: null, base: note({ id: 8 }) },
    { kind: "items", id: "9", data: note({ id: 9 }) },
  ] });
  assert.ok(typeof ok !== "string");
  assert.deepEqual(ok.changes.map((c) => c.base?.title ?? null), ["Old", null, null]);
  assert.equal(typeof parseSyncBody({ since: 0, changes: [{ kind: "items", id: "7", data: note(), base: [1] }] }), "string");
  assert.ok((FEATURES as readonly string[]).includes("baseMerge"));
});
