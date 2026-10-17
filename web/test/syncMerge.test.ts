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
