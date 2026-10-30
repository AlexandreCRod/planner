// Pure helpers shared by the Durable Object and the tests: how a planner snapshot
// (the same JSON the Android app writes as a backup) maps to individual records.

/** The kinds the first apps knew. Any other kind with a well-formed name is accepted too (see [isKind]). */
export const KINDS = [
  "items",
  "completions",
  "reminders",
  "categories",
  "tags",
  "itemTags",
  "links",
  "versions",
  "images",
] as const;

/** A record kind: one of [KINDS], or a newer one ("trainingEntries"...) that needs no Worker change. */
export type Kind = string;
export type PlannerRecord = Record<string, unknown>;
/** A full copy: each kind's records under its name ("items": [...]), plus when it was made. */
export type Snapshot = { version: number; createdAt: number; [kind: string]: unknown };

/** The kinds a snapshot carries (the lists in it). */
export function kindsIn(snapshot: Snapshot): Kind[] {
  return Object.keys(snapshot).filter((k) => isKind(k) && Array.isArray(snapshot[k]));
}

/** A snapshot's records of one kind (none when it doesn't carry that kind). */
export function recordsOf(snapshot: Snapshot, kind: Kind): PlannerRecord[] {
  const list = snapshot[kind];
  return Array.isArray(list) ? (list as PlannerRecord[]) : [];
}

/** What this Worker can do, reported by /api/status and every sync reply, so newer apps know what to send. */
export const FEATURES = ["anyKind", "maxRecord", "baseMerge"] as const;

/** Largest record accepted, as canonical JSON (Durable Object rows hold 2 MB; leave room). */
export const MAX_RECORD_CHARS = 1_000_000;

/** A snapshot's own fields, never record kinds. */
const RESERVED = new Set(["version", "createdAt", "seq", "constructor", "prototype"]);

/** A kind name: a known one, or a new one made of letters and digits, starting lower case. */
export function isKind(kind: unknown): kind is Kind {
  return typeof kind === "string" && !RESERVED.has(kind) &&
    ((KINDS as readonly string[]).includes(kind) || /^[a-z][A-Za-z0-9]{1,31}$/.test(kind));
}

/** Stable identity of a record within its kind. Join tables have composite keys; every newer kind uses `id`. */
export function keyOf(kind: Kind, r: PlannerRecord): string {
  switch (kind) {
    case "completions":
      return `${r.itemId}:${r.day}`;
    case "itemTags":
      return `${r.itemId}:${r.tagId}`;
    case "links":
      return `${r.sourceId}:${r.targetId}`;
    default:
      return String(r.id);
  }
}

/** JSON with sorted keys, so the same record always serializes identically. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Returns the snapshot if it has the expected shape, otherwise an error message. A push replaces only
 * the kinds the snapshot carries; a kind it leaves out is left alone (so an older app can't wipe a newer
 * kind it doesn't know about).
 */
export function parseSnapshot(input: unknown): Snapshot | string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return "Body must be a JSON object";
  const obj = input as Record<string, unknown>;
  for (const [kind, list] of Object.entries(obj)) {
    if (!isKind(kind) || list === undefined) continue;
    if (!Array.isArray(list)) return `"${kind}" must be an array`;
    for (const r of list) {
      if (r === null || typeof r !== "object" || Array.isArray(r)) return `"${kind}" contains a non-object`;
      const key = keyOf(kind, r as PlannerRecord);
      if (key.includes("undefined")) return `"${kind}" record is missing its id fields`;
    }
  }
  return {
    ...(obj as Snapshot),
    version: typeof obj.version === "number" ? obj.version : 1,
    createdAt: typeof obj.createdAt === "number" ? obj.createdAt : Date.now(),
  };
}

/**
 * Refuses pushes that would wipe out most of the stored items, which is what an
 * accidental push from a freshly installed (empty) app would look like.
 */
export function deletionGuard(storedItems: number, incomingItems: number): string | null {
  if (storedItems > 0 && incomingItems === 0) {
    return `This push would delete all ${storedItems} stored items. Restore from the cloud first, or push with force.`;
  }
  const removed = storedItems - incomingItems;
  if (storedItems >= 20 && removed > storedItems / 2) {
    return `This push would delete ${removed} of ${storedItems} stored items. Push with force if that is intended.`;
  }
  return null;
}

