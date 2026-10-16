import assert from "node:assert/strict";
import { test } from "node:test";
import { type Item, newItem } from "../src/domain/types.ts";

// The old marks lived in localStorage on the phone; a small stand-in is enough here.
const kept = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => { kept.set(k, v); },
  removeItem: (k: string) => { kept.delete(k); },
};
// The store's redraw also schedules a save; not needed here.
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const routines = await import("../src/store/routines.ts");
const store = await import("../src/store/store.ts");

const task = (id: number, extra: Partial<Item> = {}) => newItem({ id, type: "TASK", title: `T${id}`, startDay: 20000, freq: "DAILY", ...extra });

test("the old device-only marks move into the synced field once, then are forgotten", () => {
  kept.set("routines", JSON.stringify([1, 2, 9]));
  // Nothing loaded yet (before the first sync): the marks wait.
  assert.equal(routines.migrateLocalRoutines([]), 0);
  assert.ok(kept.has("routines"));

  store.applyRemote([task(1), task(2, { deletedAt: 1 }), task(3)].map((data) => ({ kind: "items" as const, id: String(data.id), data: data as unknown as Record<string, unknown> })));
  assert.equal(routines.migrateLocalRoutines(), 2);
  const byId = new Map(store.snapshot().allItems.map((i) => [i.id, i]));
  assert.equal(byId.get(1)!.routine, true);
  assert.equal(byId.get(2)!.routine, true); // in the trash: keeps it, so Restore brings the routine back
  assert.equal(byId.get(3)!.routine, undefined);
  assert.equal(kept.has("routines"), false); // 9 was deleted for good: dropped with the rest

  // Again: nothing left to move.
  assert.equal(routines.migrateLocalRoutines(), 0);

  // The switch is saved with the item.
  routines.setRoutine(byId.get(1)!, false);
  assert.equal(store.snapshot().allItems.find((i) => i.id === 1)!.routine, false);
});
