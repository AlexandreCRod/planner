// The page's side of the alarm engine (web/android/.../alarm/AlarmPlugin.kt). Only the phone build has
// it: in a browser (the PC app) every call is a no-op and the state stays empty, so nothing changes there.
import { registerPlugin } from "@capacitor/core";
import { useSyncExternalStore } from "react";
import { isNative } from "../platform.ts";

/** A plain alarm clock (ClockAlarms.kt). days: bit 0 = Monday ... bit 6 = Sunday; 0 rings once. */
export interface ClockAlarm {
  id: number; hour: number; minute: number; label: string; days: number; enabled: boolean; color: number; sound: string | null;
  /** Chosen dates (local epoch days) instead of weekdays; days skipped; paused until (first day back): domain/alarms.ts. */
  dates?: number[]; skip?: number[]; pausedUntil?: number | null;
}
/** A countdown (ClockTools.kt): running, it keeps when it ends; paused, what's left. */
export interface ClockTimer { id: number; durationMs: number; label: string; endAt: number | null; remainingMs: number }
export interface Stopwatch { startedAt: number | null; accumulatedMs: number; laps: number[] }
export interface ClockToolsState { timers: ClockTimer[]; stopwatch: Stopwatch; zones: string[] }
export interface RingState { rings: boolean; explicit: boolean | null; originalInstalled: boolean }
export interface Perms { notifications: boolean; fullScreen: boolean; exact: boolean; batteryExempt: boolean }
export interface AlarmState { alarms: ClockAlarm[]; tools: ClockToolsState; ring: RingState; perms: Perms; zone: string; weatherApp: string | null }
/** One line of an item's early alarm controls (native EarlyAlarmControls). */
export interface Control { kind: "soon" | "skipped" | "rang"; reminderId: number; at: number; original: number; canSnooze: boolean }

