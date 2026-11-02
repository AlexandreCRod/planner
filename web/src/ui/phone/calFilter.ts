// The calendar's one filter (287): what the menu's "Filter…" box shows, the same in every view (the Agenda's
// own chips went). While anything is hidden, a "Filtered · Clear" chip shows under the header.
import type { Item } from "../../domain/types.ts";

export interface CalFilter { events: boolean; tasks: boolean; hidden: Set<number> }

export const noFilter = (): CalFilter => ({ events: true, tasks: true, hidden: new Set() });

/**
 * Is anything hidden? A hidden category the app no longer has hides nothing, so it doesn't count
 * ([categories]: the ids there are now).
 */
export function filterOn(f: CalFilter, categories: readonly number[]): boolean {
  return !f.events || !f.tasks || categories.some((c) => f.hidden.has(c));
}

/** Does the calendar show [i] under [f]? Notes are never on it; an item without a category shows by its kind alone. */
export function filterShows(f: CalFilter, i: Item): boolean {
  return ((i.type === "EVENT" && f.events) || (i.type === "TASK" && f.tasks)) && (i.categoryId === null || !f.hidden.has(i.categoryId));
}
