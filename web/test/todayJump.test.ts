import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 370: Calendar's jump back to today flickered (353's quick fade from 25 % opacity): it's instant now.
test("the Calendar's jump to today changes the days at once, with no fade of the page", () => {
  const src = readFileSync(new URL("../src/ui/phone/PhoneCalendar.tsx", import.meta.url), "utf8");
  const jump = /const jumpToday = \(\) => \{([^\n]*)\};/.exec(src);
  assert.ok(jump, "jumpToday found");
  assert.doesNotMatch(jump[1], /fade|animate|opacity/i);
  assert.doesNotMatch(src, /\{ opacity: 0\.25 \}/);
});
