import assert from "node:assert/strict";
import { test } from "node:test";
import { TapGuard, setGestureEdges } from "../src/ui/phone/tapGuard.ts";

// 378: the Android back gesture from the right edge flipped "Show on calendar" while a routine was set up.
test("a still tap flips a switch; a little jitter within the slop does too", () => {
  const g = new TapGuard();
  g.down(380, 500, 1000); g.move(383, 502); g.up(384, 502, 1080);
  assert.equal(g.allows(1085), true);
});

test("a finger that slides in from the edge (the back gesture) never flips it", () => {
  const g = new TapGuard();
  g.down(410, 500, 1000); g.move(395, 501); g.move(340, 503); g.up(320, 503, 1200);
  assert.equal(g.allows(1205), false);
});

test("a touch the system or the browser took (cancelled) never flips it", () => {
  const g = new TapGuard();
  g.down(410, 500, 1000); g.cancel(1100);
  assert.equal(g.allows(1110), false);
});

test("a back press that came while the finger was down stops the flip, even without movement seen", () => {
  const g = new TapGuard();
  g.down(410, 500, 1000); g.back(1150); g.up(410, 500, 1200);
  assert.equal(g.allows(1205), false);
});

test("a back press before the touch, or a mouse click long after it, doesn't block", () => {
  const g = new TapGuard();
  g.back(900); g.down(200, 300, 1000); g.up(200, 300, 1060);
  assert.equal(g.allows(1065), true);
  const m = new TapGuard();
  m.down(410, 500, 1000); m.move(300, 500); m.up(300, 500, 1100);
  assert.equal(m.allows(5000), true); // a later mouse click or key
});

test("a touch that starts in the back gesture's edge strip is known as one, and so is the back press after it", () => {
  const g = new TapGuard();
  g.down(405, 600, 1000); g.up(405, 600, 1150);
  assert.equal(g.fromEdge(411), true);
  assert.equal(g.backSince(), false);
  g.back(1200);
  assert.equal(g.backSince(), true);
  const mid = new TapGuard();
  mid.down(370, 600, 1000);
  assert.equal(mid.fromEdge(411), false);
});

test("review of 2.10.4, finding 9: the phone's own wider back-gesture zone counts as the edge, and never less than 24 px", () => {
  const at = (x: number) => { const g = new TapGuard(); g.down(x, 600, 1000); return g.fromEdge(411); };
  assert.equal(at(30), false); // 24 px strip
  setGestureEdges(40, 36);
  assert.equal(at(30), true);
  assert.equal(at(411 - 30), true);
  assert.equal(at(411 - 38), false);
  setGestureEdges(0, 0); // three-button navigation
  assert.equal(at(20), true);
  assert.equal(at(30), false);
  setGestureEdges(24, 24);
});
