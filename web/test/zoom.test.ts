import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_HOUR_HEIGHT, openingHourHeight, pinchHourHeight, zoomScrollTop } from "../src/ui/phone/zoom.ts";
import { noteLines } from "../src/domain/text.ts";
import { barTarget, pageTarget } from "../src/ui/phone/pager.ts";
import { OPENING_ROOM, openingScrollTop } from "../src/ui/phone/zoom.ts";
import { panelTarget, sheetCloses } from "../src/ui/phone/sheet.ts";

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

test("a slide along the bottom bar settles on the nearest page, a flick on the next one", () => {
  // Slow: the nearest page.
  assert.equal(barTarget(1, 1.4, 0.05, 4), 1);
  assert.equal(barTarget(1, 1.6, 0.05, 4), 2);
  // A quick flick goes on even after a short travel, either way.
  assert.equal(barTarget(1, 1.15, 0.8, 4), 2);
  assert.equal(barTarget(2, 1.9, -0.8, 4), 1);
  // A flick against the slide (the finger came back) doesn't turn the page.
  assert.equal(barTarget(2, 1.9, 0.8, 4), 2);
  // Never past the ends.
  assert.equal(barTarget(4, 4, 1, 4), 4);
  assert.equal(barTarget(0, 0, -1, 4), 0);
});

test("the add panel opens or closes after a short pull, and a flick decides", () => {
  // From small: 60 px up of a 600 px range opens it; 30 px doesn't; a flick up does at once.
  assert.equal(panelTarget("compact", 0.1, 0, 600, 0), "full");
  assert.equal(panelTarget("compact", 0.05, 0, 600, 0), "compact");
  assert.equal(panelTarget("compact", 0.02, 0, 600, -0.6), "full");
  // From full: a short pull down or a flick down makes it small again.
  assert.equal(panelTarget("full", 0.9, 0, 600, 0), "compact");
  assert.equal(panelTarget("full", 0.97, 0, 600, 0), "full");
  assert.equal(panelTarget("full", 0.98, 0, 600, 0.6), "close"); // flicked down: closes
  assert.equal(panelTarget("full", 0.5, 0, 600, 0.1), "compact"); // let go partway: the small panel
  // Pulled below its small place: closes past 48 px or on a flick down.
  assert.equal(panelTarget("compact", 0, 50, 600, 0), "close");
  assert.equal(panelTarget("compact", 0, 20, 600, 0.5), "close");
  assert.equal(panelTarget("compact", 0, 20, 600, 0), "compact");
  // Sheets close after 56 px (or a fifth of a short one), or a flick.
  assert.equal(sheetCloses(60, 500, 0), true);
  assert.equal(sheetCloses(40, 500, 0), false);
  assert.equal(sheetCloses(10, 500, 0.5), true);
  assert.equal(sheetCloses(45, 200, 0), true);
  // Short flicks complete everywhere.
  assert.equal(sheetCloses(8, 500, 0.3), true);
  assert.equal(panelTarget("compact", 0.01, 0, 600, -0.3), "full");
  assert.equal(panelTarget("compact", 0, 6, 600, 0.3), "close");
  assert.equal(pageTarget(-24, -0.3, 400), 1);
  assert.equal(pageTarget(24, 0.3, 400), -1);
  assert.equal(barTarget(1, 1.05, 0.3, 4), 2);
  // A slow drag let go still settles on the nearest.
  assert.equal(pageTarget(-24, -0.1, 400), 0);
});

test("the grid opens at 06:00 with room above for its label", () => {
  assert.equal(openingScrollTop(40), 240 - OPENING_ROOM);
  assert.ok(OPENING_ROOM >= 7); // the label reaches 7 px above its line
  assert.equal(openingScrollTop(1), 0);
});
