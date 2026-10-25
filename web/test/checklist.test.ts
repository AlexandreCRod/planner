import assert from "node:assert/strict";
import { test } from "node:test";
import { checklistBlock, checklistDepth, checklistRun, checklistSlots, enterSplitsAt, moveChecklistBlock } from "../src/domain/checklist.ts";

const note = ["Shopping", "☐ Milk", "☑ Eggs", "⠀⠀⠀☐ Free range", "☐ Bread", "", "☐ Other list"];

test("checklist lines and their depth", () => {
  assert.equal(checklistDepth("☐ Milk"), 0);
  assert.equal(checklistDepth("⠀⠀⠀☑ x"), 3);
  assert.equal(checklistDepth("Shopping"), -1);
});

test("a run is the adjoining checklist lines; a block takes the lines indented under it", () => {
  assert.deepEqual(checklistRun(note, 3), [1, 4]);
  assert.equal(checklistRun(note, 0), null);
  assert.deepEqual(checklistRun(note, 6), [6, 6]);
  assert.deepEqual(checklistBlock(note, 2), [2, 3]);
  assert.deepEqual(checklistBlock(note, 1), [1, 1]);
});

test("a line moves with its sub-items, only within its own run", () => {
  // Eggs (with Free range) above Milk.
  assert.deepEqual(moveChecklistBlock(note, note, 2, 1), ["Shopping", "☑ Eggs", "⠀⠀⠀☐ Free range", "☐ Milk", "☐ Bread", "", "☐ Other list"]);
  // Milk to the end of its run (after Bread).
  assert.deepEqual(moveChecklistBlock(note, note, 1, 4), ["Shopping", "☑ Eggs", "⠀⠀⠀☐ Free range", "☐ Bread", "☐ Milk", "", "☐ Other list"]);
  // Where Milk may land, in the lines without it: where it was (before Eggs, 1), before Bread (3), or the
  // run's end (4); never inside Eggs's sub-items or in the other list.
  assert.deepEqual(checklistSlots(note, 1), [1, 3, 4]);
  // A sub-item stays among its parent's lines, so it can go before Eggs's other lines, not outside the run.
  assert.ok(checklistSlots(note, 3).every((i) => i >= 1 && i <= 4));
});

test("Backspace at the start of a checkbox line takes the box away first", async () => {
  const { backspaceTakesBox, checklistLead } = await import("../src/domain/checklist.ts");
  assert.equal(checklistLead("☐ milk"), 2);
  assert.equal(checklistLead("⠀⠀⠀☑ done"), 5);
  assert.equal(checklistLead("plain"), -1);
  assert.equal(backspaceTakesBox("☐ milk", 2), true); // right after the box
  assert.equal(backspaceTakesBox("☐ ", 2), true); // an empty box line
  assert.equal(backspaceTakesBox("⠀⠀⠀☐ milk", 0), true);
  assert.equal(backspaceTakesBox("☐ milk", 3), false); // inside the text: an ordinary Backspace
  assert.equal(backspaceTakesBox("milk", 0), false); // a plain line joins the one above as usual
});

test("Enter in a checkbox line moves the text after the caret onto the new box", () => {
  // "☐ Milk and eggs", caret after "Milk": "and eggs" goes down (the space between stays behind).
  assert.equal(enterSplitsAt("☐ Milk and eggs", 6), 7);
  assert.equal(enterSplitsAt("☐ Milk and eggs", 8), 8);
  // At the end, or with only blanks after it: a new empty box.
  assert.equal(enterSplitsAt("☐ Milk", 6), null);
  assert.equal(enterSplitsAt("☐ Milk  ", 6), null);
  // An empty box keeps making new ones.
  assert.equal(enterSplitsAt("☐ ", 2), null);
  // Right after the box: the whole text goes down, the empty box stays.
  assert.equal(enterSplitsAt("☑ Eggs", 2), 2);
  // Before the box (or in its indent) splits after it, never through the lead.
  assert.equal(enterSplitsAt("⠀⠀⠀☐ Free range", 1), 5);
  assert.equal(enterSplitsAt("⠀⠀⠀☐ Free range", 9), 10);
  // Not a checklist line.
  assert.equal(enterSplitsAt("Shopping", 3), null);
});
