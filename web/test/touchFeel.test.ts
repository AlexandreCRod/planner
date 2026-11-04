import assert from "node:assert/strict";
import { test } from "node:test";

const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => { kept.set(k, v); },
  removeItem: (k: string) => { kept.delete(k); },
};
const { TOUCH_FEEL_KEY, touchFeelOn } = await import("../src/ui/phone/hapticGate.ts");

test("the touch feel is on until turned off in Touch and gestures, and off once turned off", () => {
  kept.clear();
  assert.equal(touchFeelOn(), true);
  kept.set(TOUCH_FEEL_KEY, "false");
  assert.equal(touchFeelOn(), false);
  kept.set(TOUCH_FEEL_KEY, "true");
  assert.equal(touchFeelOn(), true);
});
