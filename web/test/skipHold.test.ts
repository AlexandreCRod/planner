import assert from "node:assert/strict";
import { test } from "node:test";

// Review of 2.10.4, findings 2 and 3: an alarm card's Skip shows "It won't ring tomorrow" with Undo, and holds
// the top line ("No alarm on / It won't ring tomorrow") while that message lasts, so the cards don't jump.
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const { announceSkip, endSkip, skipHeld } = await import("../src/ui/phone/skipHold.ts");
const { currentSnack } = await import("../src/ui/phone/snackbar.ts");

test("skipping a second alarm while the first one's message shows keeps the top line held", () => {
  let firstGone = 0;
  announceSkip("It won't ring tomorrow", "It won't ring tomorrow", () => {}, () => { firstGone++; });
  const second = announceSkip("It won't ring tomorrow", "It won't ring Tue 10", () => {}, () => {});
  assert.equal(firstGone, 1, "the first card hears its message went");
  assert.equal(skipHeld(), "It won't ring Tue 10");
  assert.equal(currentSnack()?.id, second.snack);
  endSkip(second);
});

test("the card's own Undo takes its message away too, and lets the top line go", () => {
  let gone = 0;
  const note = announceSkip("These alarms won't ring tomorrow", "These alarms won't ring tomorrow", () => {}, () => { gone++; });
  assert.equal(currentSnack()?.text, "These alarms won't ring tomorrow");
  endSkip(note);
  assert.equal(currentSnack(), null);
  assert.equal(skipHeld(), null);
  assert.equal(gone, 0, "not 'gone without Undo': the Undo was used");
});

test("Undo in the message lets the top line go; a later message from elsewhere leaves another Skip's hold alone", async () => {
  const note = announceSkip("It won't ring tomorrow", "It won't ring tomorrow", () => {}, () => {});
  currentSnack()!.onAction!();
  assert.equal(skipHeld(), null);
  endSkip(note); // nothing left to take away
  announceSkip("It won't ring tomorrow", "It won't ring tomorrow", () => {}, () => {});
  const { hideSnackbar } = await import("../src/ui/phone/snackbar.ts");
  hideSnackbar(-1); // someone else's old message: nothing happens
  assert.equal(skipHeld(), "It won't ring tomorrow");
});
