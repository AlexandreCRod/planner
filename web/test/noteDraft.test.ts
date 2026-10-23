import assert from "node:assert/strict";
import { test } from "node:test";
import { afterSave, baselineOf, draftOf, editorText, localChanges, noteToSave, rebase } from "../src/domain/noteDraft.ts";
import { type Item, newItem } from "../src/domain/types.ts";

// Item 132: edits made on the PC didn't stay. Two ways a note's edit was lost:
// - leaving a note saved the text as it was opened (the editor's handle is already gone then), and
// - an open note saved its stale text over an edit that came from another device meanwhile.

const opened = newItem({ type: "NOTE", id: 7, title: "Shopping", content: "<p>milk</p>", updatedAt: 1 });
const editorNow = (item: Item, content: string | null, over: Partial<ReturnType<typeof draftOf>> = {}) => ({ ...draftOf(item, ""), ...over, content });

test("leaving without the editor's handle reads the text from its element, never the opened text", () => {
  assert.equal(editorText(undefined, () => "<p>milk and eggs</p>"), "<p>milk and eggs</p>");
  assert.equal(editorText(() => "<p>from the handle</p>", () => "<p>element</p>"), "<p>from the handle</p>");
  // Nothing readable: unknown, which saves nothing (not the opened text over the note).
  assert.equal(editorText(undefined, undefined), null);
  const base = baselineOf(opened, "");
  assert.deepEqual(localChanges(base, editorNow(opened, null)), {});
});

test("an edit made here is saved when leaving", () => {
  const base = baselineOf(opened, "");
  const changes = localChanges(base, editorNow(opened, "<p>milk and eggs</p>"));
  assert.deepEqual(changes, { content: "<p>milk and eggs</p>" });
  const plan = noteToSave(opened, opened, changes);
  assert.equal(plan?.item.content, "<p>milk and eggs</p>");
  assert.equal(plan?.tags, undefined);
});

test("an untouched open note doesn't overwrite an edit that came from another device", () => {
  const base = baselineOf(opened, "");
  const fromPhone = { ...opened, content: "<p>milk, bread</p>", updatedAt: 2 };
  // The editor still shows the opened text: nothing changed here, nothing is saved.
  const changes = localChanges(base, editorNow(opened, "<p>milk</p>"));
  assert.equal(noteToSave(fromPhone, opened, changes), null);
  // And the editor takes the new text.
  const r = rebase(base, editorNow(opened, "<p>milk</p>"), draftOf(fromPhone, ""));
  assert.deepEqual(r.load, { content: "<p>milk, bread</p>" });
  assert.deepEqual(localChanges(r.baseline, editorNow(opened, "<p>milk, bread</p>")), {});
});

test("the editor's tidied reading of the text isn't taken for an edit", () => {
  const stored = { ...opened, content: "<div>milk</div>" };
  const base = baselineOf(stored, "", "<p>milk</p>");
  assert.deepEqual(localChanges(base, editorNow(stored, "<p>milk</p>")), {});
});

test("a change here goes onto the note as stored now: other fields edited elsewhere stay", () => {
  const base = baselineOf(opened, "");
  const fromPhone = { ...opened, title: "Groceries", pinned: true, updatedAt: 2 };
  const changes = localChanges(base, editorNow(opened, "<p>milk and eggs</p>"));
  const plan = noteToSave(fromPhone, opened, changes)!;
  assert.equal(plan.item.title, "Groceries");
  assert.equal(plan.item.pinned, true);
  assert.equal(plan.item.content, "<p>milk and eggs</p>");
});

test("a remote edit to a field changed here keeps the user's version; the others are shown", () => {
  const base = baselineOf(opened, "");
  const here = editorNow(opened, "<p>milk and eggs</p>");
  const fromPhone = draftOf({ ...opened, title: "Groceries", content: "<p>milk, bread</p>" }, "");
  const r = rebase(base, here, fromPhone);
  assert.deepEqual(r.load, { title: "Groceries" });
  // The user's text is still theirs to save, and the title they now see isn't written back as a change.
  assert.deepEqual(localChanges(r.baseline, { ...here, title: "Groceries" }), { content: "<p>milk and eggs</p>" });
});

test("after a save, the same text isn't saved again", () => {
  const base = baselineOf(opened, "home");
  const here = editorNow(opened, "<p>x</p>", { title: " New title ", tags: "#home #shop" });
  const changes = localChanges(base, here);
  assert.deepEqual(changes, { title: "New title", content: "<p>x</p>", tags: "home shop" });
  assert.deepEqual(noteToSave(opened, opened, changes)?.tags, ["home", "shop"]);
  assert.deepEqual(localChanges(afterSave(base, changes), here), {});
});

test("tags in another order or case are the same tags", () => {
  const base = baselineOf(opened, "Home shop");
  assert.deepEqual(localChanges(base, editorNow(opened, null, { tags: "shop #home" })), {});
});

test("a new note is saved whole once something is typed", () => {
  const fresh = newItem({ type: "NOTE" });
  const base = baselineOf(fresh, "");
  assert.equal(noteToSave(null, fresh, localChanges(base, editorNow(fresh, ""))), null);
  const plan = noteToSave(null, fresh, localChanges(base, editorNow(fresh, "<p>hi</p>")))!;
  assert.equal(plan.item.id, 0);
  assert.equal(plan.item.content, "<p>hi</p>");
});

// Item 81: notes no longer have a place. An older note's stored place is kept as it is when it's edited.
test("an edited note keeps a place stored on it, and the editor never writes one", () => {
  const older = newItem({ type: "NOTE", id: 9, title: "Trip", content: "<p>a</p>", location: "Lisbon", lat: 38.7, lng: -9.1 });
  const base = baselineOf(older, "");
  assert.equal("location" in base.stored, false);
  const changes = localChanges(base, editorNow(older, "<p>b</p>"));
  assert.deepEqual(changes, { content: "<p>b</p>" });
  const plan = noteToSave(older, older, changes)!;
  assert.equal(plan.item.location, "Lisbon");
  assert.equal(plan.item.lat, 38.7);
  assert.equal(plan.item.content, "<p>b</p>");
});
