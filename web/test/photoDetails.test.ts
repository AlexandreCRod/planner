import assert from "node:assert/strict";
import { test } from "node:test";
import { newItem } from "../src/domain/types.ts";

// Review of 2.10.4, finding 8: a photo's details (where it was taken, among them) stayed on the device after the
// photo was removed. They're kept per file (its hash), so they go when no picture uses that file any more.
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");
const kept = new Map<string, unknown>();
store.photoDetails.take = async (h) => { const v = kept.get(h); kept.delete(h); return v; };
store.photoDetails.put = async (h, v) => { kept.set(h, v); };
const settle = () => new Promise((r) => setTimeout(r, 10));
const where = { taken: "2026:11:03 14:05:12", lat: 38.7, lng: -9.1 };

const noteWith = (hash: string) => {
  const note = store.saveItem(newItem({ type: "NOTE", title: "Trip" }));
  store.addImage(note, { hash, mime: "image/jpeg", width: 10, height: 10 });
  kept.set(hash, where);
  return { note, img: store.snapshot().images.get(note)![0] };
};

test("removing a photo from its note drops its details; Undo brings them back", async () => {
  const { img } = noteWith("a1");
  const undo = store.removeImage(img);
  await settle();
  assert.equal(kept.has("a1"), false);
  undo();
  await settle();
  assert.deepEqual(kept.get("a1"), where);
});

test("deleting the note for good drops its photos' details", async () => {
  const { note } = noteWith("b1");
  store.trash(note);
  await settle();
  assert.equal(kept.has("b1"), true, "in the trash it can still come back");
  store.deleteForever(note);
  await settle();
  assert.equal(kept.has("b1"), false);
});

test("the same photo still in another note keeps its details", async () => {
  const { img } = noteWith("c1");
  const other = store.saveItem(newItem({ type: "NOTE", title: "Copy" }));
  store.addImage(other, { hash: "c1", mime: "image/jpeg", width: 10, height: 10 });
  store.removeImage(img);
  await settle();
  assert.deepEqual(kept.get("c1"), where);
});

test("a photo removed on another device drops its details here too", async () => {
  const { img } = noteWith("d1");
  store.applyRemote([{ kind: "images", id: String(img.id), data: null }]);
  await settle();
  assert.equal(kept.has("d1"), false);
});
