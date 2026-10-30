import assert from "node:assert/strict";
import { test } from "node:test";
import { clampToBox, mouseEdgeSpeed } from "../src/ui/phone/mouseSelect.ts";

// Item 258: selecting a note's text with the mouse on the PC.

test("a selection scrolls the note only near or past its edges, faster further out, never racing", () => {
  assert.equal(mouseEdgeSpeed(400, 100, 800), 0); // well inside: no scrolling
  assert.ok(mouseEdgeSpeed(790, 100, 800) > 0); // near the bottom: creeps down
  assert.ok(mouseEdgeSpeed(110, 100, 800) < 0); // near the top: creeps up
  assert.ok(mouseEdgeSpeed(900, 100, 800) > mouseEdgeSpeed(820, 100, 800)); // further out: faster
  assert.ok(mouseEdgeSpeed(820, 100, 800) > mouseEdgeSpeed(790, 100, 800));
  assert.equal(mouseEdgeSpeed(5000, 100, 800), 48); // capped
  assert.equal(mouseEdgeSpeed(-5000, 100, 800), -48);
  assert.equal(mouseEdgeSpeed(1000, 100, 800), -mouseEdgeSpeed(-100, 100, 800));
});

test("the mouse anywhere on the page stands for the nearest point of the note's visible text", () => {
  const box = { left: 100, top: 50, right: 500, bottom: 650 };
  assert.deepEqual(clampToBox(300, 300, box), [300, 300]);
  assert.deepEqual(clampToBox(900, 300, box), [499, 300]);
  assert.deepEqual(clampToBox(0, 2000, box), [101, 649]);
  assert.deepEqual(clampToBox(300, -40, box), [300, 51]);
});
