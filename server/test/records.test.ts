import assert from "node:assert/strict";
import { test } from "node:test";
import { canonical, deletionGuard, keyOf, parseSnapshot, tokensMatch } from "../src/records.ts";

test("composite keys for join tables", () => {
  assert.equal(keyOf("completions", { itemId: 3, day: 20374 }), "3:20374");
  assert.equal(keyOf("links", { sourceId: 1, targetId: 9, auto: false }), "1:9");
  assert.equal(keyOf("items", { id: 42 }), "42");
});

test("canonical JSON ignores key order", () => {
  assert.equal(canonical({ b: 1, a: { d: [1, 2], c: null } }), canonical({ a: { c: null, d: [1, 2] }, b: 1 }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});

test("snapshot validation fills missing kinds and rejects bad shapes", () => {
  const ok = parseSnapshot({ items: [{ id: 1, title: "x" }] });
  assert.ok(typeof ok !== "string");
  assert.deepEqual(ok.links, []);
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
