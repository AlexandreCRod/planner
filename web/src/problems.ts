// The problem log: what went wrong on this device (a screen that crashed, an error nothing caught, a
// save that failed), kept in a short list so it can be read and copied from Settings → Problem log.
// The phone can't be inspected over adb (the Xiaomi blocks it), so this is how a problem gets reported.

export interface Problem { at: number; kind: string; message: string; detail: string }

const KEY = "problemLog";
const MAX = 50;
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
    list.unshift({ at: Date.now(), kind, message: message.slice(0, 500), detail: detail.slice(0, 4000) });
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
