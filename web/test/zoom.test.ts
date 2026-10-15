import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_HOUR_HEIGHT, openingHourHeight, pinchHourHeight, zoomScrollTop } from "../src/ui/phone/zoom.ts";
import { noteLines } from "../src/domain/text.ts";
import { pageTarget } from "../src/ui/phone/pager.ts";

test("pinch scales the hour height with the fingers' spread", () => {
  assert.equal(pinchHourHeight(50, 100, 200, 20), 100);
  assert.equal(pinchHourHeight(50, 200, 100, 20), 25);
});

test("pinch stops at the whole day and at 160 dp", () => {
  assert.equal(pinchHourHeight(50, 100, 1000, 20), MAX_HOUR_HEIGHT);
  assert.equal(pinchHourHeight(50, 100, 10, 30), 30);
});

test("the spot between the fingers stays in place", () => {
  // 10:00 under the fingers at 300 px down, with 50 px hours and the view scrolled to 200 px.
  const top = zoomScrollTop(200, 300, 50, 100);
  // Content at that spot: (200 + 300) / 50 = 10 hours before; after: (top + 300) / 100 must be 10 hours too.
  assert.equal((top + 300) / 100, (200 + 300) / 50);
  assert.equal(zoomScrollTop(0, 10, 100, 50), 0); // never above the top
});

test("opening zoom fits 06:00 to 24:00, or keeps the chosen one within limits", () => {
  assert.equal(openingHourHeight(720, null), 40);
  assert.equal(openingHourHeight(720, 90), 90);
  assert.equal(openingHourHeight(720, 5), 30);
  assert.equal(openingHourHeight(720, 900), MAX_HOUR_HEIGHT);
});

test("pager settles like Compose's: nearest page, or the way it was flung", () => {
  assert.equal(pageTarget(-250, 0, 400), 1);
  assert.equal(pageTarget(-150, 0, 400), 0);
  assert.equal(pageTarget(-60, -0.8, 400), 1);
  assert.equal(pageTarget(60, 0.8, 400), -1);
  assert.equal(pageTarget(-250, 0.8, 400), 0); // dragged far but flung back
});

// Same cases as NoteText.lines on the phone.
test("note lines keep bullets, numbers and checkboxes", () => {
  const l = noteLines("<p>Plan</p><ul><li>milk</li><li>eggs<ul><li>brown</li></ul></li></ul><ol><li>one</li><li>two</li></ol><p>☑ done</p><p></p>");
  assert.deepEqual(l.map((x) => [x.kind, x.text, x.level, x.number]), [
    ["TEXT", "Plan", 0, 0], ["BULLET", "milk", 0, 1], ["BULLET", "eggs", 0, 2], ["BULLET", "brown", 1, 1],
    ["NUMBER", "one", 0, 1], ["NUMBER", "two", 0, 2], ["CHECK", "done", 0, 0],
  ]);
  assert.equal(l[6].checked, true);
});
