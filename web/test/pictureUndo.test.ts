import assert from "node:assert/strict";
import { test } from "node:test";
import { newItem } from "../src/domain/types.ts";

// The store saves to localStorage and schedules a redraw; small stand-ins are enough here.
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");

test("review of 2.9.5: a note emptied by removing its picture and swept on leaving comes back with Undo", () => {
  const note = store.saveItem(newItem({ type: "NOTE", title: "" }), { tags: ["trip"] });
  const other = store.saveItem(newItem({ type: "NOTE", title: "Linked" }));
  store.addLink(note, other);
  store.saveVersion(store.snapshot().byId.get(note)!);
  store.addImage(note, { hash: "only", mime: "image/jpeg", width: 10, height: 10 });
  const img = store.snapshot().images.get(note)![0];
  const undo = store.removeImage(img);
  store.deleteIfEmpty(note); // what leaving the note does
  assert.equal(store.snapshot().byId.get(note), undefined);
  undo();
  const s = store.snapshot();
  assert.equal(s.byId.get(note)?.type, "NOTE", "the note is reachable again");
  assert.deepEqual(s.images.get(note), [img]);
  assert.deepEqual(s.tagsByItem.get(note)?.map((t) => t.name), ["trip"]);
  assert.equal(s.versions.get(note)?.length, 1);
  assert.ok(s.neighbours(note).has(other));
});

test("review of 2.9.5: Undo of a removed picture leaves a note that stayed as it is", () => {
  const note = store.saveItem(newItem({ type: "NOTE", title: "Kept" }));
  store.addImage(note, { hash: "kept", mime: "image/jpeg", width: 10, height: 10 });
  const undo = store.removeImage(store.snapshot().images.get(note)![0]);
  const edited = store.saveItem({ ...store.snapshot().byId.get(note)!, title: "Edited after" });
  undo();
  assert.equal(store.snapshot().byId.get(edited)!.title, "Edited after");
  assert.equal(store.snapshot().images.get(note)!.length, 1);
});
