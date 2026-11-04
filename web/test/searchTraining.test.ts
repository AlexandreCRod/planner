import assert from "node:assert/strict";
import { test } from "node:test";
import { TRAINING_KIND, searchParts, startKinds } from "../src/ui/shared/kinds.ts";

// 343: one search button. Training's search is a kind of the main search; opened from Training, it starts there.
test("Search opened from Training starts filtered to Training; from other pages as before", () => {
  assert.deepEqual([...startKinds("", "training")], [TRAINING_KIND]);
  assert.deepEqual([...startKinds("", "notes")], ["NOTES"]);
  assert.deepEqual([...startKinds("", "today")], []);
  assert.deepEqual([...startKinds("TRAINING,NOTES,ALL,bogus", "")], [TRAINING_KIND, "NOTES"]);
});

test("All lists items and training; Training alone lists only training; other kinds only items", () => {
  assert.deepEqual(searchParts(new Set()), { items: true, training: true });
  assert.deepEqual(searchParts(new Set([TRAINING_KIND])), { items: false, training: true });
  assert.deepEqual(searchParts(new Set(["NOTES"])), { items: true, training: false });
  assert.deepEqual(searchParts(new Set(["NOTES", TRAINING_KIND])), { items: true, training: true });
});
