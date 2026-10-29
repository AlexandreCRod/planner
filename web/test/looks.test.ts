import assert from "node:assert/strict";
import { test } from "node:test";

// Looks are kept in localStorage; a small stand-in is enough here.
const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
};
const { LOOKS, look, setLook } = await import("../src/ui/phone/looks.ts");

test("each look starts on its pick, and the pick is one of its choices", () => {
  for (const k of Object.keys(LOOKS) as (keyof typeof LOOKS)[]) {
    assert.equal(look(k), LOOKS[k].pick, k);
    assert.ok(LOOKS[k].choices.some(([c]) => c === LOOKS[k].pick), k);
  }
});

test("a look is kept, an unknown value falls back to the pick, and the pick clears the key", () => {
  setLook("guides", "C");
  assert.equal(look("guides"), "C");
  assert.equal(kept.get("look.guides"), "C");
  kept.set("look.guides", "Z");
  assert.equal(look("guides"), "B");
  setLook("guides", "B");
  assert.equal(kept.has("look.guides"), false);
});
