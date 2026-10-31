import assert from "node:assert/strict";
import { test } from "node:test";

const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => { kept.set(k, v); },
  removeItem: (k: string) => { kept.delete(k); },
};
const { BAR_DAYS_KEY, NO_SWIPE, SWIPE_TABS_KEY, barDays, barTarget, swipeTabs } = await import("../src/ui/phone/pager.ts");
const { claimSwipe, clearSwipeClaim, swipeClaimed } = await import("../src/ui/phone/gesture.ts");

test("pages change tab by default, and the bottom bar stays on tabs", () => {
  kept.clear();
  assert.equal(swipeTabs(), true);
  assert.equal(barDays(), false);
});

test("the bottom bar's option only counts while the pages change tabs", () => {
  kept.clear();
  kept.set(BAR_DAYS_KEY, "true");
  assert.equal(barDays(), true);
  kept.set(SWIPE_TABS_KEY, "false");
  assert.equal(swipeTabs(), false);
  assert.equal(barDays(), false);
});

test("a finger belongs to whoever claimed it, until the next one", () => {
  clearSwipeClaim();
  assert.equal(swipeClaimed(3), false);
  claimSwipe(3);
  assert.equal(swipeClaimed(3), true);
  assert.equal(swipeClaimed(4), false);
  clearSwipeClaim();
  assert.equal(swipeClaimed(3), false);
});

test("a swipe settles one tab on, or stays, and stops at the ends", () => {
  assert.equal(barTarget(1, 1.2, 0, 3), 1); // a short slow swipe stays
  assert.equal(barTarget(1, 1.6, 0, 3), 2); // past the middle
  assert.equal(barTarget(1, 1.1, 1, 3), 2); // a flick
  assert.equal(barTarget(3, 3.1, 1, 3), 3); // the last tab
  assert.equal(barTarget(0, -0.1, -1, 3), 0); // the first
});

test("charts, steppers and fields keep their own drags", () => {
  for (const s of [".pg-chart", ".p-slide", "input", "textarea", ".p-switch", ".p-sheet-root"]) assert.ok(NO_SWIPE.includes(s), s);
});
