import assert from "node:assert/strict";
import { test } from "node:test";
import { newItem } from "../src/domain/types.ts";

// The store saves to localStorage and schedules a redraw; small stand-ins are enough here.
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");

test("review of 2.9.5: category Undo sets only the category back, keeping an edit made meanwhile", () => {
  const cat = { id: 8, name: "Home", color: 1, defaultAlert: "REMINDER" as const };
  store.saveCategory(cat);
  const edited = store.saveItem(newItem({ type: "TASK", title: "Before", categoryId: 8 }));
  const moved = store.saveItem(newItem({ type: "TASK", title: "Moved", categoryId: 8 }));
  const untouched = store.saveItem(newItem({ type: "TASK", title: "Elsewhere", categoryId: null }));
  const undo = store.deleteCategory(cat);
  // An edit that came in from the PC during the Undo, and one moved to no... another category here.
  const now = store.snapshot().byId.get(edited)!;
  store.applyRemote([{ kind: "items", id: String(edited), data: { ...now, title: "Edited on the PC", updatedAt: now.updatedAt + 1 } as never }]);
  store.saveCategory({ id: 9, name: "Other", color: 2, defaultAlert: "REMINDER" });
  store.saveItem({ ...store.snapshot().byId.get(moved)!, categoryId: 9 });
  undo();
  const s = store.snapshot();
  assert.equal(s.byId.get(edited)!.title, "Edited on the PC");
  assert.equal(s.byId.get(edited)!.categoryId, 8);
  assert.equal(s.byId.get(moved)!.categoryId, 9, "put in another category meanwhile: stays there");
  assert.equal(s.byId.get(untouched)!.categoryId, null);
  assert.ok(s.categoryById.has(8));
});
