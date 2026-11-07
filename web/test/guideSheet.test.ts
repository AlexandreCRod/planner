import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 380: the exercise guide lagged when slid down; going between half and full animated its height (a layout every frame).
test("the exercise guide sheet never animates its height: one size, half and full only move it", () => {
  const css = readFileSync(new URL("../src/ui/phone/training.css", import.meta.url), "utf8");
  const rules = css.split("\n").filter((l) => l.includes(".tr-guide") && l.includes("{"));
  for (const r of rules) assert.doesNotMatch(r, /transition:[^;]*\bheight\b/, r);
  const sized = rules.filter((r) => /\.p-sheet\.tr-guide[^{]*\{[^}]*\bheight:/.test(r));
  assert.equal(sized.length, 1, "one height for the sheet, the same half or full");
  const m3 = readFileSync(new URL("../src/ui/phone/m3.tsx", import.meta.url), "utf8");
  assert.match(m3, /half\?: boolean/);
});
