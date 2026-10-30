// Backups (roadmap 140; the format and the restore plan are in domain/backup.ts). The phone keeps a gzipped
// copy of every record in its own app storage (a file, outside IndexedDB, so signing out or a wiped copy
// leaves them), made by itself once a day, the newest 14 kept. The PC downloads one from "Back up now".
// Restore reads one (from the list on the phone, or a picked file) and merges it in: see restorePlan.
import { App as CapApp } from "@capacitor/app";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { deviceName, isNative } from "../platform.ts";
import { logProblem } from "../problems.ts";
import {
  type Backup, type RestorePlan, backupDue, backupFileName, backupFileTime, backupsToDrop, gunzipJson, gzipJson, makeBackup, parseBackup,
  restoreEntries, restorePlan,
} from "../domain/backup.ts";
import { KINDS, allRecords, restoreRecords } from "./store.ts";

const APP = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const DIR = "backups";
const LAST_KEY = "lastBackupAt";

export interface BackupFile { name: string; at: number; size: number }

/** Kinds a restore puts back: not the plan's files (the plan session's) or problem logs (each device's own);
 *  the watch's data only on the phone, which alone writes it. */
const RESTORE_KINDS = KINDS.filter((k) => k !== "trainingFiles" && k !== "problemLogs" && (isNative || !k.startsWith("health")));

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const lastBackupAt = () => Number(localStorage.getItem(LAST_KEY) ?? 0) || null;

/** The phone's backups, newest first. */
export async function listBackups(): Promise<BackupFile[]> {
  if (!isNative) return [];
  try {
    const { files } = await Filesystem.readdir({ path: DIR, directory: Directory.Data });
    return files.flatMap((f) => { const at = backupFileTime(f.name); return at === null ? [] : [{ name: f.name, at, size: f.size }]; })
      .sort((a, b) => b.at - a.at);
  } catch { return []; } // no folder yet
}

/**
 * Makes a backup now: on the phone a file in its own storage (then only the newest 14 kept), on the PC a
 * download. Returns its name and size.
 */
export async function backUpNow(): Promise<BackupFile> {
  const at = Date.now();
  const bytes = await gzipJson(makeBackup(allRecords(), at, APP, deviceName()));
  let name = backupFileName(at);
  if (isNative) {
    const have = await listBackups();
    if (have.some((f) => f.name === name)) name = name.replace(".json.gz", `-${have.length}.json.gz`);
    await Filesystem.writeFile({ path: `${DIR}/${name}`, data: toBase64(bytes), directory: Directory.Data, recursive: true });
    for (const old of backupsToDrop([name, ...have.map((f) => f.name)])) {
      await Filesystem.deleteFile({ path: `${DIR}/${old}`, directory: Directory.Data }).catch(() => {});
    }
  } else {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/gzip" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  localStorage.setItem(LAST_KEY, String(at));
  return { name, at, size: bytes.length };
}

/** Reads one of the phone's backups. */
export async function readBackup(name: string): Promise<Backup> {
  const { data } = await Filesystem.readFile({ path: `${DIR}/${name}`, directory: Directory.Data });
  const bytes = typeof data === "string" ? fromBase64(data) : new Uint8Array(await data.arrayBuffer());
  return parseBackup(await gunzipJson(bytes));
}

/** Reads a backup file picked by the person (the PC, or "From a file" on the phone). */
export async function readBackupFile(file: File): Promise<Backup> {
  let v: unknown;
  try { v = await gunzipJson(new Uint8Array(await file.arrayBuffer())); } catch { throw new Error("This file isn't a Planner backup"); }
  return parseBackup(v);
}

/** What restoring [backup] here would put back (nothing is written yet). */
export const planRestore = (backup: Backup): RestorePlan => restorePlan(backup, allRecords(), RESTORE_KINDS, Date.now());

/** Writes the plan: the missing records, and the changed ones too when [withChanged]. Returns how many. */
export function applyRestore(plan: RestorePlan, withChanged: boolean): number {
  const entries = restoreEntries(plan, withChanged);
  restoreRecords(entries);
  return entries.length;
}

/** The daily backup, when it's due and there's something to keep. */
async function dailyBackup() {
  try {
    if (!allRecords().size) return;
    const newest = (await listBackups())[0]?.at ?? null;
    if (backupDue(newest, Date.now())) await backUpNow();
  } catch (e) {
    logProblem("backup", `Couldn't make the daily backup: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The phone: a daily backup a little after the app opens, and when it comes back if the day has changed. */
export function startDailyBackups() {
  if (!isNative) return;
  let timer = 0;
  const soon = () => { clearTimeout(timer); timer = window.setTimeout(() => void dailyBackup(), 20_000); };
  soon();
  void CapApp.addListener("resume", soon);
}
