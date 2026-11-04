import assert from "node:assert/strict";
import { test } from "node:test";
import { SlideSession } from "../src/ui/phone/slideSession.ts";
import { TOUCH_SLOP } from "../src/ui/phone/press.ts";

// 361: hold a menu button, slide over an option, lift to pick it.
test("sliding onto an option and lifting picks that option", () => {
  const s = new SlideSession<string>(100, 100);
  s.move(100, 130, "Month");
  assert.equal(s.move(100, 180, "Week"), true); // the lit option changed
  assert.equal(s.over, "Week");
  assert.equal(s.up(), "Week");
});

test("a finger that never moved picks nothing, even with the menu opened right under it", () => {
  const s = new SlideSession<string>(100, 100);
  assert.equal(s.move(100 + TOUCH_SLOP - 1, 100, "Open"), false);
  assert.equal(s.over, null);
  assert.equal(s.up(), null);
});

test("sliding over an option and off it again picks nothing (the menu stays open to tap)", () => {
  const s = new SlideSession<string>(100, 100);
  s.move(100, 140, "Agenda");
  assert.equal(s.over, "Agenda");
  assert.equal(s.move(300, 400, null), true);
  assert.equal(s.up(), null);
});
