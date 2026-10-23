// The alarm settings of this phone (native AppSettings' "Reminders & alarms" part). Like the native app's
// settings they stay on the device: kept in localStorage and handed to the alarm engine with its data.
import { useSyncExternalStore } from "react";
import type { AlarmSettings } from "../domain/alarms.ts";

export type { AlarmSettings };

export const SNOOZE_CHOICES = [5, 10, 15, 30, 60];
/** How long alarms ring before they stop by themselves: events and tasks, and clock alarms and timers. */
export const ALARM_RING_CHOICES = [1, 2, 3, 5, 10];
export const CLOCK_RING_CHOICES = [1, 5, 10, 15, 20, 30];
const DEFAULTS: AlarmSettings = {
  defaultTaskTime: 9 * 60, defaultAlarmSound: null, defaultAlarmSoundName: null, snoozeMinutes: 10,
  upcomingAlarms: true, quietHoursEnabled: false, quietStart: 22 * 60, quietEnd: 7 * 60,
  alarmRingMinutes: 1, clockRingMinutes: 10,
};
const KEY = "alarmSettings";

let cache: AlarmSettings | null = null;
const listeners = new Set<() => void>();

export function alarmSettings(): AlarmSettings {
  if (cache) return cache;
  let saved: Partial<AlarmSettings> = {};
  try { saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}") as Partial<AlarmSettings>; } catch { /* none */ }
  cache = { ...DEFAULTS, ...saved };
  return cache;
}

export function setAlarmSettings(patch: Partial<AlarmSettings>) {
  cache = { ...alarmSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}

export function onAlarmSettings(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function useAlarmSettings(): AlarmSettings {
  return useSyncExternalStore((l) => onAlarmSettings(l), alarmSettings);
}
