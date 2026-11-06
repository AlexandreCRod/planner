import assert from "node:assert/strict";
import { test } from "node:test";
import { SLIDE_DWELL, SlideSession } from "../src/ui/phone/slideSession.ts";
import { TOUCH_SLOP } from "../src/ui/phone/press.ts";

// 361: hold a menu button, slide over an option, lift to pick it. Times in ms.
test("sliding onto an option, resting on it and lifting picks that option", () => {
  const s = new SlideSession<string>(100, 100, 0);
  s.move(100, 130, "Month", 50);
  assert.equal(s.move(100, 180, "Week", 100), true); // the lit option changed
  assert.equal(s.over, "Week");
  assert.equal(s.up(100 + SLIDE_DWELL + 10), "Week");
});

test("a finger that never moved picks nothing, even with the menu opened right under it", () => {
  const s = new SlideSession<string>(100, 100, 0);
  assert.equal(s.move(100 + TOUCH_SLOP - 1, 100, "Open", 300), false);
  assert.equal(s.over, null);
  assert.equal(s.up(600), null);
});

test("sliding over an option and off it again picks nothing (the menu stays open to tap)", () => {
  const s = new SlideSession<string>(100, 100, 0);
  s.move(100, 140, "Agenda", 200);
  assert.equal(s.over, "Agenda");
  assert.equal(s.move(300, 400, null, 400), true);
  assert.equal(s.up(800), null);
});

// Review C3: a resting thumb that then scrolls flicks across the options; its lift mustn't pick one.
test("a fast flick across the options that lifts at once picks nothing", () => {
  const s = new SlideSession<string>(100, 100, -100);
  s.move(100, 160, "A", 0); // 0.6 px/ms
  assert.equal(s.up(40), null);
  assert.equal(s.up(200), "A"); // had it rested there, it would
});

test("a slow, deliberate slide onto an option picks it as the finger lifts", () => {
  const s = new SlideSession<string>(100, 100, 0);
  s.move(100, 120, null, 100);
  s.move(100, 140, "A", 200); // 0.2 px/ms
  assert.equal(s.up(205), "A");
});

// Review C6: the click a hold's lift may make is dropped only for a moment.
test("a hold's leftover click is dropped right after, but never seconds later", async () => {
  const { dropsClick } = await import("../src/ui/phone/slideSession.ts");
  assert.equal(dropsClick(1000, 1100), true);
  assert.equal(dropsClick(1000, 3000), false);
  assert.equal(dropsClick(0, 100), false);
});
