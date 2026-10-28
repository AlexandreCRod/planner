// The phone's door to Health Connect (android/.../health/HealthConnectPlugin.kt): asking for the permissions,
// and reading the watch's runs, sleep and daily data into Planner's records (domain/health.ts does the
// converting). Reads on app start and on resume, when switched on: the whole history the first time, then
// from 3 days before the last read; only records that changed are saved, then they sync like any other.
// Each type's last read is remembered on this device only (253: one Health Connect refused is read again
// next time), and each read leaves a short summary in the problem log (Settings → Problem log). On the PC, or a phone without Health Connect, nothing
// here runs: the records arrive by sync.
import { App as CapApp } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import { useSyncExternalStore } from "react";
import { epochOf, today } from "../domain/dates.ts";
import {
  type HealthNight, type HealthRecords, type HealthSession, type RawByType, type RawRecord, HC_TYPES, changedOnly, convertHealth, readWindows,
} from "../domain/health.ts";
import {
  type TypeRead, type WatchFound, GARMIN_ORIGIN, lastReadsOf, newestRead, nextLastReads, oldestRead, readSummary, watchFound,
} from "../domain/healthRead.ts";
import { isNative } from "../platform.ts";
import { logLatest, logProblem } from "../problems.ts";
import { type Kind, listOf, putRecords } from "../store/store.ts";
import { applyWatchRuns } from "../store/training.ts";

type Status = "available" | "update" | "unavailable";
interface Permissions { granted: string[]; all: boolean; history: boolean; historyAvailable: boolean }
interface HealthConnectPlugin {
  availability(): Promise<{ status: Status }>;
  permissions(): Promise<Permissions>;
  request(): Promise<Permissions>;
  openSettings(): Promise<void>;
  read(o: { type: string; from: number; to: number; pageToken?: string; pageSize?: number }): Promise<{ records: RawRecord[]; pageToken?: string }>;
  insertSample(o?: { daysAgo?: number }): Promise<{ ids: string[] }>;
}

const plugin = isNative ? registerPlugin<HealthConnectPlugin>("HealthConnect") : null;

const ON_KEY = "hcOn";
/** The single last read of older versions; still written (the oldest type's), for going back a version. */
const LAST_KEY = "hcLastRead";
/** Each type's last read, {type: epoch ms} (253). */
const LAST_READS_KEY = "hcLastReads";
/** "1" once a read has seen a record from Garmin Connect. */
const GARMIN_KEY = "hcGarmin";
const CARD_KEY = "hcCardDismissed";
/** A resume this soon after the last read doesn't read again (ms). */
const RESUME_GAP = 10 * 60_000;

/** Each type's last read; from the older single time when there are none yet. */
function storedLastReads() {
  return lastReadsOf(localStorage.getItem(LAST_READS_KEY), Number(localStorage.getItem(LAST_KEY)) || null, HC_TYPES);
}

/** What the stored watch data holds, for Settings' status: the last run and night, and whether any is Garmin's. */
export const healthFound = (): WatchFound =>
  watchFound(listOf<HealthSession>("healthSessions"), listOf<HealthNight>("healthNights"), localStorage.getItem(GARMIN_KEY) === "1");

export interface HealthState {
  /** Health Connect on this phone: null until asked, and always null on the PC. */
  status: Status | null;
  /** Switched on (connected) on this device. */
  on: boolean;
  /** Permissions given for at least one type. */
  granted: boolean;
  reading: boolean;
  /** When the last read that got anything started, epoch ms; null before the first. */
  lastRead: number | null;
  /** How many types the last read couldn't read (they're tried again next read). */
  failed: number;
  /** What went wrong in the last read, in plain words. */
  error: string;
}

let state: HealthState = {
  status: null, on: localStorage.getItem(ON_KEY) === "1", granted: false, reading: false,
  lastRead: newestRead(storedLastReads()), failed: 0, error: "",
};
const listeners = new Set<() => void>();
function set(s: Partial<HealthState>) { state = { ...state, ...s }; listeners.forEach((l) => l()); }

