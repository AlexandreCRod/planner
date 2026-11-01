import { test } from "node:test";
import assert from "node:assert/strict";
import { ShellPos, shownChangesAt } from "../src/ui/phone/shellPos.ts";
import { PAGE_SPRING, springFrames } from "../src/ui/phone/motion.ts";

/** An element as ShellPos uses it: styles, and animations that the test plays by hand. */
function fakeEl(size = 100) {
  const anims: { frames: { transform: string }[]; currentTime: number; cancelled: boolean; onfinish: (() => void) | null; cancel(): void }[] = [];
  const log: string[] = [];
  const style = { _t: "", set transform(v: string) { this._t = v; log.push(`style ${v}`); }, get transform() { return this._t; } };
  return {
    style, anims, log, offsetWidth: size, offsetHeight: size,
    animate(frames: { transform: string }[]) {
      const a = { frames, currentTime: 0, cancelled: false, onfinish: null as (() => void) | null, cancel() { a.cancelled = true; log.push("cancel"); } };
      anims.push(a);
      return a;
    },
  };
}
function setUp(start = 1) {
  const shown: number[] = [];
  const pos = new ShellPos(start, () => 400, (i) => shown.push(i));
  pos.last = 3;
  const track = fakeEl(), pill = fakeEl(100);
  pos.track = track as unknown as HTMLElement;
  pos.pill = pill as unknown as HTMLElement;
  return { pos, track, pill, shown };
}
const px = (t: string) => Number(/translate3d\((-?[\d.e-]+)px/.exec(t)![1]);

test("a settle plays the whole slide on the track and the indicator, in px, ending on the page", () => {
  const { pos, track, pill } = setUp();
  pos.settle(2, 0);
  const t = track.anims[0].frames, b = pill.anims[0].frames;
  assert.equal(px(t[0].transform), -400);
  assert.equal(px(t.at(-1)!.transform), -800);
  assert.equal(px(b[0].transform), 100);
  assert.equal(px(b.at(-1)!.transform), 200);
  assert.ok(t.length > 10, "more than a jump");
});

test("when the slide ends the page rests in the styles, flat, and the animations go", () => {
  const { pos, track, pill, shown } = setUp();
  pos.settle(2, 0);
  assert.equal(pos.resting, false);
  track.anims[0].onfinish!();
  assert.equal(pos.resting, true);
  assert.equal(pos.p, 2);
  assert.equal(track.style.transform, "translateX(-200%)");
  assert.deepEqual(shown, [2]);
  assert.ok(track.anims[0].cancelled && pill.anims[0].cancelled);
  // The style first: cancelling first would show the old place for a frame.
  assert.ok(track.log.lastIndexOf("cancel") > track.log.lastIndexOf("style translateX(-200%)"));
});

test("a finger landing mid-slide holds the pages where they are", () => {
  const { pos, track } = setUp();
  pos.settle(2, 0);
  track.anims[0].currentTime = 120;
  pos.grab();
  assert.ok(pos.p > 1.2 && pos.p < 2, `on the way: ${pos.p}`);
  const held = Number(/translate3d\((-?[\d.e-]+)%/.exec(track.style.transform)![1]);
  assert.ok(Math.abs(held + pos.p * 100) < 1e-6);
  assert.ok(track.anims[0].cancelled);
  assert.ok(track.log.indexOf("cancel") > track.log.findIndex((l) => l.startsWith("style translate3d(-1")), "styles take over before the animation goes");
  assert.equal(pos.resting, false);
});

test("a slide overtaken by another never lands where the first was going", () => {
  const { pos, track } = setUp();
  pos.settle(2, 0);
  const first = track.anims[0];
  first.currentTime = 50;
  pos.settle(0, 0);
  first.onfinish?.();
  assert.equal(pos.target, 0);
  assert.equal(pos.resting, false);
  assert.equal(Math.abs(px(track.anims[1].frames.at(-1)!.transform)), 0);
  assert.ok(pos.p > 1 && pos.p < 2);
  assert.ok(Math.abs(px(track.anims[1].frames[0].transform) + pos.p * 400) < 1e-6, "the next slide starts where the first had got to");
});

test("a page already in place just rests", () => {
  const { pos, track } = setUp();
  pos.settle(1, 0);
  assert.equal(track.anims.length, 0);
  assert.equal(pos.resting, true);
});

test("a tap jumps at once, and stops a slide under way", () => {
  const { pos, track, shown } = setUp();
  pos.settle(2, 0);
  pos.jump(3);
  assert.ok(track.anims[0].cancelled);
  assert.equal(pos.resting, true);
  assert.equal(track.style.transform, "translateX(-300%)");
  assert.deepEqual(shown, [3]);
});

test("the spring written out starts and ends in place, carries a flick's speed, and doesn't overshoot", () => {
  const still = springFrames(0, 400, 0);
  assert.equal(still.xs[0], 0);
  assert.equal(still.xs.at(-1), 400);
  assert.ok(still.ms > 200 && still.ms < 700, `${still.ms} ms`);
  assert.ok(still.xs.every((x, i) => i === 0 || x >= still.xs[i - 1]), "always forward");
  const flung = springFrames(0, 400, 2);
  assert.ok(flung.xs[3] > still.xs[3] * 1.4, "a flick leaves faster");
  assert.ok(Math.max(...still.xs) <= 400);
});

test("a stiffer spring finishes sooner (the settle is the spring's, not a set time)", () => {
  assert.ok(springFrames(0, 400, 0, { ...PAGE_SPRING, stiffness: 1500 }).ms < springFrames(0, 400, 0).ms);
});

test("the bar's chosen tab changes past 0.6 of a page, not at the start", () => {
  const { xs } = springFrames(400, 800, 0, PAGE_SPRING, 8);
  const at = shownChangesAt(xs, 400, 1, 2, 8)!;
  const i = at / 8;
  assert.ok(xs[i] / 400 - 1 > 0.6 && xs[i - 1] / 400 - 1 <= 0.6);
  assert.equal(shownChangesAt(xs, 400, 2, 2, 8), null);
});

test("a finger on a tab moves the indicator at once and leaves the pages for the lift", () => {
  const { pos, track, pill, shown } = setUp();
  const before = track.style.transform;
  pos.hint(3);
  assert.equal(pill.style.transform, "translateX(300%)");
  assert.equal(track.style.transform, before);
  assert.equal(pos.p, 1);
  assert.deepEqual(shown, []);
  pos.jump(3);
  assert.equal(pill.style.transform, "translateX(300%)");
  assert.equal(pos.unhint(), false, "landed: nothing to take back");
});

test("a press that turns into a slide puts the indicator back with the pages", () => {
  const { pos, pill } = setUp();
  pos.hint(3);
  assert.equal(pos.unhint(), true);
  assert.equal(pill.style.transform, "translateX(100%)");
  assert.equal(pos.unhint(), false);
});
