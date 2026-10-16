// Picking several things at once (notes, search results): the pure part, kept apart for the tests.

/** [ids] with [id] added, or taken out if it was there. */
export function toggleId(ids: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(ids);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** [ids] without those no longer shown; the same set when nothing went. */
export function keepShown(ids: ReadonlySet<number>, shown: readonly number[]): ReadonlySet<number> {
  if (ids.size === 0) return ids;
  const visible = new Set(shown);
  const next = new Set([...ids].filter((id) => visible.has(id)));
  return next.size === ids.size ? ids : next;
}

/** "Select all" picks everything shown (keeping the choice as it is when nothing is shown). */
export function selectAll(ids: ReadonlySet<number>, shown: readonly number[]): ReadonlySet<number> {
  return shown.length > 0 ? new Set(shown) : ids;
}
