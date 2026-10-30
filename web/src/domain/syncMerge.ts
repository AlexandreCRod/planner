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
function canonical(v: unknown): string {
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
 * one (a note's conflicted copy).
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
  return { merged, clash };
}
