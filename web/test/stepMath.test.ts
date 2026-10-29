import assert from "node:assert/strict";
import { test } from "node:test";
import { STEP_PX, clamp, decimalsOf, slideSteps, stepValue, typedValue } from "../src/ui/phone/stepMath.ts";

test("a step only once the finger has fully passed it, either way; left is more (264)", () => {
  assert.equal(slideSteps(0), 0);
  assert.equal(slideSteps(-STEP_PX + 1), 0);
  assert.equal(slideSteps(-STEP_PX), 1);
  assert.equal(slideSteps(-3.5 * STEP_PX), 3);
  assert.equal(slideSteps(STEP_PX - 1), 0);
  assert.equal(slideSteps(2 * STEP_PX), -2);
});

test("steps stay within the limits", () => {
  assert.equal(stepValue(5, -10, 2.5, 0, 999), 0);
  assert.equal(stepValue(0, -1, 1, 0, 999), 0);
  assert.equal(stepValue(26, 5, 1, 0, 28), 28);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(12, 0, 10), 10);
});

test("0.1 steps never drift", () => {
  let v = 78;
  for (let i = 0; i < 6; i++) v = stepValue(v, 1, 0.1, 0, 300);
  assert.equal(v, 78.6);
  assert.equal(stepValue(78, 6, 0.1, 0, 300), 78.6);
  assert.equal(stepValue(0.1, 2, 0.1, 0, 300), 0.3);
  assert.equal(stepValue(60, 3, 2.5, 0, 999), 67.5);
  // A typed value finer than the step keeps its own decimals.
  assert.equal(stepValue(81.25, 1, 2.5, 0, 999), 83.75);
  assert.deepEqual([2.5, 0.1, 1, 0.25].map(decimalsOf), [1, 1, 0, 2]);
});

test("a typed number is read, kept in range, and whole unless decimals are allowed", () => {
  assert.equal(typedValue("78,5", 0, 999, true), 78.5);
  assert.equal(typedValue(" 80 ", 0, 999, true), 80);
  assert.equal(typedValue("2.6", 0, 999, false), 3);
  assert.equal(typedValue("5000", 0, 999, true), 999);
  assert.equal(typedValue("", 0, 999, true), null);
  assert.equal(typedValue("abc", 0, 999, true), null);
  assert.equal(typedValue("-4", 0, 999, true), null);
  assert.equal(typedValue(".", 0, 999, true), null);
});
