// Backups (roadmap 140): a full copy of the records as gzipped JSON, kept outside IndexedDB (a file in the
// phone app's own storage, daily, the last 14; a downloaded file on the PC). Restoring never replaces the
// data: it puts back what's missing or different, with a new edit time, and never deletes anything, so
// the next sync sends only those records (no mass deletes, nothing for the deletion guard).
// Pure: the store and the files are in store/backup.ts.

type Rec = Record<string, unknown>;

export const BACKUP_FORMAT = "planner-backup";
export const BACKUP_VERSION = 1;
/** How many automatic backups the phone keeps (about 3 KB each today). */
export const KEEP_BACKUPS = 14;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** When it was made (ms). */
  createdAt: number;
  /** The app version that made it. */
  app: string;
  /** "Phone (web app)" / "PC browser". */
  device: string;
  /** Every record as the store keeps it: "kind/key" and the record. */
  records: [string, Rec][];
}

export function makeBackup(records: Iterable<[string, Rec]>, createdAt: number, app: string, device: string): Backup {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt, app, device, records: [...records] };
}

/** Checks a parsed file is a backup this app can read; throws a plain message when it isn't. */
export function parseBackup(v: unknown): Backup {
  const b = v as Partial<Backup> | null;
  if (!b || typeof b !== "object" || b.format !== BACKUP_FORMAT) throw new Error("This file isn't a Planner backup");
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) throw new Error("This backup is from a newer version of Planner: update the app first");
  if (!Array.isArray(b.records) || typeof b.createdAt !== "number") throw new Error("This backup is damaged");
  const records = b.records.filter((e): e is [string, Rec] =>
    Array.isArray(e) && typeof e[0] === "string" && e[0].includes("/") && !!e[1] && typeof e[1] === "object" && !Array.isArray(e[1]));
  return { format: BACKUP_FORMAT, version: b.version, createdAt: b.createdAt, app: String(b.app ?? ""), device: String(b.device ?? ""), records };
}

/** JSON with sorted keys, so field order never counts as a difference. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Rec;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Fields that only say when a record was last edited, left out when comparing. */
const editTime = (r: Rec) => { const { updatedAt: _u, ...rest } = r; return canonical(rest); };

export interface RestorePlan {
  /** In the backup, gone here: put back. */
  missing: [string, Rec][];
  /** Here too, but different (an edit since, or an older one): set back to the backup's. */
  changed: [string, Rec][];
  /** Records of kinds a restore leaves alone (the plan's files, problem logs...). */
  skipped: number;
}

/**
 * What restoring [backup] over [current] would do. Only kinds in [kinds] come back (the plan's files and
 * each device's problem log aren't the app's to write); the records put back get edit time [now] when they
 * have one, so they win over the copies on the server. Nothing in [current] is ever deleted.
 */
export function restorePlan(backup: Backup, current: ReadonlyMap<string, Rec>, kinds: readonly string[], now: number): RestorePlan {
  const plan: RestorePlan = { missing: [], changed: [], skipped: 0 };
  const allowed = new Set(kinds);
  for (const [key, rec] of backup.records) {
    if (!allowed.has(key.slice(0, key.indexOf("/")))) { plan.skipped++; continue; }
    const here = current.get(key);
    if (here !== undefined && editTime(here) === editTime(rec)) continue;
    const back = typeof rec.updatedAt === "number" ? { ...rec, updatedAt: now } : rec;
    (here === undefined ? plan.missing : plan.changed).push([key, back]);
  }
  return plan;
}

/** The records to write for a restore: the missing ones only, or the changed ones too. */
export const restoreEntries = (plan: RestorePlan, withChanged: boolean): [string, Rec][] =>
  withChanged ? [...plan.missing, ...plan.changed] : plan.missing;

const pad = (n: number) => String(n).padStart(2, "0");
/** "planner-backup-2026-10-30-0815.json.gz", in local time, so a list sorted by name is sorted by date. */
export function backupFileName(at: number): string {
  const d = new Date(at);
  return `planner-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json.gz`;
}

/** When a backup's file was made, from its name (local time); null for any other file. */
export function backupFileTime(name: string): number | null {
  const m = /^planner-backup-(\d{4})-(\d\d)-(\d\d)-(\d\d)(\d\d)(?:-\d+)?\.json\.gz$/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
}

/** The backup files past the newest [keep], to delete; other files are never touched. */
export function backupsToDrop(names: string[], keep = KEEP_BACKUPS): string[] {
  return names.filter((n) => backupFileTime(n) !== null).sort().reverse().slice(keep);
}

/** Whether the daily backup is due: none yet, or the newest isn't from today (local); a clock set back counts as due. */
export function backupDue(newestAt: number | null, now: number): boolean {
  if (newestAt === null || newestAt > now) return true;
  return new Date(newestAt).toDateString() !== new Date(now).toDateString();
}

// ---------- gzip (CompressionStream: the WebView, browsers and Node 18+) ----------

export async function gzipJson(v: unknown): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(v)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipJson(bytes: Uint8Array): Promise<unknown> {
  // A plain JSON file (one unzipped by hand) is read as it is.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(bytes));
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
