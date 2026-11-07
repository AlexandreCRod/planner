import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 369: the Undo after an alarm's Skip was a filled, glaring button; it's now as quiet as Skip, in Skip's place.
test("the alarm card's Undo is plain text like Skip, with no fill", () => {
  const css = readFileSync(new URL("../src/ui/phone/phone.css", import.meta.url), "utf8");
  const undo = css.split("\n").filter((l) => l.includes(".pa-skipbtn.undo"));
  assert.ok(undo.length > 0);
  for (const l of undo) assert.doesNotMatch(l, /background/);
  const src = readFileSync(new URL("../src/ui/phone/PhoneAlarms.tsx", import.meta.url), "utf8");
  // A one-off alarm skipped is off; its card keeps Undo while the message's Undo can still bring it back.
  assert.match(src, /announceSkip\(/);
  assert.match(src, /\(\) => setJust\(null\)\);/);
});
