// Two-way sync with the Worker: same protocol as the phone (app/.../sync/CloudSync.kt).
// Compare local records with the last synced copy ("base"), send the differences, apply what
// comes back. The server settles conflicts; deletes are sent as data: null.
import * as db from "./db.ts";
import { type Kind, allRecords, applyRemote } from "./store.ts";

type Rec = Record<string, unknown>;
interface Base { seq: number; records: Record<string, Rec> }
interface Change { kind: Kind; id: string; data: Rec | null }

export type SyncState = "idle" | "syncing" | "offline" | "error" | "needs-confirm" | "signed-out";
export interface SyncStatus { state: SyncState; lastSyncAt: number; message: string }

let status: SyncStatus = { state: "idle", lastSyncAt: Number(localStorage.getItem("lastSyncAt") ?? 0), message: "" };
const statusListeners = new Set<(s: SyncStatus) => void>();
export const getStatus = () => status;
export function onStatus(fn: (s: SyncStatus) => void) { statusListeners.add(fn); return () => statusListeners.delete(fn); }
function setStatus(s: Partial<SyncStatus>) { status = { ...status, ...s }; statusListeners.forEach((l) => l(status)); }

export const getToken = () => localStorage.getItem("apiToken") ?? "";
export function setToken(t: string) { localStorage.setItem("apiToken", t.trim()); }
export function signOut() { localStorage.removeItem("apiToken"); setStatus({ state: "signed-out", message: "" }); }

class HttpError extends Error { constructor(public code: number, msg: string) { super(msg); } }

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json", "X-Device": "PC browser", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new HttpError(res.status, (body as { error?: string })?.error ?? text.slice(0, 200));
  return body;
}

/** Checks a password against the server without syncing. */
export async function testToken(token: string): Promise<{ items: number }> {
  const res = await fetch("/api/status", { headers: { Authorization: `Bearer ${token.trim()}` } });
  if (res.status === 401) throw new Error("Wrong password");
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const body = await res.json() as { counts?: { items?: number } };
  return { items: body.counts?.items ?? 0 };
}

/** JSON with sorted keys, so field order never counts as a change. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Rec;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

let running: Promise<number> | null = null;

/** Runs one sync (or joins the one in progress). Returns how many records came in. */
export function syncNow(force = false): Promise<number> {
  if (running) return running;
  running = doSync(force).finally(() => { running = null; });
  return running;
}

async function doSync(force: boolean): Promise<number> {
  if (!getToken()) { setStatus({ state: "signed-out" }); return 0; }
  if (!navigator.onLine) { setStatus({ state: "offline", message: "Offline — changes are saved here and will sync later" }); return 0; }
  setStatus({ state: "syncing" });
  const base = (await db.get<Base>("base")) ?? { seq: 0, records: {} };
  const local: Record<string, Rec> = Object.fromEntries(allRecords());
  const outgoing: Change[] = [];
  for (const key of new Set([...Object.keys(base.records), ...Object.keys(local)])) {
    const l = local[key], b = base.records[key];
    if (l === undefined && b === undefined) continue;
    if (l !== undefined && b !== undefined && canonical(l) === canonical(b)) continue;
    const slash = key.indexOf("/");
    outgoing.push({ kind: key.slice(0, slash) as Kind, id: key.slice(slash + 1), data: l ?? null });
  }
  try {
    const reply = await api(`/api/sync${force ? "?force=1" : ""}`, {
      method: "POST",
      body: JSON.stringify({ since: base.seq, changes: outgoing }),
    }) as { seq: number; conflicts: number; changes: Change[] };
    applyRemote(reply.changes);
    const records = { ...base.records };
    for (const c of outgoing) { const k = `${c.kind}/${c.id}`; if (c.data === null) delete records[k]; else records[k] = c.data; }
    for (const c of reply.changes) { const k = `${c.kind}/${c.id}`; if (c.data === null) delete records[k]; else records[k] = c.data; }
    await db.put("base", { seq: reply.seq, records });
    const now = Date.now();
    localStorage.setItem("lastSyncAt", String(now));
    const parts = ["Synced"];
    if (outgoing.length || reply.changes.length) parts.push(`sent ${outgoing.length}, received ${reply.changes.length}`);
    if (reply.conflicts) parts.push(`${reply.conflicts} conflict(s) settled`);
    setStatus({ state: "idle", lastSyncAt: now, message: parts.join(" · ") });
    return reply.changes.length;
  } catch (e) {
    if (e instanceof HttpError && e.code === 401) setStatus({ state: "signed-out", message: "Wrong password" });
    else if (e instanceof HttpError && e.code === 409) setStatus({ state: "needs-confirm", message: e.message });
    else if (e instanceof HttpError) setStatus({ state: "error", message: `Server error ${e.code}: ${e.message}` });
    else setStatus({ state: "offline", message: "Can't reach the server — changes are saved here and will sync later" });
    return 0;
  }
}

let debounce: number | undefined;
/** Called after every local change. */
export function requestSync(delayMs = 1500) {
  clearTimeout(debounce);
  debounce = window.setTimeout(() => void syncNow(), delayMs);
}

/** Background schedule: every 30 s, when the window regains focus, and when the network returns. */
export function startAutoSync() {
  window.setInterval(() => { if (document.visibilityState === "visible") void syncNow(); }, 30_000);
  window.addEventListener("focus", () => void syncNow());
  window.addEventListener("online", () => void syncNow());
  void syncNow();
}

/** Forget this browser's copy (used when signing out or switching servers). */
export async function resetLocal() {
  await db.clear();
  localStorage.removeItem("lastSyncAt");
}
