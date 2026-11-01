import assert from "node:assert/strict";
import { test } from "node:test";
import { saveHeld } from "../src/domain/noteDraft.ts";
import { newItem } from "../src/domain/types.ts";

// The store saves to localStorage and schedules a redraw; small stand-ins are enough here.
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");

test("review of 2.9.5: a note's own trash mark holds its saves only while it's in the trash or gone", () => {
  const note = store.saveItem(newItem({ type: "NOTE", title: "N" }));
  const stored = () => store.allRecords().get(`items/${note}`) as { deletedAt: number | null } | undefined;
  assert.equal(saveHeld(false, stored()), false);
  store.trash(note);
  assert.equal(saveHeld(true, stored()), true);
  assert.equal(saveHeld(false, stored()), false, "trashed on another device: typing here still saves");
  store.restore(note); // Undo
  assert.equal(saveHeld(true, stored()), false);
  store.deleteForever(note);
  assert.equal(saveHeld(true, stored()), true);
});
