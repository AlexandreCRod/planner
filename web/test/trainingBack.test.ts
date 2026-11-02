import { test } from "node:test";
import assert from "node:assert/strict";
import { trainingBase, trainingSub } from "../src/ui/phone/trainingBack.ts";

const q = (s: string) => new URLSearchParams(s);

test("a session, a view or the week at a day is a sub view of Training; the overview is not", () => {
  assert.equal(trainingSub(q("s=gym-1")), true);
  assert.equal(trainingSub(q("view=docs&doc=a.md")), true);
  assert.equal(trainingSub(q("view=progress")), true);
  assert.equal(trainingSub(q("view=week")), true);      // the plan is one tap deeper than the overview (301): back closes it
  assert.equal(trainingSub(q("d=20380")), true);        // the week at a day is a layer over the overview: back and Esc close it
  assert.equal(trainingSub(q("p=hm")), false);
  assert.equal(trainingSub(q("")), false);
});

test("a session opened from Today gets the Training week under it, on the same day and plan", () => {
  assert.equal(trainingBase("today", "training", q("s=gym-1&d=20380")), "#/training?d=20380");
  assert.equal(trainingBase("calendar", "training", q("s=run-2&p=hm")), "#/training?p=hm");
  assert.equal(trainingBase("item", "training", q("view=progress&tab=runs")), "#/training");
  assert.equal(trainingBase("", "training", q("s=gym-1")), "#/training");
  assert.equal(trainingBase("", "training", q("view=week")), "#/training");
});

test("from within Training, or to the week itself, nothing is added", () => {
  assert.equal(trainingBase("training", "training", q("s=gym-1")), null);
  assert.equal(trainingBase("training", "training", q("view=docs")), null);
  assert.equal(trainingBase("today", "training", q("d=20380")), null);   // Today's line: back returns to Today
  assert.equal(trainingBase("calendar", "training", q("d=20380&p=hm")), null);
  assert.equal(trainingBase("today", "calendar", q("s=x")), null);
});

test("the week at a day opened cold has the overview under it, or back would have nowhere to go", () => {
  assert.equal(trainingBase("", "training", q("d=20380")), "#/training");
  assert.equal(trainingBase("", "training", q("d=20380&p=hm")), "#/training?p=hm");
});
