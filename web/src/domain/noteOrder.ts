// The order of the Notes page: pinned notes first, in the order they were dragged into (pinOrder), then
// the rest, most recently edited first. A pinned note that was never placed (pinned on another device, or
// before pin order existed) goes after the placed ones, oldest first, so opening or editing a pinned note
// never moves it. An unpinned note dragged into a place (2.4) keeps it as its listOrder, a value on the
// scale of edit times between its new neighbours' (so only that note is saved), and stays there; the
// others still go by their last edit. Also the grid itself: two columns, each card under the shorter one.
import type { Item } from "./types.ts";

/** Pinned notes among themselves: by their place, then oldest first. */
export function comparePinned(a: Item, b: Item): number {
  return (a.pinOrder ?? Infinity) - (b.pinOrder ?? Infinity) || a.createdAt - b.createdAt || a.id - b.id;
}

/** Where an unpinned note goes: its dragged place, else its last edit (higher first). */
export const listKey = (n: Item) => n.listOrder ?? n.updatedAt;

/** The Notes page's order. */
export function sortNotes(notes: readonly Item[]): Item[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.pinned ? comparePinned(a, b) : listKey(b) - listKey(a) || b.id - a.id));
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

/**
 * The listOrder to write when the unpinned note [moved] was dropped where it is in [ids] (the page's
 * order): between its new neighbours' places, so only it changes. With no room between them (two
 * notes with the same place), every unpinned note shown gets one, a step apart from the top one down.
 */
export function listOrderChanges(notes: readonly Item[], ids: readonly number[], moved: number): { id: number; listOrder: number }[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const list = ids.map((id) => byId.get(id)).filter((n): n is Item => !!n && !n.pinned);
  const i = list.findIndex((n) => n.id === moved);
  if (i < 0 || list.length < 2) return [];
  const above = list[i - 1], below = list[i + 1];
  if (!above) return [{ id: moved, listOrder: listKey(below) + 1 }];
  if (!below) return [{ id: moved, listOrder: listKey(above) - 1 }];
  const a = listKey(above), b = listKey(below), mid = (a + b) / 2;
  if (a > mid && mid > b) return [{ id: moved, listOrder: mid }];
  const top = listKey(list[0]);
  return list.map((n, k) => ({ id: n.id, listOrder: top - k })).filter((c) => byId.get(c.id)!.listOrder !== c.listOrder);
}

/** A card's place in the grid: its top-left corner (px from the grid's) and its size. */
export interface Slot { x: number; y: number; w: number; h: number }

/**
 * The Notes grid: two columns [gap] apart in [width], each card (of [heights], in the page's order)
 * going under the shorter column, the left one on a tie. Returns each card's slot and the grid's height.
 */
export function noteSlots(heights: readonly number[], width: number, gap: number): { slots: Slot[]; height: number } {
  const w = Math.max(0, (width - gap) / 2);
  const col = [0, 0];
  const slots = heights.map((h): Slot => {
    const c = col[0] <= col[1] ? 0 : 1;
    const s = { x: c * (w + gap), y: col[c], w, h };
    col[c] += h + gap;
    return s;
  });
  return { slots, height: Math.max(0, Math.max(col[0], col[1]) - gap) };
}

/** Whether the point is in the slot. */
export const inSlot = (s: Slot, x: number, y: number) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
