import assert from "node:assert/strict";
import { test } from "node:test";
import { searchEmpty } from "../src/ui/shared/kinds.ts";

// Review of 2.10, finding 8: a chip picked with no words is a search that found nothing, not an empty app.
test("Search's empty block says what fits: words, a chip, or nothing asked", () => {
  assert.deepEqual(searchEmpty("dentist", false), { title: "Nothing found", hint: "Try other words or fewer filters" });
  assert.deepEqual(searchEmpty("dentist", true), { title: "Nothing found", hint: "Try other words or fewer filters" });
  assert.deepEqual(searchEmpty("  ", true), { title: "Nothing found", hint: "Try fewer filters" });
  assert.deepEqual(searchEmpty("", false), { title: "Nothing here yet", hint: "What you add shows up here" });
});