/** Constant-time comparison, so response timing doesn't reveal how much of a token matched. */
export function tokensMatch(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * One record change sent by a client: `data: null` means the client deleted it. `base` is the copy the
 * client last synced, the version its edit started from (newer apps, items only, once the Worker lists
 * "baseMerge"); with it the server merges field by field ([mergeFields]).
 */
export interface IncomingChange {
  kind: Kind;
  id: string;
  data: PlannerRecord | null;
  base?: PlannerRecord;
  /**
   * "mine": the app typed this while its last sync was out and that reply changed the same field (the
   * app's second round, sent against what it had sent): the typed text stays and the stored one is
   * kept as the copy, instead of the clash rule deciding again.
   */
  keep?: "mine";
}

/** Validates the body of POST /api/sync; returns an error message when it's malformed. */
export function parseSyncBody(input: unknown): { since: number; changes: IncomingChange[] } | string {
  if (input === null || typeof input !== "object") return "Body must be a JSON object";
  const obj = input as Record<string, unknown>;
  const since = obj.since;
  if (typeof since !== "number" || !Number.isInteger(since) || since < 0) return '"since" must be a non-negative integer';
  if (!Array.isArray(obj.changes)) return '"changes" must be an array';
  const changes: IncomingChange[] = [];
  for (const c of obj.changes as unknown[]) {
    if (c === null || typeof c !== "object") return "Each change must be an object";
    const { kind, id, data, base, keep } = c as Record<string, unknown>;
    if (!isKind(kind)) return `Unknown kind "${String(kind)}"`;
    if (typeof id !== "string" || id.length === 0) return "Each change needs a string id";
    if (data !== null && (typeof data !== "object" || Array.isArray(data))) return "data must be an object or null";
    if (data !== null && keyOf(kind, data as PlannerRecord) !== id) return `id "${id}" does not match its ${kind} record`;
    if (data !== null && canonical(data).length > MAX_RECORD_CHARS) return `Too large: ${kind}/${id} is over ${MAX_RECORD_CHARS / 1_000_000} MB`;
    if (base !== undefined && base !== null && (typeof base !== "object" || Array.isArray(base))) return "base must be an object";
    const change: IncomingChange = { kind, id, data: data as PlannerRecord | null };
    if (base && data !== null) {
      change.base = base as PlannerRecord;
      if (keep === "mine") change.keep = "mine";
    }
    changes.push(change);
  }
  return { since, changes };
}

/**
 * The PC app identifies itself as "PC browser", and the training plan's push script as "plan-script";
 * any other named device is the phone.
 */
export function isPhone(device: string | null): boolean {
  return device !== null && device !== "PC browser" && device !== "plan-script";
}

/**
 * Both sides changed the same record since the client last synced: who wins?
 * - An edit beats a delete (nothing a person typed is silently thrown away).
 * - Two edits from different devices: the phone's version wins.
 * - Two edits from the same kind of device of a record that has an `updatedAt` (items, training
 *   entries...): the later one wins.
 * - Anything else: the client that is syncing now wins (it holds the most recent action).
 */
export function clientWins(
  kind: Kind, incoming: PlannerRecord | null, existing: PlannerRecord | null,
  incomingFromPhone = false, existingFromPhone = false,
): boolean {
  if (incoming === null) return existing === null;
  if (existing === null) return true;
  if (incomingFromPhone !== existingFromPhone) return incomingFromPhone;
  if (kind === "items" || (incoming.updatedAt !== undefined && existing.updatedAt !== undefined)) {
    const a = Number(incoming.updatedAt ?? 0);
    const b = Number(existing.updatedAt ?? 0);
    return a >= b;
  }
  return true;
}

/** Image files are named by the SHA-256 of their bytes (64 lowercase hex characters). */
export function isBlobHash(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same protection as [deletionGuard], for a sync that deletes items. */
export function syncDeletionGuard(storedItems: number, deletedItems: number): string | null {
  if (deletedItems === 0) return null;
  return deletionGuard(storedItems, storedItems - deletedItems);
}

/** The fields both sides may change without it being a clash: the later edit time is kept. */
const EDIT_TIME = "updatedAt";
/** A note's clash in one of these keeps the losing side as a conflicted copy ([conflictCopy]). */
export const COPY_FIELDS = ["title", "content"] as const;

const changedFrom = (base: PlannerRecord, r: PlannerRecord, f: string) => canonical(base[f]) !== canonical(r[f]);

/**
 * Three-way merge of one record (item 141): [base] is the copy the client's edit started from,
 * [incoming] the client's version, [existing] the server's. A field only one side changed takes that
 * side's value; a field both changed to different values is a clash, settled by [incomingWins] (the
 * old whole-record rules, [clientWins]), except the edit time, which keeps the later one. An edit beats
 * a trashing: when only one side moved the record to the trash and the other changed its title or
 * content, it stays out of the trash.
 */
export function mergeFields(
  base: PlannerRecord, incoming: PlannerRecord, existing: PlannerRecord, incomingWins: boolean,
): { merged: PlannerRecord; clashes: string[] } {
  const merged: PlannerRecord = {};
  const clashes: string[] = [];
  for (const f of new Set([...Object.keys(base), ...Object.keys(incoming), ...Object.keys(existing)])) {
    const b = canonical(base[f]), i = canonical(incoming[f]), e = canonical(existing[f]);
    let v: unknown;
    if (i === b || i === e) v = existing[f];
    else if (e === b) v = incoming[f];
    else if (f === EDIT_TIME) v = Math.max(Number(incoming[f]) || 0, Number(existing[f]) || 0);
    else { clashes.push(f); v = incomingWins ? incoming[f] : existing[f]; }
    if (v !== undefined) merged[f] = v;
  }
  const trashedBy = (side: PlannerRecord) => base.deletedAt == null && side.deletedAt != null;
  const editedText = (side: PlannerRecord) => COPY_FIELDS.some((f) => changedFrom(base, side, f));
  if (merged.deletedAt != null && base.deletedAt == null &&
      ((trashedBy(existing) && !trashedBy(incoming) && editedText(incoming)) ||
       (trashedBy(incoming) && !trashedBy(existing) && editedText(existing)))) {
    merged.deletedAt = null;
  }
  return { merged, clashes };
}

/** FNV-1a 64-bit over [bytes]. */
function fnv1a64(bytes: Uint8Array): bigint {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h;
}

/**
 * The conflicted copy's id: FNV-1a 64-bit over the note's id and the losing title and content, put in
 * the apps' id range [2^40, 2^53) (like web/src/domain/ids.ts futsalItemId). The same clash sent again
 * (a retry after a lost reply) names the same copy, so it is made once.
 */
export function copyId(noteId: unknown, loser: PlannerRecord): number {
  const lo = 2n ** 40n;
  const text = `${String(noteId)}\u0000${String(loser.title ?? "")}\u0000${String(loser.content ?? "")}`;
  return Number(lo + (fnv1a64(new TextEncoder().encode(text)) % (2n ** 53n - lo)));
}

/** Text with its HTML tags and spaces taken out: what a person would see of it. */
const visible = (v: unknown) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

/**
 * Whether a merge of an item should keep the loser as a copy: a note whose title or content clashed,
 * and whose losing side has something in it.
 */
export function needsCopy(kind: Kind, merged: PlannerRecord, clashes: string[], loser: PlannerRecord): boolean {
  return kind === "items" && merged.type === "NOTE" &&
    clashes.some((f) => (COPY_FIELDS as readonly string[]).includes(f)) &&
    (visible(loser.title) !== "" || visible(loser.content) !== "");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A day number (days since 1970-01-01) as "30 Oct 2026". */
export function dayText(day: number): string {
  const d = new Date(day * 86_400_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The note that keeps the losing side of a clash: the merged note's other fields (its category, look),
 * the loser's title and content, titled "<title> (conflicted copy)", new and unpinned, at the top. A
 * daily note's copy is a plain note (one daily note per day), titled by its date when it had no title.
 */
export function conflictCopy(merged: PlannerRecord, loser: PlannerRecord, id: number, now: number): PlannerRecord {
  const copy: PlannerRecord = { ...merged };
  delete copy.pinOrder;
  delete copy.listOrder;
  delete copy.source;
  const title = String(loser.title ?? "").trim();
  const day = typeof merged.noteDay === "number" ? merged.noteDay : null;
  const name = title || (day !== null ? dayText(day) : "");
  return {
    ...copy,
    id,
    title: name ? `${name} (conflicted copy)` : "Conflicted copy",
    content: loser.content ?? "",
    noteDay: null,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}
