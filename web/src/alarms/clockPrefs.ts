// The Clock page's own settings (2.9): the alarm filter it opens with (71) and the bundle window (110).
// Like the clock alarms themselves they belong to this phone: kept in localStorage, beside alarmSettings.
import { useSyncExternalStore } from "react";
import { BUNDLE_WINDOW_MIN, type ClockFilter } from "../domain/clockList.ts";

export interface ClockPrefs {
  /** The filter the alarm list opens with; null shows every alarm. */
  defaultFilter: ClockFilter | null;
  /** Alarms with the same days this many minutes or less after the one before share a bundle (110); 0: none. */
  bundleWindow: number;
}
/** The bundle window's choices in Settings, in minutes (0: no bundles). */
export const BUNDLE_WINDOW_CHOICES = [0, 5, 10, 15, 19, 25, 30, 45, 60];
const DEFAULTS: ClockPrefs = { defaultFilter: null, bundleWindow: BUNDLE_WINDOW_MIN };
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
