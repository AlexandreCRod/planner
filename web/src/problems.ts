// The problem log: what went wrong on this device (a screen that crashed, an error nothing caught, a
// save that failed), kept in a short list so it can be read and copied from Settings → Problem log.
// The phone can't be inspected over adb (the Xiaomi blocks it), so this is how a problem gets reported.

export interface Problem { at: number; kind: string; message: string; detail: string; /** A note (logLatest), not counted as a problem. */ note?: true }

const KEY = "problemLog";
export const MAX = 50;
const listeners = new Set<() => void>();

export function problems(): Problem[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Problem[]; } catch { return []; }
}

/** Adds a problem (newest first; the same one again within a minute only counts once). */
export function logProblem(kind: string, message: string, detail = "") {
  try {
    const list = problems();
    const now = Date.now();
    if (list[0] && list[0].message === message && now - list[0].at < 60_000) return;
    list.unshift({ at: now, kind, message: message.slice(0, 500), detail: detail.slice(0, 4000) });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    listeners.forEach((l) => l());
  } catch { /* the log itself must never throw */ }
}

/**
 * A note that isn't a problem but helps read one, e.g. the last Health Connect read's summary (253): only
 * the newest of its [kind] is kept, so frequent notes never push real problems out of the log.
 */
export function logLatest(kind: string, message: string, detail = "") {
  try {
    const list = problems().filter((p) => p.kind !== kind);
    list.unshift({ at: Date.now(), kind, message: message.slice(0, 500), detail: detail.slice(0, 4000), note: true });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    listeners.forEach((l) => l());
  } catch { /* the log itself must never throw */ }
}

export function clearProblems() {
  localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

export function onProblems(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The log as plain text, for copying into a message. */
export function problemsText(list = problems()): string {
  return list.map((p) => `${new Date(p.at).toISOString()} [${p.kind}] ${p.message}${p.detail ? `\n${p.detail}` : ""}`).join("\n\n");
}

/** Catches what nothing else did: errors thrown outside React, and promises nobody waited on. */
export function startProblemLog() {
  window.addEventListener("error", (e) => {
    const err = e.error as Error | undefined;
    logProblem("error", err?.message ?? e.message ?? "Unknown error", err?.stack ?? `${e.filename}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as Error | undefined;
    logProblem("promise", r?.message ?? String(e.reason), r?.stack ?? "");
  });
}

// ---------- The synced copy (265) ----------

/**
 * One device's log as a synced record (kind "problemLogs", id the device's): written only by that device,
 * so two devices never touch the same record, and read through the Worker (.claude/tools/problems.mjs)
 * instead of copying it from Settings. Only the log's own messages and stacks, the newest 50.
 */
export interface ProblemLogRecord { id: string; device: string; app: string; entries: Problem[]; updatedAt: number }

/** This device's record for [list] (newest first), or null when the stored one ([had]) already says the same. */
export function problemLogRecord(id: string, device: string, app: string, list: readonly Problem[], had: ProblemLogRecord | undefined, now: number): ProblemLogRecord | null {
  const entries = list.slice(0, MAX);
  if (had && had.device === device && had.app === app && JSON.stringify(had.entries) === JSON.stringify(entries)) return null;
  return { id, device, app, entries, updatedAt: now };
}

/** What kind of device this is, for the record: "Android phone", "PC (Windows)"... */
export function deviceLabel(native: boolean, ua: string): string {
  if (native) return "Android phone";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "other";
  return `Browser (${os})`;
}
