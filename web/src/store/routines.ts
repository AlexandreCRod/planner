// Which repeating tasks are routines, and whether streaks show: kept on this phone only (not synced,
// lost on a reinstall). Everything that reads or writes the routine marks goes through this module.
//
// After the switch-over from the original app, the mark can become a synced item field. The migration
// goes here, in one step: on first start with the field, set it on every item in listRoutines() (one
// saveItem each), then remove ROUTINES_KEY. Not built yet.
import { useSyncExternalStore } from "react";
import type { Item } from "../domain/types.ts";
import { changed } from "./store.ts";

const ROUTINES_KEY = "routines";
const STREAKS_KEY = "showStreaks";

function read(): Set<number> {
  try {
    const v = JSON.parse(localStorage.getItem(ROUTINES_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : []);
  } catch { return new Set(); }
}

/** Replaced (never changed in place) on every change, so it can be handed out as-is. */
let ids: ReadonlySet<number> = read();
let streaks = (() => { try { return localStorage.getItem(STREAKS_KEY) !== "false"; } catch { return true; } })();
const listeners = new Set<() => void>();

function commit(next: Set<number>) {
  ids = next;
  try { localStorage.setItem(ROUTINES_KEY, JSON.stringify([...next])); } catch { /* private mode: kept for this session */ }
  listeners.forEach((l) => l());
  // Every page redraws with the change (Today's lists are drawn from the store's snapshot).
  changed(true);
}

export const isRoutine = (id: number) => ids.has(id);
export const listRoutines = (): number[] => [...ids];
/** The marked ids (whether each still counts is domain/routines.ts's isRoutineItem). */
export const routineIds = (): ReadonlySet<number> => ids;

export function setRoutine(id: number, on: boolean) {
  if (!id || ids.has(id) === on) return;
  const next = new Set(ids);
  if (on) next.add(id); else next.delete(id);
  commit(next);
}

export function subscribeRoutines(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useRoutines(): ReadonlySet<number> {
  return useSyncExternalStore(subscribeRoutines, routineIds);
}

/**
 * Forgets the marks of items that no longer exist (deleted for good, here or on another device). One in
 * the trash keeps its mark, so Undo and Restore bring the routine back; meanwhile it's not shown.
 */
export function pruneRoutines(allItems: Item[]) {
  if (!ids.size || !allItems.length) return;
  const known = new Set(allItems.map((i) => i.id));
  const next = new Set([...ids].filter((id) => known.has(id)));
  if (next.size !== ids.size) commit(next);
}

/** Settings > "Show streaks": off hides them everywhere in this app. */
export const showStreaks = () => streaks;
export function setShowStreaks(v: boolean) {
  streaks = v;
  try { localStorage.setItem(STREAKS_KEY, String(v)); } catch { /* private mode */ }
  listeners.forEach((l) => l());
  changed(true);
}
