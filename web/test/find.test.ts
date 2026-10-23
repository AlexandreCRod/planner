import assert from "node:assert/strict";
import { test } from "node:test";
import { findMatches, stepMatch } from "../src/domain/find.ts";

// Item 97: find inside a note.

test("matches ignore case and accents, and keep their place in the text", () => {
  assert.deepEqual(findMatches("Café, CAFE and cafe", "cafe"), [[0, 4], [6, 10], [15, 19]]);
  assert.deepEqual(findMatches("Crème brûlée", "BRULEE"), [[6, 12]]);
});

test("matches don't overlap, and nothing is found for an empty query", () => {
  assert.deepEqual(findMatches("aaaa", "aa"), [[0, 2], [2, 4]]);
  assert.deepEqual(findMatches("text", "  "), []);
  assert.deepEqual(findMatches("text", "zz"), []);
});

test("places stay right after emoji and other two-unit characters", () => {
  const text = "😀 milk";
  const [[s, e]] = findMatches(text, "milk");
  assert.equal(text.slice(s, e), "milk");
});

test("next and previous go round the matches", () => {
  assert.equal(stepMatch(3, 2, 1), 0);
  assert.equal(stepMatch(3, 0, -1), 2);
  assert.equal(stepMatch(3, -1, 1), 0);
  assert.equal(stepMatch(3, -1, -1), 2);
  assert.equal(stepMatch(0, 0, 1), -1);
});
