import { DurableObject } from "cloudflare:workers";
import {
  KINDS, type IncomingChange, type Kind, type PlannerRecord, type Snapshot,
  canonical, clientWins, deletionGuard, keyOf, syncDeletionGuard,
} from "./records.ts";

export interface Env {
  PLANNER: DurableObjectNamespace<PlannerStore>;
  API_TOKEN?: string;
}

export type PushResult =
  | { ok: true; seq: number; upserted: number; deleted: number }
  | { ok: false; reason: string };

export type SyncResult =
  | { ok: true; seq: number; applied: number; conflicts: number; changes: Change[] }
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
    `);
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
    };
  }

  /** Makes the stored data match [snapshot]; only records that actually changed get a new seq. */
  async push(snapshot: Snapshot, force: boolean, device: string | null): Promise<PushResult> {
    const storedItems = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM records WHERE kind = 'items' AND deleted = 0")
      .one().n;
    if (!force) {
      const problem = deletionGuard(storedItems, snapshot.items.length);
      if (problem) return { ok: false, reason: problem };
    }

    let upserted = 0;
    let deleted = 0;
    this.ctx.storage.transactionSync(() => {
      let seq = this.seq();
      for (const kind of KINDS) {
        const existing = new Map<string, { data: string | null; deleted: number }>();
        for (const row of this.sql
          .exec<{ id: string; data: string | null; deleted: number }>("SELECT id, data, deleted FROM records WHERE kind = ?", kind)
          .toArray()) {
          existing.set(row.id, { data: row.data, deleted: row.deleted });
        }
        const seen = new Set<string>();
        for (const record of snapshot[kind]) {
          const id = keyOf(kind, record);
          seen.add(id);
          const data = canonical(record);
          const prev = existing.get(id);
          if (prev && prev.deleted === 0 && prev.data === data) continue;
          seq++;
          upserted++;
          this.sql.exec(
            "INSERT OR REPLACE INTO records (kind, id, data, seq, deleted) VALUES (?, ?, ?, ?, 0)",
            kind, id, data, seq,
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

    await this.maybeKeepHistory(snapshot);
    return { ok: true, seq: this.seq(), upserted, deleted };
  }

  /**
   * Two-way sync in one round trip. The client sends what changed on its side since it last saw
   * sequence [since]; the server applies each change unless the same record was changed by another
   * device in the meantime and loses the conflict rules ([clientWins]). The reply holds every record
   * changed since [since] that the client doesn't already have, including server versions that won.
   * Durable Objects handle one request at a time, so nothing can slip in between read and write.
   */
  async sync(since: number, changes: IncomingChange[], force: boolean, device: string | null): Promise<SyncResult> {
    const live = (kind: Kind, id: string) =>
      this.sql
        .exec<{ data: string | null; seq: number; deleted: number }>(
          "SELECT data, seq, deleted FROM records WHERE kind = ? AND id = ?", kind, id,
        )
        .toArray()[0];

    if (!force) {
      const storedItems = this.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM records WHERE kind = 'items' AND deleted = 0")
        .one().n;
      const deletedItems = changes.filter((c) => c.kind === "items" && c.data === null && live("items", c.id)?.deleted === 0).length;
      const problem = syncDeletionGuard(storedItems, deletedItems);
      if (problem) return { ok: false, reason: problem };
    }

    const kept = new Set<string>(); // records where the client's version now stands
    let applied = 0;
    let conflicts = 0;
    this.ctx.storage.transactionSync(() => {
      let seq = this.seq();
      for (const c of changes) {
        const row = live(c.kind, c.id);
        const existing = row && row.deleted === 0 && row.data !== null ? (JSON.parse(row.data) as PlannerRecord) : null;
        if (row && row.seq > since && !clientWins(c.kind, c.data, existing)) {
          conflicts++;
          continue; // the server's newer version goes back to the client below
        }
        kept.add(`${c.kind}\u0000${c.id}`);
        if (c.data === null) {
          if (!existing) continue;
          seq++;
          applied++;
          this.sql.exec("UPDATE records SET data = NULL, deleted = 1, seq = ? WHERE kind = ? AND id = ?", seq, c.kind, c.id);
        } else {
          const data = canonical(c.data);
          if (existing && row!.data === data) continue;
          seq++;
          applied++;
          this.sql.exec(
            "INSERT OR REPLACE INTO records (kind, id, data, seq, deleted) VALUES (?, ?, ?, ?, 0)",
            c.kind, c.id, data, seq,
          );
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

    if (applied > 0) await this.maybeKeepHistory(await this.snapshot());
    return { ok: true, seq: this.seq(), applied, conflicts, changes: missing };
  }

  /** The current data in the same shape the Android app uses for backups. */
  async snapshot(): Promise<Snapshot> {
    const out = { version: 1, createdAt: Date.now(), seq: this.seq() } as Snapshot & { seq: number };
    for (const kind of KINDS) out[kind] = [];
    for (const row of this.sql
      .exec<{ kind: Kind; data: string }>("SELECT kind, data FROM records WHERE deleted = 0 ORDER BY kind, seq")
      .toArray()) {
      out[row.kind]?.push(JSON.parse(row.data));
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

  /** Keeps one compressed full copy per day (last 14), as a safety net against bad pushes. */
  private async maybeKeepHistory(snapshot: Snapshot) {
    const last = this.sql.exec<{ t: number | null }>("SELECT MAX(created_at) AS t FROM history").one().t ?? 0;
    if (Date.now() - last < DAY_MS) return;
    const stream = new Blob([JSON.stringify(snapshot)]).stream().pipeThrough(new CompressionStream("gzip"));
    const gz = await new Response(stream).arrayBuffer();
    if (gz.byteLength > MAX_HISTORY_BYTES) return;
    this.sql.exec("INSERT INTO history (created_at, items, gz) VALUES (?, ?, ?)", Date.now(), snapshot.items.length, gz);
    this.sql.exec(
      "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)",
      HISTORY_KEEP,
    );
  }
}
