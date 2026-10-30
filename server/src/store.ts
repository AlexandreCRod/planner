import { DurableObject } from "cloudflare:workers";
import {
  FEATURES, type IncomingChange, type Kind, type PlannerRecord, type Snapshot,
  canonical, clientWins, conflictCopy, copyId, deletionGuard, isPhone, keyOf, kindsIn, mergeFields, needsCopy,
  recordsOf, syncDeletionGuard,
} from "./records.ts";

export interface Env {
  PLANNER: DurableObjectNamespace<PlannerStore>;
  API_TOKEN?: string;
}

export type PushResult =
  | { ok: true; seq: number; upserted: number; deleted: number }
  | { ok: false; reason: string };

export type SyncResult =
  | { ok: true; seq: number; applied: number; conflicts: number; copies: number; changes: Change[]; features: readonly string[] }
  | { ok: false; reason: string };

export interface Change {
  kind: Kind;
  id: string;
  seq: number;
  /** null when the record was deleted. */
  data: PlannerRecord | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_KEEP = 14;
/** SQLite rows in Durable Objects are limited to 2 MB. */
const MAX_HISTORY_BYTES = 1_900_000;
/** Largest image file accepted (the apps shrink photos well below this). */
export const MAX_BLOB_BYTES = 1_900_000;
/** Image files no note refers to are removed after this long (an upload comes just before its record). */
const BLOB_GRACE_MS = 2 * DAY_MS;

/**
 * One instance holds the whole planner. Every record is a row tagged with a sequence number
 * that increases on each change, so other clients (e.g. a future PC app) can ask for
 * "everything that changed since N". Deletions are kept as tombstones for the same reason.
 */
export class PlannerStore extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT,
        seq INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS records_seq ON records (seq);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        items INTEGER NOT NULL,
        gz BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blobs (
        hash TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        data BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    // Which side wrote each record last, so the phone can win conflicts ([clientWins]).
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(records)").toArray();
    if (!columns.some((c) => c.name === "phone")) {
      this.sql.exec("ALTER TABLE records ADD COLUMN phone INTEGER NOT NULL DEFAULT 0");
    }
  }

  private meta(key: string): string | null {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row ? row.value : null;
  }

