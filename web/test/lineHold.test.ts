import assert from "node:assert/strict";
import { test } from "node:test";
import { LINE_HOLD, holdsLine, lineHoldMove, slotFor } from "../src/ui/phone/lineHold.ts";
import { LONG_PRESS, TOUCH_SLOP } from "../src/ui/phone/press.ts";

// 331: a short hold on a note's checkbox line lifts it (the one hold time), on a touch screen only.
const press = { pointerType: "touch", primary: true, checkLine: true, folded: false, dragging: false };

test("a finger resting on a shown checkbox line can lift it", () => {
  assert.equal(holdsLine(press), true);
  assert.equal(holdsLine({ ...press, pointerType: "pen" }), true);
});

test("a plain text line, a folded ticked line, a second finger or a drag under way never lift", () => {
  assert.equal(holdsLine({ ...press, checkLine: false }), false);
  assert.equal(holdsLine({ ...press, folded: true }), false);
  assert.equal(holdsLine({ ...press, primary: false }), false);
  assert.equal(holdsLine({ ...press, dragging: true }), false);
});

test("the mouse keeps pressing and moving to select text (it drags by the handle)", () => {
  assert.equal(holdsLine({ ...press, pointerType: "mouse" }), false);
});

test("the line waits the one hold time", () => {
  assert.equal(LINE_HOLD, LONG_PRESS);
});

test("a finger that moves past the slop before the hold is a scroll; a wobble isn't", () => {
  assert.equal(lineHoldMove(100, 100, 100 + TOUCH_SLOP - 1, 100), "wait");
  assert.equal(lineHoldMove(100, 100, 100, 100 + TOUCH_SLOP + 1), "off");
  assert.equal(lineHoldMove(100, 100, 106, 106), "off");
});

// Review of 2.10.3, finding 8: the Clock tab's hold uses the same rule, so a finger that moves 30 px straight up
// (the start of a flick, a rolling thumb) without sliding sideways no longer opens its list.
test("a finger moving straight up or down past the slop drops a hold, with no sideways move at all", () => {
  assert.equal(lineHoldMove(200, 700, 200, 670), "off");
  assert.equal(lineHoldMove(200, 700, 200, 730), "off");
  assert.equal(lineHoldMove(200, 700, 200, 700 - TOUCH_SLOP + 1), "wait");
});

// Four 24 px lines at 0, 24, 48, 72; the second (24) is lifted: the others rest at 0, 24 (was 48), 48 (was 72).
const others = [{ top: 0, h: 24 }, { top: 24, h: 24 }, { top: 48, h: 24 }];

test("a lifted line that hasn't moved stays in its place, wherever the finger is on it", () => {
  assert.equal(slotFor(others, 24), 1);
});

test("a lifted line passes the next one once its top is over that line's middle, either way", () => {
  assert.equal(slotFor(others, 24 + 11), 1);
  assert.equal(slotFor(others, 24 + 13), 2);
  assert.equal(slotFor(others, 24 - 11), 1);
  assert.equal(slotFor(others, 24 - 13), 0);
  assert.equal(slotFor(others, 200), 3);
});

test("a two-line item lifted over a short line doesn't move until it's dragged", () => {
  // A 48 px item at 0 lifted; the 24 px lines under it rest at 0 and 24.
  assert.equal(slotFor([{ top: 0, h: 24 }, { top: 24, h: 24 }], 0), 0);
});

// Review of 2.10.3, finding 3: a hold on a web link inside a checkbox line opens the link's card only; the line
// doesn't lift under it as well (one hold meaning on one spot).
test("a finger resting on a web link in a checkbox line never lifts the line", () => {
  assert.equal(holdsLine({ ...press, onLink: true }), false);
  assert.equal(holdsLine({ ...press, onLink: false }), true);
});
