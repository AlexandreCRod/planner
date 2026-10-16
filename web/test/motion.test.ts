import assert from "node:assert/strict";
import { test } from "node:test";
import { VelocityTracker, bandClamp, coastTau, project, rubberBand, rubberBandInverse, snapIndex, springAt } from "../src/ui/phone/motion.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("a spring starts where it was let go, at the finger's speed", () => {
  for (const z of [0.6, 1, 1.4]) {
    const s = springAt(0, -120, 800, 600, z);
    near(s.x, -120);
    near(s.v, 800);
  }
});

test("a spring comes to rest on its target", () => {
  for (const z of [0.6, 1, 1.4]) {
    const s = springAt(2, -300, 2000, 600, z);
    assert.ok(Math.abs(s.x) < 0.01 && Math.abs(s.v) < 0.5, `ζ=${z}: ${s.x}, ${s.v}`);
  }
});

test("the spring's speed is the slope of its position", () => {
  for (const z of [0.6, 1, 1.4]) {
    const t = 0.05, h = 1e-6;
    const a = springAt(t - h, -200, 500, 600, z).x, b = springAt(t + h, -200, 500, 600, z).x;
    near(springAt(t, -200, 500, 600, z).v, (b - a) / (2 * h), 1e-2);
  }
});

test("critically damped never overshoots when let go without a push", () => {
  for (let t = 0; t < 1; t += 0.01) assert.ok(springAt(t, -100, 0, 600, 1).x <= 0);
});

test("the rubber band gives less the further it's pulled, never past its size", () => {
  assert.equal(rubberBand(0, 500), 0);
  const a = rubberBand(50, 500), b = rubberBand(100, 500), c = rubberBand(10000, 500);
  assert.ok(a > 0 && a < 50);
  assert.ok(b > a && b - a < a);
  assert.ok(c < 500);
  near(rubberBand(-50, 500), -a);
});

test("the rubber band's inverse gives back the pull", () => {
  for (const p of [5, 40, 300]) near(rubberBandInverse(rubberBand(p, 600), 600), p, 1e-6);
});

test("bandClamp passes values inside and bands the rest", () => {
  assert.equal(bandClamp(50, 0, 100, 400), 50);
  assert.ok(bandClamp(-40, 0, 100, 400) > -40 && bandClamp(-40, 0, 100, 400) < 0);
  assert.ok(bandClamp(140, 0, 100, 400) > 100 && bandClamp(140, 0, 100, 400) < 140);
});

test("the velocity tracker fits the recent samples", () => {
  const vt = new VelocityTracker();
  for (let t = 0; t <= 80; t += 8) vt.add(t, 2 * t + 5);
  near(vt.velocity(80), 2, 1e-9);
  // Old samples drop out: a change of speed shows within 100 ms.
  for (let t = 88; t <= 300; t += 8) vt.add(t, 165 + (t - 80) * -1);
  near(vt.velocity(300), -1, 1e-9);
  // A finger held still for a moment has no speed left.
  assert.equal(vt.velocity(400), 0);
});

test("a fling's coast and the wheel's landing row", () => {
  near(project(1, 0.998), 499, 1e-9);
  assert.equal(snapIndex(100, 0, 40, 0, 23), 3); // 2.5 rows rounds to 3
  assert.equal(snapIndex(100, -0.001, 40, 0, 23), 2);
  assert.equal(snapIndex(100, 5, 40, 0, 23), 23); // flung hard: the last row
  assert.equal(snapIndex(100, -5, 40, 0, 23), 0);
});

test("a wheel's coast starts at the finger's speed and lands on its row", () => {
  const tau = coastTau(300, 1.5)!;
  near(300 / tau, 1.5); // starting speed dist/τ is the finger's
  assert.equal(coastTau(300, -1), null); // flung back the other way: a spring takes it
  assert.equal(coastTau(300, 0.01), null); // too slow to coast
  assert.equal(coastTau(10000, 1), 900); // never a very long coast
});