interface Plugin {
  sync(o: { json: string }): Promise<void>;
  takeDone(): Promise<{ json: string }>;
  takeLaunch(): Promise<{ itemId?: number; section?: string }>;
  widgets(o: { json: string }): Promise<void>;
  forecast(o: { json: string }): Promise<void>;
  takeWidgetUndone(): Promise<{ json: string }>;
  state(): Promise<{ json: string }>;
  controls(o: { itemId: number }): Promise<{ json: string }>;
  earlySnooze(o: { reminderId: number; original: number }): Promise<void>;
  earlyStop(o: { reminderId: number; original: number }): Promise<void>;
  resetAlarm(o: { reminderId: number; original: number | null }): Promise<void>;
  saveClock(o: { json: string }): Promise<{ id: number }>;
  deleteClock(o: { id: number }): Promise<void>;
  timer(o: { action: string; id?: number; durationMs?: number; label?: string }): Promise<void>;
  stopwatch(o: { action: string }): Promise<void>;
  zone(o: { action: "add" | "remove"; zone: string }): Promise<void>;
  setRingEvents(o: { value: boolean | null }): Promise<void>;
  pickSound(o: { current: string | null; title?: string }): Promise<{ picked: boolean; uri?: string | null; name?: string | null }>;
  soundName(o: { uri: string }): Promise<{ name?: string | null }>;
  pickWeatherApp(): Promise<{ picked: boolean; label?: string }>;
  clearWeatherApp(): Promise<void>;
  openWeather(o: { url: string }): Promise<{ opened: string }>;
  requestNotifications(): Promise<{ granted: boolean }>;
  openSettings(o: { which: "notifications" | "fullScreen" | "battery" | "exact" }): Promise<void>;
  addListener(event: "changed" | "launch", fn: (e: { what?: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

/** Whether alarms can ring here: the phone build only. */
export const hasAlarms = isNative;
const plugin = isNative ? registerPlugin<Plugin>("Alarms") : null;

/** Runs a plugin call; on the PC, or if it fails, gives [fallback]. */
async function call<T>(fn: (p: Plugin) => Promise<T>, fallback: T): Promise<T> {
  if (!plugin) return fallback;
  try { return await fn(plugin); } catch (e) { console.warn("alarms:", e); return fallback; }
}

export const native = {
  sync: (payload: unknown) => call((p) => p.sync({ json: JSON.stringify(payload) }), undefined),
  takeDone: async () => JSON.parse((await call((p) => p.takeDone(), { json: "[]" })).json) as { itemId: number; day: number }[],
  takeLaunch: () => call((p) => p.takeLaunch(), {}),
  forecast: (json: string) => call((p) => p.forecast({ json }), undefined),
  widgets: (payload: unknown) => call((p) => p.widgets({ json: JSON.stringify(payload) }), undefined),
  takeWidgetUndone: async () => JSON.parse((await call((p) => p.takeWidgetUndone(), { json: "[]" })).json) as { itemId: number; day: number }[],
  controls: async (itemId: number) => JSON.parse((await call((p) => p.controls({ itemId }), { json: "[]" })).json) as Control[],
  earlySnooze: (reminderId: number, original: number) => call((p) => p.earlySnooze({ reminderId, original }), undefined),
  earlyStop: (reminderId: number, original: number) => call((p) => p.earlyStop({ reminderId, original }), undefined),
  resetAlarm: (reminderId: number, original: number | null) => call((p) => p.resetAlarm({ reminderId, original }), undefined),
  saveClock: (a: ClockAlarm) => call((p) => p.saveClock({ json: JSON.stringify(a) }), { id: 0 }),
  deleteClock: (id: number) => call((p) => p.deleteClock({ id }), undefined),
  timer: (action: "start" | "pause" | "resume" | "plus" | "reset" | "delete", o: { id?: number; durationMs?: number; label?: string } = {}) =>
    call((p) => p.timer({ action, ...o }), undefined),
  stopwatch: (action: "start" | "pause" | "lap" | "reset") => call((p) => p.stopwatch({ action }), undefined),
  zone: (action: "add" | "remove", zone: string) => call((p) => p.zone({ action, zone }), undefined),
  setRingEvents: (value: boolean | null) => call((p) => p.setRingEvents({ value }), undefined),
  pickSound: (current: string | null, title?: string) => call((p) => p.pickSound({ current, title }), { picked: false }),
  soundName: async (uri: string) => (await call((p) => p.soundName({ uri }), {})).name ?? null,
  pickWeatherApp: () => call((p) => p.pickWeatherApp(), { picked: false }),
  clearWeatherApp: () => call((p) => p.clearWeatherApp(), undefined),
  openWeather: (url: string) => call((p) => p.openWeather({ url }), { opened: "" }),
  requestNotifications: () => call((p) => p.requestNotifications(), { granted: false }),
  openSettings: (which: "notifications" | "fullScreen" | "battery" | "exact") => call((p) => p.openSettings({ which }), undefined),
};

/** Listens to the engine: "changed" carries what changed ("clock", "tools", "overrides", "done", "widget", "ring", "resume"). */
export function onNative(event: "changed" | "launch", fn: (what: string) => void): () => void {
  if (!plugin) return () => {};
  const h = plugin.addListener(event, (e) => fn(e?.what ?? ""));
  return () => { void h.then((x) => x.remove()); };
}

// ---------- The Alarms page's state, kept fresh from the engine ----------

const EMPTY: AlarmState = {
  alarms: [], tools: { timers: [], stopwatch: { startedAt: null, accumulatedMs: 0, laps: [] }, zones: [] },
  ring: { rings: true, explicit: null, originalInstalled: false },
  perms: { notifications: true, fullScreen: true, exact: true, batteryExempt: true }, zone: "", weatherApp: null,
};
let state: AlarmState = EMPTY;
const listeners = new Set<() => void>();
let loading = false;
let again = false;

/** Reads the engine's state again (after any change, natively or from here). */
export async function refreshAlarmState(): Promise<void> {
  if (!plugin) return;
  if (loading) { again = true; return; }
  loading = true;
  try {
    do {
      again = false;
      const r = await call((p) => p.state(), null);
      if (r) { state = JSON.parse(r.json) as AlarmState; listeners.forEach((l) => l()); }
    } while (again);
  } finally {
    loading = false;
  }
}

let started = false;
function start() {
  if (started || !plugin) return;
  started = true;
  onNative("changed", () => void refreshAlarmState());
  void refreshAlarmState();
}

/** The engine's state, redrawn when it changes. */
export function useAlarmState(): AlarmState {
  start();
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
}
export const alarmState = () => state;

/** Runs an engine change, then shows its result at once (the "changed" event may come a moment later). */
export async function act(p: Promise<unknown>) {
  await p;
  await refreshAlarmState();
}
