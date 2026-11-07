import assert from "node:assert/strict";
import { test } from "node:test";
import { launchHash } from "../src/alarms/launch.ts";

// 371: a notification opens straight on its item (or the Clock page's section), with nothing in between.
test("a notification's launch becomes the page it opens", () => {
  assert.equal(launchHash({ itemId: 42 }), "#/item/42");
  assert.equal(launchHash({ section: "timers" }), "#/alarms/timers");
  assert.equal(launchHash({}), null);
});

// 375: the app icon's long-press shortcuts.
test("each app shortcut opens its page: New task on Today, New note a new note, Stopwatch and Timer on the Clock page", () => {
  assert.equal(launchHash({ shortcut: "task" }), "#/today");
  assert.equal(launchHash({ shortcut: "note" }), "#/note/new");
  assert.equal(launchHash({ shortcut: "stopwatch" }), "#/alarms/stopwatch");
  assert.equal(launchHash({ shortcut: "timer" }), "#/alarms/timer");
  assert.equal(launchHash({ shortcut: "something else" }), null);
});
