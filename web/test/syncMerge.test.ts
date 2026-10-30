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

// Item 141 review: the synced copy and the second round.
import { outgoingChanges, settleReply } from "../src/domain/syncMerge.ts";

const opts = { withBase: true, takes: () => true, maxChars: 1_000_000 };

test("an edit during the request trashed elsewhere stays out of the trash", () => {
  const sent = { id: 7, title: "a", content: "x", deletedAt: null, updatedAt: 1 };
  const { merged } = mergeEdited(sent, { ...sent, content: "xy", updatedAt: 2 }, { ...sent, deletedAt: 5, updatedAt: 5 });
  assert.equal(merged.deletedAt, null);
  assert.equal(merged.content, "xy");
});

test("edited items carry their base, deletes and other kinds don't, and the Worker without merging gets none", () => {
  const b = { id: 7, title: "a" };
  const base = { seq: 3, records: { "items/7": b, "items/8": { id: 8 }, "tags/1": { id: 1, name: "x" } } };
  const local = new Map<string, Record<string, unknown>>([["items/7", { id: 7, title: "b" }], ["tags/1", { id: 1, name: "y" }], ["items/9", { id: 9 }]]);
  const { outgoing } = outgoingChanges(base, local, opts);
  assert.deepEqual(outgoing.map((c) => [c.kind, c.id, c.base?.title ?? null, c.data === null]),
    [["items", "7", "a", false], ["items", "8", null, true], ["tags", "1", null, false], ["items", "9", null, false]]);
  assert.ok(outgoingChanges(base, local, { ...opts, withBase: false }).outgoing.every((c) => c.base === undefined && c.keep === undefined));
});

test("second round: text typed during a request that clashed is sent against what was sent, with keep mine", () => {
  const b0 = { id: 7, type: "NOTE", title: "Shopping", content: "milk", updatedAt: 1 };
  const v1 = { ...b0, content: "milk, eggs", updatedAt: 2 };
  const base = { seq: 5, records: { "items/7": b0 } };
  const sent = new Map<string, Record<string, unknown>>([["items/7", v1]]);
  const { outgoing } = outgoingChanges(base, sent, opts);
  const v2 = { ...v1, content: "milk, eggs, tea", updatedAt: 3 };
  const now = new Map<string, Record<string, unknown>>([["items/7", v2]]);
  // The reply: the other device's content won, and a title change came in.
  const remote = { ...b0, title: "Groceries", content: "milk, bread", updatedAt: 4 };
  const { apply, kept, next } = settleReply(base, sent, now, outgoing, { seq: 9, changes: [{ kind: "items", id: "7", data: remote }] });
  assert.deepEqual(kept, ["items/7"]);
  assert.deepEqual(apply.map((c) => c.data), [{ ...v2, title: "Groceries", updatedAt: 4 }]);
  assert.deepEqual(next, { seq: 9, records: { "items/7": v1 }, mine: ["items/7"] });
  const round2 = outgoingChanges(next, new Map([["items/7", apply[0].data!]]), opts).outgoing;
  assert.deepEqual(round2, [{ kind: "items", id: "7", data: apply[0].data, base: v1, keep: "mine" }]);
  // That round's reply clears it.
  const after = settleReply(next, new Map([["items/7", apply[0].data!]]), new Map([["items/7", apply[0].data!]]), round2, { seq: 10, changes: [] });
  assert.equal(after.next.mine, undefined);
  assert.deepEqual(after.next.records["items/7"], apply[0].data);
});
