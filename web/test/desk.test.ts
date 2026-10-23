import { test } from "node:test";
import assert from "node:assert/strict";
import { WHEEL_GAP, WHEEL_STEP, WheelPager, deskAction, typingTarget, wheelZoom } from "../src/ui/phone/keys.ts";

const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean; composing?: boolean } = {}) => ({
  key: k, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift, isComposing: !!mods.composing,
});

test("fields and the note's text take typing; buttons, checkboxes and the page don't", () => {
  assert.equal(typingTarget({ tagName: "INPUT", type: "text" }), true);
  assert.equal(typingTarget({ tagName: "input", type: "search" }), true);
  assert.equal(typingTarget({ tagName: "INPUT" }), true);
  assert.equal(typingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(typingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(typingTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(typingTarget({ tagName: "BUTTON" }), false);
  assert.equal(typingTarget({ tagName: "DIV", isContentEditable: false }), false);
  assert.equal(typingTarget(null), false);
});

test("N, T and the arrows only while nothing is being typed", () => {
  assert.equal(deskAction(key("n"), false), "add");
  assert.equal(deskAction(key("N"), false), "add");
  assert.equal(deskAction(key("t"), false), "today");
  assert.equal(deskAction(key("ArrowLeft"), false), "prev");
  assert.equal(deskAction(key("ArrowRight"), false), "next");
  for (const k of ["n", "t", "ArrowLeft", "ArrowRight"]) assert.equal(deskAction(key(k), true), null);
});

test("with a modifier, N and T are the browser's (Ctrl+N, Ctrl+T, Shift+arrows)", () => {
  assert.equal(deskAction(key("n", { ctrl: true }), false), null);
  assert.equal(deskAction(key("t", { meta: true }), false), null);
  assert.equal(deskAction(key("T", { shift: true }), false), null);
  assert.equal(deskAction(key("ArrowLeft", { shift: true }), false), null);
  assert.equal(deskAction(key("ArrowRight", { alt: true }), false), null);
});

test("Ctrl+F (Cmd+F) finds and Esc goes back, typing or not", () => {
  assert.equal(deskAction(key("f", { ctrl: true }), true), "find");
  assert.equal(deskAction(key("F", { meta: true }), false), "find");
  assert.equal(deskAction(key("f"), false), null);
  assert.equal(deskAction(key("f", { ctrl: true, shift: true }), false), null);
  assert.equal(deskAction(key("Escape"), true), "back");
  assert.equal(deskAction(key("Escape"), false), "back");
});

test("nothing while a word is being composed (an input method)", () => {
  assert.equal(deskAction(key("Escape", { composing: true }), true), null);
  assert.equal(deskAction(key("n", { composing: true }), false), null);
});

test("a sideways swipe turns one page once it has gone far enough, whatever its fling", () => {
  const w = new WheelPager();
  let t = 0;
  assert.equal(w.feed(WHEEL_STEP / 2, 0, t += 16), 0);
  assert.equal(w.feed(WHEEL_STEP / 2 + 1, 0, t += 16), 1);
  // The rest of the same swipe (and its fling) turns nothing more.
  for (let i = 0; i < 40; i++) assert.equal(w.feed(30, 2, t += 16), 0);
  // After a pause, the next swipe turns the next page, the other way here.
  t += WHEEL_GAP + 1;
  assert.equal(w.feed(-WHEEL_STEP - 5, 0, t), -1);
});

test("scrolling up and down is not a swipe", () => {
  const w = new WheelPager();
  let t = 0;
  for (let i = 0; i < 20; i++) assert.equal(w.feed(10, 40, t += 16), 0);
});

test("a slow swipe starts afresh after a pause, without what came before", () => {
  const w = new WheelPager();
  assert.equal(w.feed(WHEEL_STEP - 5, 0, 0), 0);
  assert.equal(w.feed(WHEEL_STEP - 5, 0, WHEEL_GAP + 100), 0);
});

test("Ctrl+wheel zooms in going up, out going down, within the limits", () => {
  assert.ok(wheelZoom(60, -100, 20, 160) > 60);
  assert.ok(wheelZoom(60, 100, 20, 160) < 60);
  assert.equal(wheelZoom(150, -1000, 20, 160), 160);
  assert.equal(wheelZoom(25, 1000, 20, 160), 20);
});
