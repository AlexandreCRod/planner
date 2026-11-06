import assert from "node:assert/strict";
import { test } from "node:test";

const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => { kept.set(k, v); },
  removeItem: (k: string) => { kept.delete(k); },
};
const { HapticGate, TOUCH_FEEL_KEY, feelVia } = await import("../src/ui/phone/hapticGate.ts");
const { tipSkipped } = await import("../src/ui/phone/press.ts");
const { priorityItems } = await import("../src/ui/phone/priorityMenu.ts");
const { gesturesSummary } = await import("../src/ui/phone/pager.ts");

// Review C7.
test("with Vibrate on touch off, no pulse is played; on, it is", () => {
  const played: string[] = [];
  kept.set(TOUCH_FEEL_KEY, "false");
  feelVia(new HapticGate(), true, "pickup", 1000, (k) => played.push(k));
  assert.deepEqual(played, []);
  kept.delete(TOUCH_FEEL_KEY);
  feelVia(new HapticGate(), true, "pickup", 1000, (k) => played.push(k));
  assert.deepEqual(played, ["pickup"]);
});

test("a menu button still shows its name to the resting mouse; its hold opens the menu instead", () => {
  assert.equal(tipSkipped(false, true), false);
  assert.equal(tipSkipped(true, true), true);
  assert.equal(tipSkipped(true, false), false);
});

test("the priority menu ticks the current level", () => {
  const items = priorityItems(() => {}, 3);
  assert.deepEqual(items.map((i) => !!i.checked), [false, false, false, true, false]);
});

test("the folder's line uses the switch's own name", () => {
  assert.equal(gesturesSummary(false, true), "Swipes stay in the page · Vibrate on touch: on");
  assert.equal(gesturesSummary(true, null), "Swipes change tab");
});