export const healthState = () => state;
export function useHealth(): HealthState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, healthState);
}

/** Whether this device can read Health Connect at all: the phone app, with Health Connect present (or installable). */
export const canUseHealth = (s: HealthState = state) => plugin !== null && (s.status === "available" || s.status === "update");

/** The Training page's one-time "Connect" card: dismissed for good, or no longer needed. */
export const cardDismissed = () => localStorage.getItem(CARD_KEY) === "1";
export function dismissCard() { localStorage.setItem(CARD_KEY, "1"); set({}); }

/** Asks Health Connect for every permission; when at least one is given, switches on and reads. Returns whether it's on. */
export async function connect(): Promise<boolean> {
  if (!plugin) return false;
  try {
    if (state.status === "update") { await plugin.openSettings().catch(() => {}); return false; }
    const p = await plugin.request();
    const ok = p.granted.length > 0;
    set({ granted: ok });
    if (!ok) return false;
    localStorage.setItem(ON_KEY, "1");
    localStorage.setItem(CARD_KEY, "1");
    set({ on: true, error: "" });
    void readNow();
    return true;
  } catch (e) {
    set({ error: message(e) });
    return false;
  }
}

/** Stops reading. What was read stays (and keeps syncing); Health Connect's own permissions stay as they are. */
export function disconnect() {
  localStorage.setItem(ON_KEY, "0");
  set({ on: false });
}

