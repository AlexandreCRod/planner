import assert from "node:assert/strict";
import { test } from "node:test";
import { menuShiftX } from "../src/ui/phone/menuFit.ts";

// Review C2: a held routine chip near the right of Today's line put its menu half off the screen.
test("a menu that would run off the right edge moves left until it's whole", () => {
  const left = 320, width = 118, view = 390;
  assert.ok(left + menuShiftX(left, width, view) <= view - width - 8);
});

test("a menu that fits stays where it is; one off the left edge moves right", () => {
  assert.equal(menuShiftX(40, 118, 390), 0);
  assert.equal(menuShiftX(-20, 118, 390), 28);
});
