// The Clock page's own settings (2.9): the alarm filter it opens with (71).
// Like the clock alarms themselves they belong to this phone: kept in localStorage, beside alarmSettings.
import { useSyncExternalStore } from "react";
import type { ClockFilter } from "../domain/clockList.ts";

export interface ClockPrefs {
  /** The filter the alarm list opens with; null shows every alarm. */
  defaultFilter: ClockFilter | null;
}
const DEFAULTS: ClockPrefs = { defaultFilter: null };
const KEY = "clockPrefs";

let cache: ClockPrefs | null = null;
const listeners = new Set<() => void>();

export function clockPrefs(): ClockPrefs {
  if (cache) return cache;
  let saved: Partial<ClockPrefs> = {};
  try { saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}") as Partial<ClockPrefs>; } catch { /* none */ }
  cache = { ...DEFAULTS, ...saved };
  return cache;
}

export function setClockPrefs(patch: Partial<ClockPrefs>) {
  cache = { ...clockPrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}

export function useClockPrefs(): ClockPrefs {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, clockPrefs);
}
