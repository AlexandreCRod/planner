import assert from "node:assert/strict";
import { test } from "node:test";
import { DONE_TODO_HOURS, TRASH_DAYS, doneTodosToTrash, expiredTrash } from "../src/domain/retention.ts";
import { type ItemType, NO_DAY, newItem } from "../src/domain/types.ts";

const H = 3_600_000;
const D = 24 * H;
const now = 1_800_000_000_000;

test("everything leaves the trash after 30 days", () => {
  const trashed = (id: number, type: ItemType, daysAgo: number) => newItem({ id, type, deletedAt: now - Math.round(daysAgo * D) });
  const items = [
    trashed(1, "TASK", 29.9), trashed(2, "TASK", 30), trashed(3, "EVENT", 7), trashed(4, "EVENT", 31),
    trashed(5, "NOTE", 14), trashed(6, "NOTE", 30), newItem({ id: 7, type: "TASK" }),
  ];
  assert.deepEqual(expiredTrash(items, now), [2, 4, 6]);
  assert.equal(TRASH_DAYS, 30);
});

test("a ticked to-do moves to the trash 48 hours after it was ticked", () => {
  const todo = (id: number, extra = {}) => newItem({ id, type: "TASK", title: "t", ...extra });
  const items = [
    todo(1),                                   // ticked 47 h ago: stays
    todo(2),                                   // ticked 48 h ago: goes
    todo(3),                                   // ticked 10 days ago: goes, trashed as of 8 days ago
    todo(4),                                   // not ticked
    todo(5, { startDay: 20000 }),              // dated task: its own rules
    todo(6, { deletedAt: now - D }),           // already in the trash
    newItem({ id: 7, type: "EVENT" }),
  ];
  const completions = [
    { itemId: 1, day: NO_DAY, completedAt: now - 47 * H },
    { itemId: 2, day: NO_DAY, completedAt: now - 48 * H },
    { itemId: 3, day: NO_DAY, completedAt: now - 10 * D },
    { itemId: 5, day: 20000, completedAt: now - 10 * D },
    { itemId: 6, day: NO_DAY, completedAt: now - 10 * D },
    { itemId: 7, day: NO_DAY, completedAt: now - 10 * D },
  ];
  assert.deepEqual(doneTodosToTrash(items, completions, now), [
    { id: 2, deletedAt: now },
    { id: 3, deletedAt: now - 10 * D + DONE_TODO_HOURS * H },
  ]);
});

test("a to-do ticked long ago goes through the trash and is then deleted for good", () => {
  const items = [newItem({ id: 1, type: "TASK" })];
  const [moved] = doneTodosToTrash(items, [{ itemId: 1, day: NO_DAY, completedAt: now - 33 * D }], now);
  assert.deepEqual(expiredTrash([{ ...items[0], deletedAt: moved.deletedAt }], now), [1]);
  const [recent] = doneTodosToTrash(items, [{ itemId: 1, day: NO_DAY, completedAt: now - 3 * D }], now);
  assert.deepEqual(expiredTrash([{ ...items[0], deletedAt: recent.deletedAt }], now), []);
});
