import assert from "node:assert/strict";
import { test } from "node:test";
import { launchHash } from "../src/alarms/launch.ts";

// 371: a notification opens straight on its item (or the Clock page's section), with nothing in between.
test("a notification's launch becomes the page it opens", () => {
  assert.equal(launchHash({ itemId: 42 }), "#/item/42");
  assert.equal(launchHash({ section: "timers" }), "#/alarms/timers");
  assert.equal(launchHash({}), null);
});
