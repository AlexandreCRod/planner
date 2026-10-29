// The order of the to-dos (tasks with no date), 241: a to-do dragged into a place keeps it as its
// listOrder (the field notes use for theirs: the record syncs whole, so older apps keep it too), a
// number between its new neighbours' keys, so one drag saves one to-do. A to-do never dragged goes by
// the order there was before: priority (high first), then the newest first. Its key is that order as
// one number (each priority level a step far above any creation time), so the two kinds mix.
import type { Item } from "./types.ts";

/** One priority level, far above any creation time (ms; about 300 years). */
const PRIORITY_STEP = 1e13;

/** Where a to-do goes (higher first): its dragged place, else its priority and creation time. */
export const todoKey = (t: Item) => t.listOrder ?? t.priority * PRIORITY_STEP + t.createdAt;

/** The to-dos in their order. */
export function sortTodos(todos: readonly Item[]): Item[] {
  return [...todos].sort((a, b) => todoKey(b) - todoKey(a) || b.id - a.id);
}

/**
 * The listOrder to write when the to-do [moved] was dropped where it is in [ids] (the list's new
 * order): between its new neighbours' keys, so only it changes. With no room between them (two
 * to-dos with the same key), every to-do shown gets one, a step apart from the top one down.
 */
export function todoOrderChanges(todos: readonly Item[], ids: readonly number[], moved: number): { id: number; listOrder: number }[] {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const list = ids.map((id) => byId.get(id)).filter((t): t is Item => !!t);
  const i = list.findIndex((t) => t.id === moved);
  if (i < 0 || list.length < 2) return [];
  const above = list[i - 1], below = list[i + 1];
  if (!above) return [{ id: moved, listOrder: todoKey(below) + 1 }];
  if (!below) return [{ id: moved, listOrder: todoKey(above) - 1 }];
  const a = todoKey(above), b = todoKey(below), mid = (a + b) / 2;
  if (a > mid && mid > b) return [{ id: moved, listOrder: mid }];
  const top = todoKey(list[0]);
  return list.map((t, k) => ({ id: t.id, listOrder: top - k })).filter((c) => byId.get(c.id)!.listOrder !== c.listOrder);
}
