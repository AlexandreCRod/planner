import assert from "node:assert/strict";
import { test } from "node:test";
import { checklistBlock, checklistDepth, checklistRun, checklistSlots, checklistTicked, completedSections, enterSplitsAt, moveChecklistBlock, tickAnchor, tickMoveOrder, withoutBoxes } from "../src/domain/checklist.ts";

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

const applyOrder = (texts: string[], order: number[] | null) => (order ? order.map((k) => texts[k]) : texts);

test("a ticked item goes to the end of its own checklist, with its sub-items", () => {
  // Milk was just ticked: it lands after Bread; the other list and the title stay.
  const a = ["Shopping", "☑ Milk", "⠀⠀⠀☐ Oat", "☐ Eggs", "☐ Bread", "", "☐ Other"];
  assert.deepEqual(applyOrder(a, tickMoveOrder(a, 1)), ["Shopping", "☐ Eggs", "☐ Bread", "☑ Milk", "⠀⠀⠀☐ Oat", "", "☐ Other"]);
  // Already last: nothing moves. A ticked sub-item stays under its parent.
  assert.equal(tickMoveOrder(["☐ A", "☑ B"], 1), null);
  assert.equal(tickMoveOrder(["☐ A", "⠀⠀⠀☑ a", "☐ B"], 1), null);
  assert.equal(tickMoveOrder(["Text"], 0), null);
});

test("a ticked item joins the end of the completed ones; unticking goes back above them", () => {
  const t = ["☑ A", "☑ B", "☑ C", "☐ D"];
  assert.deepEqual(applyOrder(t, tickMoveOrder(t, 0)), ["☑ B", "☑ C", "☐ D", "☑ A"]);
  // Unticked: it goes to the end of the open items, just above the completed ones (with its sub-items).
  const v = ["☐ A", "☑ B", "☐ C", "⠀⠀⠀☑ c"];
  assert.deepEqual(applyOrder(v, tickMoveOrder(v, 2)), ["☐ A", "☐ C", "⠀⠀⠀☑ c", "☑ B"]);
  // Already just above the completed items: nothing moves.
  assert.equal(tickMoveOrder(["☐ A", "☐ B", "☑ C", "☑ D"], 1), null);
  // Not among the completed ones (an older note): it stays where it is.
  assert.equal(tickMoveOrder(["☐ A", "☐ B", "☑ C"], 0), null);
  assert.equal(tickMoveOrder(["☐ A", "☐ B"], 1), null);
});

test("copied lists leave their boxes behind", () => {
  assert.equal(withoutBoxes("Shopping\n☐ Milk\n☑ Eggs\n⠀⠀⠀☐ Free range\n☐ \nAnd ☐ this stays"), "Shopping\nMilk\nEggs\n   Free range\n\nAnd ☐ this stays");
  assert.equal(withoutBoxes("☐Milk"), "Milk");
});

test("an unticked item goes back where it was: after the open item it remembered", () => {
  // Ticking remembers the open item above (a sub-item's parent counts as the item).
  assert.equal(tickAnchor(["☐ A", "☑ B", "☐ C"], 1), "A");
  assert.equal(tickAnchor(["☑ A", "☐ B"], 0), "");
  assert.equal(tickAnchor(["☐ A", "⠀⠀⠀☐ a", "☑ B"], 2), "A");
  assert.equal(tickAnchor(["Text", "☑ A"], 0), null);
  // B was between A and C: back after A, with its sub-item.
  const anchors = (m: Record<number, string>) => (line: number) => m[line] ?? null;
  const u = ["☐ A", "☐ C", "☐ D", "☐ B", "⠀⠀⠀☐ b"];
  assert.deepEqual(applyOrder(u, tickMoveOrder(u, 3, anchors({ 3: "A" }))), ["☐ A", "☐ B", "⠀⠀⠀☐ b", "☐ C", "☐ D"]);
  // A was ticked too since: B goes where A would (the top).
  const v = ["☐ C", "☐ D", "☐ B", "☑ A"];
  assert.deepEqual(applyOrder(v, tickMoveOrder(v, 2, anchors({ 2: "A", 3: "" }))), ["☐ B", "☐ C", "☐ D", "☑ A"]);
  // Its neighbour was deleted or reworded: the end of the open items, as before.
  const w = ["☐ C", "☐ D", "☐ B", "☑ E"];
  assert.deepEqual(applyOrder(w, tickMoveOrder(w, 2, anchors({ 2: "A" }))), w);
  assert.deepEqual(applyOrder(w, tickMoveOrder(w, 2, anchors({ 2: "C" }))), ["☐ C", "☐ B", "☐ D", "☑ E"]);
  // Already in its place: nothing moves.
  assert.equal(tickMoveOrder(["☐ A", "☐ B"], 1, anchors({ 1: "A" })), null);
});

test("completed sections: the ticked items at the end of each checklist", () => {
  const n = ["Title", "☐ A", "☑ B", "⠀⠀⠀☑ b", "☑ C", "", "☑ X", "☐ Y", "", "☑ Only"];
  assert.deepEqual(completedSections(n), [{ first: 2, last: 4, count: 2 }, { first: 9, last: 9, count: 1 }]);
  // Ticked items above an open one (an older note) are not a section; a ticked sub-item under an open line neither.
  assert.deepEqual(completedSections(["☑ A", "☐ B", "⠀⠀⠀☑ b"]), []);
  assert.equal(checklistTicked("⠀⠀⠀☑ b"), true);
  assert.equal(checklistTicked("☐ b"), false);
});
