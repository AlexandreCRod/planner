// The order of the Notes page: pinned notes first, in the order they were dragged into (pinOrder), then
// the rest, most recently edited first. A pinned note that was never placed (pinned on another device, or
// before pin order existed) goes after the placed ones, oldest first, so opening or editing a pinned note
// never moves it.
import type { Item } from "./types.ts";

/** Pinned notes among themselves: by their place, then oldest first. */
export function comparePinned(a: Item, b: Item): number {
  return (a.pinOrder ?? Infinity) - (b.pinOrder ?? Infinity) || a.createdAt - b.createdAt || a.id - b.id;
}

/** The Notes page's order. */
export function sortNotes(notes: readonly Item[]): Item[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.pinned ? comparePinned(a, b) : b.updatedAt - a.updatedAt));
}

/** [ids] with the one at [from] moved to [to]. */
export function moveId(ids: readonly number[], from: number, to: number): number[] {
  const out = [...ids];
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}

/** The pinOrder to write for pinned notes now in the order [ids]: only those whose place changed. */
export function pinOrderChanges(notes: readonly Item[], ids: readonly number[]): { id: number; pinOrder: number }[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out: { id: number; pinOrder: number }[] = [];
  ids.forEach((id, i) => { const n = byId.get(id); if (n && n.pinOrder !== i) out.push({ id, pinOrder: i }); });
  return out;
}
