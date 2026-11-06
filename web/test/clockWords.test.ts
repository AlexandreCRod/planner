import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Coherence rule 7 (review of 2.10.2, finding 8): an Undo message reads "… removed · Undo" or "… moved to trash ·
// Undo". The Clock page's alarms, timers and stopwatches don't go to the trash, so they're "removed".
test("the Clock page's delete messages say \"removed\", never \"deleted\"", () => {
  const src = readFileSync(new URL("../src/ui/phone/PhoneAlarms.tsx", import.meta.url), "utf8");
  const said = [...src.matchAll(/showSnackbar\(([^;]*?)(?:, "Undo"|\);)/g)].map((m) => m[1]);
  assert.ok(said.some((t) => /alarms removed/.test(t)), "the selection's delete message");
  assert.deepEqual(said.filter((t) => /deleted/.test(t)), []);
});
