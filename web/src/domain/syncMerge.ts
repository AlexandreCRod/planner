// What a sync reply may overwrite. A sync takes a copy of the local records, sends the differences and
// applies what comes back; anything typed while that request was out (a note saved a second after a
// keystroke) is newer than the reply and must stay. It's sent by the next sync instead.

export interface RemoteChange<K extends string = string> { kind: K; id: string; data: Record<string, unknown> | null }

/**
 * Splits [changes] into those to apply and the keys ("kind/id") kept because the local record was
 * edited after [sent] was taken ([now] is the local copy as it is now). Records are replaced, never
 * mutated, on every edit, so a different object means an edit.
 */
export function remoteToApply<C extends RemoteChange>(
  changes: C[], sent: ReadonlyMap<string, unknown>, now: ReadonlyMap<string, unknown>,
): { apply: C[]; kept: string[] } {
  const apply: C[] = [], kept: string[] = [];
  for (const c of changes) {
    const key = `${c.kind}/${c.id}`;
    if (sent.get(key) !== now.get(key)) kept.push(key);
    else apply.push(c);
  }
  return { apply, kept };
}

type Rec = Record<string, unknown>;

/** JSON with sorted keys, so field order never counts as a change. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Rec;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return String(JSON.stringify(v));
}

/**
 * A record edited here while a sync was out ([now]), and changed by the reply ([remote]) from what that
 * sync sent ([sent]): item 141. Fields edited here keep this device's value, the reply's other changes
 * come in, and the later edit time is kept. [clash] tells that a field was changed both here and in the
 * reply: the next sync is then sent against [sent], so the Worker sees both sides and keeps the losing
 * one (a note's conflicted copy). An edit beats a trashing: if one side moved it to the trash and the
 * other changed its title or content, it stays out of the trash.
 */
export function mergeEdited(sent: Rec, now: Rec, remote: Rec): { merged: Rec; clash: boolean } {
  const merged: Rec = {};
  let clash = false;
  for (const f of new Set([...Object.keys(sent), ...Object.keys(now), ...Object.keys(remote)])) {
    const s = canonical(sent[f]), n = canonical(now[f]), r = canonical(remote[f]);
    let v: unknown = now[f];
    if (n === s) v = remote[f];
    else if (r !== s && r !== n) {
      if (f === "updatedAt") v = Math.max(Number(now[f]) || 0, Number(remote[f]) || 0);
      else clash = true;
    }
    if (v !== undefined) merged[f] = v;
  }
  const trashed = (r: Rec) => sent.deletedAt == null && r.deletedAt != null;
  const typed = (r: Rec) => ["title", "content"].some((f) => canonical(r[f]) !== canonical(sent[f]));
  if (merged.deletedAt != null && ((trashed(remote) && !trashed(now) && typed(now)) || (trashed(now) && !trashed(remote) && typed(remote)))) {
    merged.deletedAt = null;
  }
  return { merged, clash };
}

/**
 * The synced copy: the server position and every record as last synced, the base each change is
 * compared with. [mine] lists items to send next with keep "mine" (see [settleReply]); older copies
 * have none.
 */
export interface SyncBase { seq: number; records: Record<string, Rec>; mine?: string[] }
export interface SyncChange { kind: string; id: string; data: Rec | null; base?: Rec; keep?: "mine" }

/**
 * What a sync sends: each record that differs from the synced copy (deleted ones as data: null). When
 * the Worker merges ([withBase]), an edited item carries its synced copy as its base, and an item in
 * [SyncBase.mine] says keep "mine". Kinds the Worker doesn't take yet wait; records over [maxChars] are
 * listed in tooLarge instead.
 */
export function outgoingChanges(
  base: SyncBase, local: ReadonlyMap<string, Rec>,
  opts: { withBase: boolean; takes: (kind: string) => boolean; maxChars: number },
): { outgoing: SyncChange[]; tooLarge: string[] } {
  const outgoing: SyncChange[] = [], tooLarge: string[] = [];
  const mine = new Set(base.mine ?? []);
  for (const key of new Set([...Object.keys(base.records), ...local.keys()])) {
    const l = local.get(key), b = base.records[key];
    if (l === undefined && b === undefined) continue;
    const lc = l === undefined ? undefined : canonical(l);
    if (lc !== undefined && b !== undefined && lc === canonical(b)) continue;
    const slash = key.indexOf("/");
    const kind = key.slice(0, slash);
    if (!opts.takes(kind)) continue; // waits here, out of the synced copy, until the Worker takes it
    if (lc !== undefined && lc.length > opts.maxChars) { tooLarge.push(key); continue; }
    const change: SyncChange = { kind, id: key.slice(slash + 1), data: l ?? null };
    if (opts.withBase && kind === "items" && l !== undefined && b !== undefined) {
      change.base = b;
      if (mine.has(key)) change.keep = "mine";
    }
    outgoing.push(change);
  }
  return { outgoing, tooLarge };
}

/**
 * What a sync reply does here: the records to apply, the keys kept because they were edited during the
 * request ([remoteToApply]), and the new synced copy. A kept item takes in the reply's other changes
 * ([mergeEdited]); when a field was changed both here and in the reply, its synced copy stays what this
 * request sent and it goes into [SyncBase.mine], so the next round tells the Worker to keep the typed
 * text and keep the other as the copy (item 141).
 */
export function settleReply(
  base: SyncBase, sent: ReadonlyMap<string, Rec>, now: ReadonlyMap<string, Rec>,
  outgoing: SyncChange[], reply: { seq: number; changes: SyncChange[] },
): { apply: SyncChange[]; kept: string[]; next: SyncBase } {
  const { apply, kept } = remoteToApply(reply.changes, sent, now);
  const keptSet = new Set(kept);
  const againstSent = new Set<string>();
  for (const c of reply.changes) {
    const k = `${c.kind}/${c.id}`, s = sent.get(k), n = now.get(k);
    if (c.kind !== "items" || c.data === null || !s || !n || !keptSet.has(k)) continue;
    const { merged, clash } = mergeEdited(s, n, c.data);
    apply.push({ ...c, data: merged });
    if (clash) againstSent.add(k);
  }
  const records = { ...base.records };
  for (const c of outgoing) { const k = `${c.kind}/${c.id}`; if (c.data === null) delete records[k]; else records[k] = c.data; }
  for (const c of reply.changes) {
    const k = `${c.kind}/${c.id}`;
    if (againstSent.has(k)) records[k] = sent.get(k)!;
    else if (c.data === null) delete records[k];
    else records[k] = c.data;
  }
  const next: SyncBase = { seq: reply.seq, records };
  if (againstSent.size) next.mine = [...againstSent];
  return { apply, kept, next };
}
