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
export const FEATURES = ["anyKind", "maxRecord"] as const;

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

/** One record change sent by a client: `data: null` means the client deleted it. */
export interface IncomingChange {
  kind: Kind;
  id: string;
  data: PlannerRecord | null;
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
    const { kind, id, data } = c as Record<string, unknown>;
    if (!isKind(kind)) return `Unknown kind "${String(kind)}"`;
    if (typeof id !== "string" || id.length === 0) return "Each change needs a string id";
    if (data !== null && (typeof data !== "object" || Array.isArray(data))) return "data must be an object or null";
    if (data !== null && keyOf(kind, data as PlannerRecord) !== id) return `id "${id}" does not match its ${kind} record`;
    if (data !== null && canonical(data).length > MAX_RECORD_CHARS) return `Too large: ${kind}/${id} is over ${MAX_RECORD_CHARS / 1_000_000} MB`;
    changes.push({ kind, id, data: data as PlannerRecord | null });
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
