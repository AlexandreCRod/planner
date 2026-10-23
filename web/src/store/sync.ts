// Two-way sync with the Worker: same protocol as the phone (app/.../sync/CloudSync.kt).
// Compare local records with the last synced copy ("base"), send the differences, apply what
// comes back. The server settles conflicts; deletes are sent as data: null.
import { apiUrl, deviceName } from "../platform.ts";
import * as db from "./db.ts";
import { fetchMissing, uploadBlob } from "./images.ts";
import { filesToFetch, syncedFile } from "../domain/media.ts";
import type { NoteImage } from "../domain/types.ts";
import { type Kind, allRecords, applyRemote } from "./store.ts";
import { count } from "../domain/plural.ts";
import { remoteToApply } from "../domain/syncMerge.ts";

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
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json", "X-Device": deviceName(), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new HttpError(res.status, (body as { error?: string })?.error ?? text.slice(0, 200));
  return body;
}

/** Checks a password against the server without syncing. */
export async function testToken(token: string): Promise<{ items: number }> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/status"), { headers: { Authorization: `Bearer ${token.trim()}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(`Can't reach the server${apiUrl("") ? ` at ${apiUrl("")}` : ""}`);
  }
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
let again = false;

/**
 * Runs one sync (or joins the one in progress). Returns how many records came in. A change made while
 * one is running is sent by another round straight after it (it wasn't in the copy that one sent).
 */
export function syncNow(force = false): Promise<number> {
  if (running) { again = true; return running; }
  again = false;
  running = doSync(force).finally(() => {
    running = null;
    if (again) { again = false; requestSync(300); }
  });
  return running;
}

async function doSync(force: boolean): Promise<number> {
  if (!getToken()) { setStatus({ state: "signed-out" }); return 0; }
  if (!navigator.onLine) { setStatus({ state: "offline", message: "Offline — changes are saved here and will sync later" }); return 0; }
  setStatus({ state: "syncing" });
  const base = (await db.get<Base>("base")) ?? { seq: 0, records: {} };
  const sent = new Map(allRecords());
  const local: Record<string, Rec> = Object.fromEntries(sent);
  const outgoing: Change[] = [];
  for (const key of new Set([...Object.keys(base.records), ...Object.keys(local)])) {
    const l = local[key], b = base.records[key];
    if (l === undefined && b === undefined) continue;
    if (l !== undefined && b !== undefined && canonical(l) === canonical(b)) continue;
    const slash = key.indexOf("/");
    outgoing.push({ kind: key.slice(0, slash) as Kind, id: key.slice(slash + 1), data: l ?? null });
  }
  try {
    // A picture's file goes up before its record, so the phone can always fetch it. A video's file stays
    // here (the server takes pictures only): only its still goes up (domain/media.ts).
    for (const c of outgoing) {
      const file = c.kind === "images" && c.data ? syncedFile({ mime: "image/jpeg", ...c.data } as NoteImage) : null;
      if (file) await uploadBlob(file.hash, file.mime);
    }
    const reply = await api(`/api/sync${force ? "?force=1" : ""}`, {
      method: "POST",
      body: JSON.stringify({ since: base.seq, changes: outgoing }),
    }) as { seq: number; conflicts: number; changes: Change[] };
    // What was edited here while the request was out stays; the next round sends it.
    const { apply, kept } = remoteToApply(reply.changes, sent, allRecords());
    applyRemote(apply);
    if (kept.length) again = true;
    const records = { ...base.records };
    for (const c of outgoing) { const k = `${c.kind}/${c.id}`; if (c.data === null) delete records[k]; else records[k] = c.data; }
    for (const c of reply.changes) { const k = `${c.kind}/${c.id}`; if (c.data === null) delete records[k]; else records[k] = c.data; }
    await db.put("base", { seq: reply.seq, records });
    const now = Date.now();
    localStorage.setItem("lastSyncAt", String(now));
    const parts = ["Synced"];
    if (outgoing.length || reply.changes.length) parts.push(`sent ${outgoing.length}, received ${reply.changes.length}`);
    if (reply.conflicts) parts.push(`${count(reply.conflicts, "conflict")} settled`);
    setStatus({ state: "idle", lastSyncAt: now, message: parts.join(" · ") });
    await fetchMissing(filesToFetch(allRecords()));
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

/**
 * Background schedule: every 30 s while the page is visible, when the window regains focus or the tab is
 * shown again, and when the network returns. What another device added (a note's new picture too) shows
 * up by itself within that time.
 */
export function startAutoSync() {
  window.setInterval(() => { if (document.visibilityState === "visible") void syncNow(); }, 30_000);
  window.addEventListener("focus", () => void syncNow());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncNow(); });
  window.addEventListener("online", () => void syncNow());
  void syncNow();
}

/** Forget this browser's copy (used when signing out or switching servers). */
export async function resetLocal() {
  await db.clear();
  localStorage.removeItem("lastSyncAt");
}
