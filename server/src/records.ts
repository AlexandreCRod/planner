// Pure helpers shared by the Durable Object and the tests: how a planner snapshot
// (the same JSON the Android app writes as a backup) maps to individual records.

export const KINDS = [
  "items",
  "completions",
  "reminders",
  "categories",
  "tags",
  "itemTags",
  "links",
  "versions",
] as const;

export type Kind = (typeof KINDS)[number];
export type PlannerRecord = Record<string, unknown>;
export type Snapshot = { version: number; createdAt: number } & { [K in Kind]: PlannerRecord[] };

/** Stable identity of a record within its kind. Join tables have composite keys. */
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

/** Returns the snapshot if it has the expected shape, otherwise an error message. */
export function parseSnapshot(input: unknown): Snapshot | string {
  if (input === null || typeof input !== "object") return "Body must be a JSON object";
  const obj = input as Record<string, unknown>;
  for (const kind of KINDS) {
    const list = obj[kind];
    if (list === undefined) {
      obj[kind] = [];
      continue;
    }
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
