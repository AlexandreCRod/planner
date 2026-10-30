import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteToApply } from "../src/domain/syncMerge.ts";

// Item 34 (round 10): a sync reply must never replace a note edited while the request was out.

const note = (content: string) => ({ id: 7, type: "NOTE", content, updatedAt: 1 });

test("a reply leaves a record edited during the request alone", () => {
  const sentNote = note("draft");
  const sent = new Map<string, unknown>([["items/7", sentNote]]);
  const now = new Map<string, unknown>([["items/7", note("draft and the latest words")]]);
  const reply = [{ kind: "items", id: "7", data: note("an older copy from elsewhere") }];
  const { apply, kept } = remoteToApply(reply, sent, now);
  assert.deepEqual(apply, []);
  assert.deepEqual(kept, ["items/7"]);
});

test("records untouched since the request are updated as usual", () => {
  const same = note("same");
  const sent = new Map<string, unknown>([["items/7", same]]);
  const now = new Map<string, unknown>([["items/7", same]]);
  const reply = [{ kind: "items", id: "7", data: note("from the PC") }, { kind: "items", id: "9", data: note("new") }];
  assert.equal(remoteToApply(reply, sent, now).apply.length, 2);
});

test("a record created here during the request isn't replaced or deleted", () => {
  const sent = new Map<string, unknown>();
  const now = new Map<string, unknown>([["items/8", note("just typed")]]);
  const { apply, kept } = remoteToApply([{ kind: "items", id: "8", data: null }], sent, now);
  assert.deepEqual(apply, []);
  assert.deepEqual(kept, ["items/8"]);
});

test("a record deleted here during the request isn't brought back", () => {
  const sent = new Map<string, unknown>([["items/8", note("x")]]);
  const now = new Map<string, unknown>();
  assert.deepEqual(remoteToApply([{ kind: "items", id: "8", data: note("y") }], sent, now).kept, ["items/8"]);
});

// Item 141: a note edited during the request takes in the reply's other changes, keeping what was typed.
import { mergeEdited } from "../src/domain/syncMerge.ts";

test("an edit made during the request keeps its typing and takes the reply's other fields", () => {
  const sent = { id: 7, type: "NOTE", title: "Shopping", content: "milk", pinned: false, updatedAt: 10 };
  const now = { ...sent, content: "milk, eggs", updatedAt: 12 };
  const remote = { ...sent, title: "Groceries", pinned: true, pinOrder: 1, updatedAt: 11 };
  const { merged, clash } = mergeEdited(sent, now, remote);
  assert.equal(clash, false);
  assert.deepEqual(merged, { ...now, title: "Groceries", pinned: true, pinOrder: 1, updatedAt: 12 });
});

test("a field changed both here and in the reply is a clash, and this device's typing stays", () => {
  const sent = { id: 7, title: "Shopping", content: "milk", updatedAt: 10 };
  const now = { ...sent, content: "milk, eggs", updatedAt: 12 };
  const remote = { ...sent, content: "milk, bread", updatedAt: 20 };
  const { merged, clash } = mergeEdited(sent, now, remote);
  assert.equal(clash, true);
  assert.deepEqual(merged, { ...now, updatedAt: 20 });
  // A field removed in the reply is removed here too, unless edited here.
  assert.deepEqual(mergeEdited({ a: 1, b: 2 }, { a: 1, b: 3 }, { b: 2 }).merged, { b: 3 });
});
