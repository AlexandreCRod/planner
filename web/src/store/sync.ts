// Two-way sync with the Worker: same protocol as the phone (app/.../sync/CloudSync.kt).
// Compare local records with the last synced copy ("base"), send the differences, apply what
// comes back. The server settles conflicts; deletes are sent as data: null.
import { apiUrl, deviceName } from "../platform.ts";
import * as db from "./db.ts";
import { fetchMissing, uploadBlob } from "./images.ts";
import { filesToFetch, syncedFile } from "../domain/media.ts";
import type { NoteImage } from "../domain/types.ts";
import { FIRST_KINDS, type Kind, allRecords, applyRemote, saveWith } from "./store.ts";
import { count } from "../domain/plural.ts";
import { type SyncBase, outgoingChanges, settleReply } from "../domain/syncMerge.ts";
import { logProblem } from "../problems.ts";

/** The app's version, sent with each sync so a later Worker can warn an outdated app. */
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
/** Largest record sent (the Worker refuses bigger ones by name). */
const MAX_RECORD_CHARS = 1_000_000;

/**
 * Whether the Worker takes records of [kind]: the first kinds always; newer ones (Training...) once it
 * has said it takes any kind. Until then they wait on this device, so updating the app before the
 * Worker never stops sync.
 */
function serverTakes(kind: Kind): boolean {
  return FIRST_KINDS.includes(kind) || (localStorage.getItem("serverFeatures") ?? "").split(",").includes("anyKind");
}

/**
 * Whether the Worker merges a change with the copy it started from (item 141): then each edited item
 * carries that copy as its base. An older Worker ignores it, so it isn't sent there.
 */
const serverMerges = () => (localStorage.getItem("serverFeatures") ?? "").split(",").includes("baseMerge");

type Rec = Record<string, unknown>;
type Base = SyncBase;
interface Change { kind: Kind; id: string; data: Rec | null; base?: Rec; keep?: "mine" }

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

export class HttpError extends Error { constructor(public code: number, msg: string) { super(msg); } }

export async function api(path: string, init: RequestInit = {}): Promise<unknown> {
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

/** How many bytes the server holds (its database, pictures included); null when it can't be asked. */
export async function serverStorageBytes(): Promise<number | null> {
  try {
    const body = await api("/api/status") as { storageBytes?: unknown };
    return typeof body.storageBytes === "number" ? body.storageBytes : null;
  } catch { return null; }
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
  const { outgoing: out, tooLarge } = outgoingChanges(base, sent, { withBase: serverMerges(), takes: (k) => serverTakes(k as Kind), maxChars: MAX_RECORD_CHARS });
  const outgoing = out as Change[];
  if (tooLarge.length) logProblem("sync", `Too large to sync (over 1 MB), kept on this device: ${tooLarge.join(", ")}`);
  try {
    // A picture's file goes up before its record, so the phone can always fetch it. A video's file stays
    // here (the server takes pictures only): only its still goes up (domain/media.ts).
    for (const c of outgoing) {
      const file = c.kind === "images" && c.data ? syncedFile({ mime: "image/jpeg", ...c.data } as NoteImage) : null;
      if (file) await uploadBlob(file.hash, file.mime);
    }
    const reply = await api(`/api/sync${force ? "?force=1" : ""}`, {
      method: "POST",
      body: JSON.stringify({ since: base.seq, changes: outgoing, app: APP_VERSION }),
    }) as { seq: number; conflicts: number; copies?: number; changes: Change[]; features?: string[] };
    // What this Worker takes; newer kinds held back so far go in the next round once it takes them.
    const hadAny = serverTakes("trainingEntries");
    localStorage.setItem("serverFeatures", (reply.features ?? []).join(","));
    if (!hadAny && serverTakes("trainingEntries")) again = true;
    // What was edited here while the request was out stays (taking in the reply's other changes); the
    // next round sends it.
    const { apply, kept, next } = settleReply(base, sent, allRecords(), outgoing, reply);
    applyRemote(apply as Change[]);
    if (kept.length) again = true;
    // The received records and the copy they were synced against land together (see saveWith).
    await saveWith([["base", next]]);
    const at = Date.now();
    localStorage.setItem("lastSyncAt", String(at));
    const parts = ["Synced"];
    if (outgoing.length || reply.changes.length) parts.push(`sent ${outgoing.length}, received ${reply.changes.length}`);
    if (reply.conflicts) parts.push(`${count(reply.conflicts, "conflict")} settled`);
    if (reply.copies) parts.push(`${count(reply.copies, "conflicted copy", "conflicted copies")} kept`);
    if (tooLarge.length) parts.push(`${count(tooLarge.length, "record")} too large to sync (see Problem log)`);
    setStatus({ state: "idle", lastSyncAt: at, message: parts.join(" · ") });
    await fetchMissing(filesToFetch(allRecords()));
    return reply.changes.length;
  } catch (e) {
    if (e instanceof HttpError && e.code === 401) setStatus({ state: "signed-out", message: "Wrong password" });
    else if (e instanceof HttpError && e.code === 409) {
      const n = (await pendingDeletes()).filter(([k]) => k.startsWith("items/")).length;
      setStatus({ state: "needs-confirm", message: `${count(n, "item")} deleted on this device ${n === 1 ? "is" : "are"} waiting. Delete ${n === 1 ? "it" : "them"} everywhere, or restore ${n === 1 ? "it" : "them"}?` });
    }
    else if (e instanceof HttpError) setStatus({ state: "error", message: `Server error ${e.code}: ${e.message}` });
    else setStatus({ state: "offline", message: "Can't reach the server — changes are saved here and will sync later" });
    return 0;
  }
}

/** Records in the synced copy that are gone here: what this device deleted since its last sync. */
async function pendingDeletes(): Promise<[string, Rec][]> {
  const base = (await db.get<Base>("base")) ?? { seq: 0, records: {} };
  const local = allRecords();
  return Object.entries(base.records).filter(([k]) => !local.has(k));
}

/** The deletion guard held a sync back, and the user meant it: send the deletes anyway. */
export function confirmDeletes(): Promise<number> {
  return syncNow(true);
}

/** The deletion guard held a sync back, and it was a mistake: everything deleted here since the last sync comes back. */
export async function restoreDeletes(): Promise<number> {
  const back = await pendingDeletes();
  applyRemote(back.map(([k, data]) => { const slash = k.indexOf("/"); return { kind: k.slice(0, slash) as Kind, id: k.slice(slash + 1), data }; }));
  return syncNow();
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
