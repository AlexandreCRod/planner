// Reading Health Connect you can trust (item 253): the pure part of a read, so it can be tested.
// - Each type remembers its own last read (epoch ms, localStorage "hcLastReads"), so a type Health Connect
//   refused (it rate-limits big reads) keeps its old time and is read again next time, instead of being
//   skipped for good. Older versions kept one time for all ("hcLastRead"): it becomes every type's start.
// - A short summary of each read, per type, for the problem log (a phone report shows what happened).
// - Settings' "Watch data" status: the last run and night found, and how to fix a Garmin that doesn't share.
import { type HealthNight, type HealthSession, REREAD_DAYS } from "./health.ts";
import { isRunSession } from "./healthRuns.ts";
import { count } from "./plural.ts";
import { isoOf } from "./training.ts";

/** Garmin Connect's package: the origin of everything the watch writes to Health Connect. */
export const GARMIN_ORIGIN = "com.garmin.android.apps.connectmobile";

// ---------- Per-type last reads ----------

/** When each type was last read whole, epoch ms, by type name. */
export type LastReads = Record<string, number>;

/** The stored per-type times ([json]); when there are none yet, the older single time ([single]) for every type. */
export function lastReadsOf(json: string | null, single: number | null, types: readonly string[]): LastReads {
  if (json) {
    try {
      const v = JSON.parse(json) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const out: LastReads = {};
        for (const [k, t] of Object.entries(v)) if (typeof t === "number" && Number.isFinite(t) && t > 0) out[k] = t;
        return out;
      }
    } catch { /* unreadable: as if none */ }
  }
  return single ? Object.fromEntries(types.map((t) => [t, single])) : {};
}

/**
 * Where the next read of [types] starts from: the oldest of their last reads (a type never read, say one
 * just permitted, rides along with the others); null when none has been read yet (first connect).
 */
export function oldestRead(last: LastReads, types: readonly string[]): number | null {
  const times = types.map((t) => last[t]).filter((t): t is number => t !== undefined);
  return times.length ? Math.min(...times) : null;
}

/** The newest of the last reads (when anything was last read), null before the first. */
export function newestRead(last: LastReads): number | null {
  const times = Object.values(last);
  return times.length ? Math.max(...times) : null;
}

/**
 * The last reads after a read of [types] that started at [started]. A type read in every window gets
 * [started]; one that failed in a window keeps its old time. With none yet (first connect) it gets a time
 * the next read starts from the oldest window it failed in ([failedFrom]: that window's first day, by
 * type; [midnight]: a local day's start, epoch ms). Types not read keep what they had.
 */
export function nextLastReads(prev: LastReads, types: readonly string[], failedFrom: ReadonlyMap<string, number>, started: number, midnight: (day: number) => number): LastReads {
  const out = { ...prev };
  for (const t of types) {
    const f = failedFrom.get(t);
    if (f === undefined) out[t] = started;
    else if (out[t] === undefined) out[t] = midnight(f + REREAD_DAYS);
  }
  return out;
}

// ---------- The read's summary ----------

/** One type over a whole read: read in every window or not, how many records, the newest record's local day. */
export interface TypeRead { ok: boolean; count: number; newestDay: number | null; error?: string }

/**
 * The problem log's lines for a read: a one-line message, and per type a detail line ("HeartRate: ok, 1200,
 * newest 2026-10-27", "Steps: failed, ..."); types read with nothing in them share one line.
 */
export function readSummary(reads: Record<string, TypeRead>, garmin: number, saved: number): { message: string; detail: string } {
  const all = Object.entries(reads);
  const failed = all.filter(([, r]) => !r.ok);
  const empty = all.filter(([, r]) => r.ok && r.count === 0).map(([t]) => t);
  const lines = all.filter(([, r]) => !r.ok || r.count > 0).map(([t, r]) =>
    `${t}: ${r.ok ? "ok" : "failed"}, ${r.count}${r.newestDay === null ? "" : `, newest ${isoOf(r.newestDay)}`}${r.error ? ` (${r.error.slice(0, 80)})` : ""}`);
  if (empty.length) lines.push(`Nothing in: ${empty.join(", ")}`);
  const message = `Read ${count(all.length, "type")}: ${all.length - failed.length} ok${failed.length ? `, ${failed.length} failed (tried again next read)` : ""}; ${garmin} from Garmin, ${saved} saved`;
  return { message, detail: lines.join("\n") };
}

// ---------- Settings' status ----------

/** What the watch data holds: the day of the last run, of the last night (the morning it ends), and whether any of it is Garmin's. */
export interface WatchFound { lastRunDay: number | null; lastNightDay: number | null; garmin: boolean }

/** The stored sessions and nights summed up; [garminSeen]: a read has seen a Garmin record of any type. */
export function watchFound(sessions: readonly HealthSession[], nights: readonly HealthNight[], garminSeen: boolean): WatchFound {
  const latest = (days: number[]) => (days.length ? Math.max(...days) : null);
  return {
    lastRunDay: latest(sessions.filter(isRunSession).map((s) => s.day)),
    lastNightDay: latest(nights.map((n) => n.day)),
    garmin: garminSeen || sessions.some((s) => s.source === GARMIN_ORIGIN) || nights.some((n) => n.source === GARMIN_ORIGIN),
  };
}

/** Where to fix a Garmin that writes nothing to Health Connect. */
export const GARMIN_FIX = "Garmin Connect → Settings → Connected apps → Health Connect, allow everything.";

/**
 * The status in plain words: "Last run Tue, 27 Oct · last night Wed, 28 Oct" ([date] writes a day), else
 * "Nothing from Garmin yet"; [fix]: how to fix it, while nothing has come from Garmin.
 */
export function watchStatus(f: WatchFound, date: (day: number) => string): { text: string; fix: string } {
  const parts: string[] = [];
  if (f.lastRunDay !== null) parts.push(`Last run ${date(f.lastRunDay)}`);
  if (f.lastNightDay !== null) parts.push(`${parts.length ? "last" : "Last"} night ${date(f.lastNightDay)}`);
  const text = parts.length ? parts.join(" · ") : f.garmin ? "No runs or sleep yet" : "Nothing from Garmin yet";
  return { text, fix: f.garmin ? "" : GARMIN_FIX };
}
