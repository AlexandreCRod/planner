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
const STYLE_KEY = "streakStyle";

/** How streak badges show (Settings > Streak badges): not at all (the default), as a count, or as a count with the flame. */
export type StreakStyle = "off" | "streak" | "symbol";
export const STREAK_STYLES: [StreakStyle, string][] = [["off", "Off"], ["streak", "Streak"], ["symbol", "Streak and symbol"]];

/** Set once streaks have been switched off for this device (2.4): from then on the choice made sticks. */
const OFF_ONCE_KEY = "streaksOffOnce";

// Off unless chosen (2.4). Installs from before then had them showing; they're switched off once, and a
// later choice in Settings is kept.
let style: StreakStyle = (() => {
  try {
    if (localStorage.getItem(OFF_ONCE_KEY) === null) {
      localStorage.setItem(STYLE_KEY, "off");
      localStorage.setItem(STREAKS_KEY, "false");
      localStorage.setItem(OFF_ONCE_KEY, "1");
      return "off";
    }
    const v = localStorage.getItem(STYLE_KEY);
    return v === "streak" || v === "symbol" ? v : "off";
  } catch { return "off"; }
})();

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

/** Settings > Streak badges: Off hides them on the lists and Today (the Streaks sheet and each routine's own page still show them). */
export const showStreaks = () => style !== "off";
/** Whether a streak shows the flame by its count. */
export const streakSymbol = () => style === "symbol";
export const streakStyle = () => style;
export function setStreakStyle(v: StreakStyle) {
  style = v;
  try { localStorage.setItem(STYLE_KEY, v); localStorage.setItem(STREAKS_KEY, String(v !== "off")); localStorage.setItem(OFF_ONCE_KEY, "1"); } catch { /* private mode */ }
  changed(true);
}
/** The PC's on/off box: on keeps the flame. */
export const setShowStreaks = (v: boolean) => setStreakStyle(v ? "symbol" : "off");
