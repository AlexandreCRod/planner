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