  private setMeta(key: string, value: string | number) {
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, String(value));
  }

  private seq(): number {
    return Number(this.meta("seq") ?? 0);
  }

  async status() {
    const counts: Record<string, number> = {};
    for (const row of this.sql
      .exec<{ kind: string; n: number }>("SELECT kind, COUNT(*) AS n FROM records WHERE deleted = 0 GROUP BY kind")
      .toArray()) {
      counts[row.kind] = row.n;
    }
    return {
      seq: this.seq(),
      lastPushAt: Number(this.meta("lastPushAt") ?? 0),
      lastDevice: this.meta("lastDevice"),
      counts,
      storageBytes: this.sql.databaseSize,
      features: FEATURES,
    };
  }

  /** Items stored and not in the trash: what the deletion guard protects. */
  private liveItems(): number {
    return this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM records WHERE kind = 'items' AND deleted = 0 AND json_extract(data, '$.deletedAt') IS NULL")
      .one().n;
  }

  /**
   * Makes the stored data match [snapshot] for the kinds it carries (others are left alone); only
   * records that actually changed get a new seq.
   */
  async push(snapshot: Snapshot, force: boolean, device: string | null): Promise<PushResult> {
    const kinds = kindsIn(snapshot);
    if (!force && kinds.includes("items")) {
      const incoming = recordsOf(snapshot, "items").filter((r) => r.deletedAt === null || r.deletedAt === undefined).length;
      const problem = deletionGuard(this.liveItems(), incoming);
      if (problem) return { ok: false, reason: problem };
    }

    let upserted = 0;
    let deleted = 0;
    this.ctx.storage.transactionSync(() => {
      let seq = this.seq();
      for (const kind of kinds) {
        const existing = new Map<string, { data: string | null; deleted: number }>();
        for (const row of this.sql
          .exec<{ id: string; data: string | null; deleted: number }>("SELECT id, data, deleted FROM records WHERE kind = ?", kind)
          .toArray()) {
          existing.set(row.id, { data: row.data, deleted: row.deleted });
        }
        const seen = new Set<string>();
        for (const record of recordsOf(snapshot, kind)) {
          const id = keyOf(kind, record);
          seen.add(id);
          const data = canonical(record);
          const prev = existing.get(id);
          if (prev && prev.deleted === 0 && prev.data === data) continue;
          seq++;
          upserted++;
          this.sql.exec(
            "INSERT OR REPLACE INTO records (kind, id, data, seq, deleted, phone) VALUES (?, ?, ?, ?, 0, ?)",
            kind, id, data, seq, isPhone(device) ? 1 : 0,
          );
        }
        for (const [id, prev] of existing) {
          if (seen.has(id) || prev.deleted === 1) continue;
          seq++;
          deleted++;
          this.sql.exec("UPDATE records SET data = NULL, deleted = 1, seq = ? WHERE kind = ? AND id = ?", seq, kind, id);
        }
      }
      this.setMeta("seq", seq);
      this.setMeta("lastPushAt", Date.now());
      if (device) this.setMeta("lastDevice", device);
    });

    const seq = this.seq();
    await this.maybeKeepHistory();
    return { ok: true, seq, upserted, deleted };
  }

  /**
   * Two-way sync in one round trip. The client sends what changed on its side since it last saw
   * sequence [since]; the server applies each change unless the same record was changed by another
   * device in the meantime and loses the conflict rules ([clientWins]). The reply holds every record
   * changed since [since] that the client doesn't already have, including server versions that won.
   * Durable Objects handle one request at a time, so nothing can slip in between read and write.
   *
   * A change that carries its [IncomingChange.base] (newer apps) is merged field by field with the stored
   * record instead ([mergeFields]), so edits of different fields on two devices both stand. When a note's
   * title or content was changed on both, the losing side is kept as a new "(conflicted copy)" note, made
   * here so every device receives it. The merged record goes back to the client when it differs from
   * what the client sent.
   */
  async sync(since: number, changes: IncomingChange[], force: boolean, device: string | null): Promise<SyncResult> {
    const live = (kind: Kind, id: string) =>
      this.sql
        .exec<{ data: string | null; seq: number; deleted: number; phone: number }>(
          "SELECT data, seq, deleted, phone FROM records WHERE kind = ? AND id = ?", kind, id,
        )
        .toArray()[0];

    if (!force) {
      // Only items that are live and not in the trash count: emptying the trash and the 30-day purge
      // remove items the user already threw away, which is never a mistake to guard against.
      const removesLive = (c: IncomingChange) => {
        if (c.kind !== "items" || c.data !== null) return false;
        const row = live("items", c.id);
        if (!row || row.deleted !== 0 || row.data === null) return false;
        const stored = JSON.parse(row.data) as PlannerRecord;
        return stored.deletedAt === null || stored.deletedAt === undefined;
      };
      const problem = syncDeletionGuard(this.liveItems(), changes.filter(removesLive).length);
      if (problem) return { ok: false, reason: problem };
    }

    const fromPhone = isPhone(device);
    const kept = new Set<string>(); // records where the client's version now stands
    const resend = new Set<string>(); // merged records the client must receive even though their seq is old
    const copies: { merged: PlannerRecord; loser: PlannerRecord }[] = [];
    let applied = 0;
    let conflicts = 0;
    let made = 0;
    this.ctx.storage.transactionSync(() => {
      let seq = this.seq();
      const write = (kind: Kind, id: string, data: string, phone = fromPhone) => {
        seq++;
        applied++;
        this.sql.exec(
          "INSERT OR REPLACE INTO records (kind, id, data, seq, deleted, phone) VALUES (?, ?, ?, ?, 0, ?)",
          kind, id, data, seq, phone ? 1 : 0,
        );
      };
      for (const c of changes) {
        const row = live(c.kind, c.id);
        const existing = row && row.deleted === 0 && row.data !== null ? (JSON.parse(row.data) as PlannerRecord) : null;
        if (c.base && c.data !== null && existing) {
          const wins = c.keep === "mine" || clientWins(c.kind, c.data, existing, fromPhone, row!.phone === 1);
          const { merged, clashes } = mergeFields(c.base, c.data, existing, wins);
          if (clashes.length) conflicts++;
          const loser = wins ? existing : c.data;
          if (needsCopy(c.kind, merged, clashes, loser)) copies.push({ merged, loser });
          const data = canonical(merged);
          // When the stored side won a clash, the record keeps its writer's mark, so the phone still wins later.
          if (data !== row!.data) write(c.kind, c.id, data, clashes.length && !wins ? row!.phone === 1 : fromPhone);
          if (data === canonical(c.data)) kept.add(`${c.kind}\u0000${c.id}`);
          else if (data === row!.data && row!.seq <= since) resend.add(`${c.kind}\u0000${c.id}`);
          continue;
        }
        if (row && row.seq > since && !clientWins(c.kind, c.data, existing, fromPhone, row.phone === 1)) {
          conflicts++;
          continue; // the server's newer version goes back to the client below
        }
        kept.add(`${c.kind}\u0000${c.id}`);
        if (c.data === null) {
          if (!existing) continue;
          seq++;
          applied++;
          this.sql.exec("UPDATE records SET data = NULL, deleted = 1, seq = ?, phone = ? WHERE kind = ? AND id = ?", seq, fromPhone ? 1 : 0, c.kind, c.id);
        } else {
          const data = canonical(c.data);
          if (existing && row!.data === data) continue;
          write(c.kind, c.id, data);
        }
      }
      // The losing sides of note clashes, as new notes with the same tags (read now, after this sync's own
      // tag changes).
      const now = Date.now();
      for (const { merged, loser } of copies) {
        const id = copyId(merged.id, loser);
        if (live("items", String(id))) continue; // made already (a retry), and maybe edited or deleted since
        made++;
        write("items", String(id), canonical(conflictCopy(merged, loser, id, now)));
        for (const t of this.sql
          .exec<{ data: string }>(
            "SELECT data FROM records WHERE kind = 'itemTags' AND deleted = 0 AND json_extract(data, '$.itemId') = ?", Number(merged.id),
          )
          .toArray()) {
          const tag = { ...(JSON.parse(t.data) as PlannerRecord), itemId: id };
          write("itemTags", keyOf("itemTags", tag), canonical(tag));
        }
      }
      this.setMeta("seq", seq);
      if (applied > 0) {
        this.setMeta("lastPushAt", Date.now());
        if (device) this.setMeta("lastDevice", device);
      }
    });

    const missing = this.sql
      .exec<{ kind: Kind; id: string; data: string | null; seq: number }>(
        "SELECT kind, id, data, seq FROM records WHERE seq > ? ORDER BY seq", since,
      )
      .toArray()
      .filter((r) => !kept.has(`${r.kind}\u0000${r.id}`))
      .map((r) => ({ kind: r.kind, id: r.id, seq: r.seq, data: r.data === null ? null : (JSON.parse(r.data) as PlannerRecord) }));
    for (const key of resend) {
      const [kind, id] = key.split("\u0000");
      const row = live(kind, id);
      if (row && row.data !== null) missing.push({ kind, id, seq: row.seq, data: JSON.parse(row.data) as PlannerRecord });
    }

    // The position is taken before anything else can run, so a sync arriving meanwhile can't be skipped.
    const seq = this.seq();
    if (applied > 0) await this.maybeKeepHistory();
    return { ok: true, seq, applied, conflicts, copies: made, changes: missing, features: FEATURES };
  }

  /** The current data in the same shape the Android app uses for backups. */
  async snapshot(): Promise<Snapshot> {
    const out: Snapshot = { version: 1, createdAt: Date.now(), seq: this.seq(), items: [] };
    for (const row of this.sql
      .exec<{ kind: Kind; data: string }>("SELECT kind, data FROM records WHERE deleted = 0 ORDER BY kind, seq")
      .toArray()) {
      ((out[row.kind] ??= []) as PlannerRecord[]).push(JSON.parse(row.data));
    }
    return out;
  }

  async changes(since: number, limit: number): Promise<{ seq: number; more: boolean; changes: Change[] }> {
    const rows = this.sql
      .exec<{ kind: Kind; id: string; data: string | null; seq: number }>(
        "SELECT kind, id, data, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?",
        since, limit + 1,
      )
      .toArray();
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      seq: page.length ? page[page.length - 1].seq : this.seq(),
      more,
      changes: page.map((r) => ({ kind: r.kind, id: r.id, seq: r.seq, data: r.data === null ? null : JSON.parse(r.data) })),
    };
  }

  async history() {
    return this.sql
      .exec<{ id: number; created_at: number; items: number; bytes: number }>(
        "SELECT id, created_at, items, length(gz) AS bytes FROM history ORDER BY id DESC",
      )
      .toArray()
      .map((r) => ({ id: r.id, createdAt: r.created_at, items: r.items, bytes: r.bytes }));
  }

  async historySnapshot(id: number): Promise<string | null> {
    const row = this.sql.exec<{ gz: ArrayBuffer }>("SELECT gz FROM history WHERE id = ?", id).toArray()[0];
    if (!row) return null;
    const stream = new Blob([row.gz]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  /** Stores an image file under its hash; storing the same file again is a no-op. */
  async putBlob(hash: string, mime: string, data: ArrayBuffer): Promise<void> {
    this.sql.exec(
      "INSERT OR IGNORE INTO blobs (hash, mime, data, created_at) VALUES (?, ?, ?, ?)",
      hash, mime, data, Date.now(),
    );
  }

  async getBlob(hash: string): Promise<{ mime: string; data: ArrayBuffer } | null> {
    const row = this.sql.exec<{ mime: string; data: ArrayBuffer }>("SELECT mime, data FROM blobs WHERE hash = ?", hash).toArray()[0];
    return row ? { mime: row.mime, data: row.data } : null;
  }

  /**
   * Removes files no note has referred to for a while. A picture's file is its `hash`; a video's
   * uploaded file is its still, `poster` (the video itself stays on the phone that added it).
   */
  private gcBlobs() {
    this.sql.exec(
      `DELETE FROM blobs WHERE created_at < ? AND hash NOT IN (
         SELECT json_extract(data, '$.hash') FROM records WHERE kind = 'images' AND deleted = 0 AND json_extract(data, '$.hash') IS NOT NULL
         UNION SELECT json_extract(data, '$.poster') FROM records WHERE kind = 'images' AND deleted = 0 AND json_extract(data, '$.poster') IS NOT NULL)`,
      Date.now() - BLOB_GRACE_MS,
    );
  }

  /**
   * Keeps one compressed full copy per day (last 14), as a safety net against bad pushes. The copy is
   * only built when one is due.
   */
  private async maybeKeepHistory() {
    const last = this.sql.exec<{ t: number | null }>("SELECT MAX(created_at) AS t FROM history").one().t ?? 0;
    if (Date.now() - last < DAY_MS) return;
    this.gcBlobs();
    const snapshot = await this.snapshot();
    const stream = new Blob([JSON.stringify(snapshot)]).stream().pipeThrough(new CompressionStream("gzip"));
    const gz = await new Response(stream).arrayBuffer();
    if (gz.byteLength > MAX_HISTORY_BYTES) return;
    this.sql.exec("INSERT INTO history (created_at, items, gz) VALUES (?, ?, ?)", Date.now(), recordsOf(snapshot, "items").length, gz);
    this.sql.exec(
      "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)",
      HISTORY_KEEP,
    );
  }
}
