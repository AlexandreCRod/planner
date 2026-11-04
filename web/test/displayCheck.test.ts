import assert from "node:assert/strict";
import { test } from "node:test";
import { BLACKS, displaySwatches } from "../src/ui/phone/displayColours.ts";

// 364: the Display check page shows the user's own categories and every fixed colour group, and true black beside the near-blacks.
test("the display check lists the user's categories, then flags, training and the highlight", () => {
  const g = displaySwatches([{ name: "Work", color: "#3366ff" }, { name: "Home", color: "#33aa55" }], [{ name: "Run chart", color: "#33a390" }]);
  assert.deepEqual(g.map((x) => x.title), ["Categories", "Flags", "Training", "Highlight"]);
  assert.deepEqual(g[0].list, [{ name: "Work", color: "#3366ff" }, { name: "Home", color: "#33aa55" }]);
  assert.deepEqual(g[1].list.map((w) => w.name), ["Low", "Medium", "High", "Urgent"]);
  assert.ok(g[2].list.some((w) => w.name === "Run") && g[2].list.some((w) => w.name === "Futsal"));
  assert.ok(g[2].list.some((w) => w.color === "#33a390"));
});

test("true black sits beside #0c0c0f and #17171b", () => {
  assert.deepEqual(BLACKS.map((b) => b.color), ["#000000", "#0c0c0f", "#17171b"]);
});