/** Health Connect's page for this app (to take permissions back, or see what it shares). */
export const openHealthSettings = () => plugin?.openSettings().catch(() => {});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Local midnight at the start of epoch day [day], as epoch ms. */
function midnight(day: number): number {
  const d = new Date(day * 86_400_000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}

const dayOfMs = (ms: number) => { const d = new Date(ms); return epochOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

/** Every record of [type] in [from, to), all pages. */
async function readAll(p: HealthConnectPlugin, type: string, from: number, to: number): Promise<RawRecord[]> {
  const out: RawRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await p.read({ type, from, to, pageToken, pageSize: 1000 });
    out.push(...page.records);
    pageToken = page.pageToken;
  } while (pageToken);
  return out;
}

/** The earliest day any granted type has data, for the first read; today when there's none. */
async function firstDay(p: HealthConnectPlugin, types: string[], now: number): Promise<number> {
  let first = now;
  for (const type of types) {
    try {
      const page = await p.read({ type, from: 0, to: now, pageSize: 1 });
      const r = page.records[0];
      const t = r ? Number(r.startTime ?? r.time) : NaN;
      if (Number.isFinite(t) && t < first) first = t;
    } catch { /* a type this Health Connect doesn't have */ }
  }
  return dayOfMs(first);
}

const KIND_OF: [Kind, keyof HealthRecords][] = [["healthSessions", "sessions"], ["healthNights", "nights"], ["healthDays", "days"]];

/** Saves the records that differ from the stored ones (only new ones when [newOnly]); returns how many. */
function save(recs: HealthRecords, newOnly: boolean): number {
  let n = 0;
  for (const [kind, key] of KIND_OF) {
    const stored = new Map(listOf<{ id: string }>(kind).map((r) => [r.id, r]));
    const changed = changedOnly<{ id: string }>(recs[key], stored, newOnly);
    if (changed.length) { putRecords(kind, changed); n += changed.length; }
  }
  return n;
}

/**
 * Reads what's new, if switched on and permitted. The first read takes the whole history, window by window
 * (the newest week first, then two weeks each going back; a day's margin either side so runs and nights at
 * the edges are whole). Each type keeps its own last read (253): one Health Connect refused keeps its old
 * time and is read again next time; a window it failed in only adds records, never replaces stored ones.
 */
export async function readNow(): Promise<void> {
  const p = plugin;
  if (!p || !state.on || state.reading) return;
  set({ reading: true, error: "" });
  try {
    const perms = await p.permissions();
    set({ granted: perms.granted.length > 0 });
    if (!perms.granted.length) return;
    const types = HC_TYPES.filter((t) => perms.granted.includes(t));
    const started = Date.now();
    const prev = storedLastReads();
    const oldest = oldestRead(prev, types);
    const windows = readWindows(oldest === null ? null : dayOfMs(oldest), oldest === null ? await firstDay(p, types, started) : 0, today());
    let saved = 0, garmin = 0;
    const failedFrom = new Map<string, number>();
    const reads: Record<string, TypeRead> = Object.fromEntries(types.map((t) => [t, { ok: true, count: 0, newestDay: null }]));
    for (const [from, to] of windows) {
      const raw: RawByType = {};
      for (const type of types) {
        const r = reads[type];
        try {
          const recs = raw[type] = await readAll(p, type, midnight(from - 1), Math.min(midnight(to + 1), started));
          r.count += recs.length;
          for (const rec of recs) {
            if (rec.metadata.origin === GARMIN_ORIGIN) garmin++;
            const t = Number(rec.startTime ?? rec.time);
            if (Number.isFinite(t) && (r.newestDay === null || dayOfMs(t) > r.newestDay)) r.newestDay = dayOfMs(t);
          }
        } catch (e) {
          failedFrom.set(type, Math.min(from, failedFrom.get(type) ?? from));
          r.ok = false;
          r.error = message(e);
          console.warn("health:", type, e);
        }
      }
      // Windows don't overlap, so a failure in this one says nothing about the others.
      saved += save(convertHealth(raw, from, to, Date.now()), types.some((t) => raw[t] === undefined));
    }
    if (garmin) localStorage.setItem(GARMIN_KEY, "1");
    const summary = readSummary(reads, garmin, saved);
    logLatest("health read", summary.message, summary.detail);
    const next = nextLastReads(prev, types, failedFrom, started, midnight);
    localStorage.setItem(LAST_READS_KEY, JSON.stringify(next));
    // Older versions read from the single time: the oldest, so going back to one never skips a type.
    localStorage.setItem(LAST_KEY, String(oldestRead(next, types) ?? started));
    if (failedFrom.size === types.length) throw new Error("Health Connect didn't answer");
    // A new watch run ticks its session (one run session that day, not done).
    const ticked = applyWatchRuns();
    if (ticked) console.info(`health: a watch run ticked ${ticked} session(s)`);
    set({ lastRead: started, failed: failedFrom.size });
    console.info(`health: read ${windows.length} window(s), saved ${saved} record(s)${failedFrom.size ? `; couldn't read ${[...failedFrom.keys()].join(", ")}` : ""}`);
  } catch (e) {
    set({ error: message(e) });
    logProblem("health", `Couldn't read Health Connect: ${message(e)}`);
  } finally {
    set({ reading: false });
  }
}

/** The phone app: checks Health Connect, then reads on start and on resume (not again within 10 minutes). */
export function startHealthReading() {
  if (!plugin) return;
  const check = async () => {
    try { set({ status: (await plugin.availability()).status }); } catch { set({ status: "unavailable" }); }
    if (state.status !== "available") return;
    try { set({ granted: (await plugin.permissions()).granted.length > 0 }); } catch { /* asked again on the next read */ }
  };
  void check().then(() => readNow());
  void CapApp.addListener("resume", () => {
    void check().then(() => { if (state.lastRead === null || Date.now() - state.lastRead > RESUME_GAP) void readNow(); });
  });
  // For checks on a debug build through the WebView's devtools: test records and a read on demand.
  (window as unknown as Record<string, unknown>).plannerHealth = {
    insertSample: (daysAgo = 1) => plugin.insertSample({ daysAgo }),
    readNow, state: healthState,
  };
}
