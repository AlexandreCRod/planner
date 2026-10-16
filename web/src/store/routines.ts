// Routines: which repeating tasks are routines is the synced item field `routine` (domain/routines.ts
// has the rules). Before it synced, the phone kept the marks on itself (localStorage "routines");
// migrateLocalRoutines() moves them into the field once. Whether streaks show stays a setting of each
// device.
import type { Item } from "../domain/types.ts";
import { itemsToMarkAsRoutines } from "../domain/routines.ts";
import { changed, saveItem, snapshot } from "./store.ts";

/** The old device-only marks: a JSON list of item ids. */
const LEGACY_KEY = "routines";
const STREAKS_KEY = "showStreaks";

let streaks = (() => { try { return localStorage.getItem(STREAKS_KEY) !== "false"; } catch { return true; } })();

/** Marks [item] as a routine or not; saved with the item, so it syncs. */
export function setRoutine(item: Item, on: boolean) {
  if (!item.id || (item.routine === true) === on) return;
  saveItem({ ...item, routine: on });
}

/**
 * Moves the old device-only marks into the synced field, then forgets them. Waits until the local copy
 * has items (it may still be empty before the first sync); once it has, marks of items it doesn't
 * know were for items deleted for good and are dropped. Running it again does nothing.
 * Returns how many items it marked.
 */
export function migrateLocalRoutines(allItems: Item[] = snapshot().allItems): number {
  let raw: string | null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch { return 0; }
  if (raw === null || !allItems.length) return 0;
  let ids: number[] = [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) ids = v.filter((x): x is number => typeof x === "number");
  } catch { /* unreadable: nothing to move */ }
  const marked = itemsToMarkAsRoutines(allItems, ids);
  for (const item of marked) saveItem(item);
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* kept: the next run marks nothing again */ }
  return marked.length;
}

/** Settings > "Show streaks": off hides them everywhere in this app. */
export const showStreaks = () => streaks;
export function setShowStreaks(v: boolean) {
  streaks = v;
  try { localStorage.setItem(STREAKS_KEY, String(v)); } catch { /* private mode */ }
  changed(true);
}
