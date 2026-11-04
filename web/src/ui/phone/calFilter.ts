// The calendar's one filter (287): what the menu's "Filter…" box shows, the same in every view (the Agenda's
// own chips went). While anything is hidden, a "Filtered · Clear" chip shows under the header.
import type { Item } from "../../domain/types.ts";

/** [hideUncategorised]: things with no category are hidden too (the box's "No category" row, and "Only this"). */
export interface CalFilter { events: boolean; tasks: boolean; hidden: Set<number>; hideUncategorised?: boolean }

export const noFilter = (): CalFilter => ({ events: true, tasks: true, hidden: new Set() });

/**
 * The box's "Only this" beside a category (210's doubt, approved): just that category shows, as the Agenda's
 * old one-category chip did; things with no category hide too. Events and Tasks stay as they were.
 */
export function onlyCategory(f: CalFilter, id: number, categories: readonly number[]): CalFilter {
  return { ...f, hidden: new Set(categories.filter((c) => c !== id)), hideUncategorised: true };
}

/**
 * Is anything hidden? A hidden category the app no longer has hides nothing, so it doesn't count
 * ([categories]: the ids there are now).
 */
export function filterOn(f: CalFilter, categories: readonly number[]): boolean {
  return !f.events || !f.tasks || !!f.hideUncategorised || categories.some((c) => f.hidden.has(c));
}

/** Does the calendar show [i] under [f]? Notes are never on it; an item without a category shows unless "No category" is unticked. */
export function filterShows(f: CalFilter, i: Item): boolean {
  return ((i.type === "EVENT" && f.events) || (i.type === "TASK" && f.tasks)) && (i.categoryId === null ? !f.hideUncategorised : !f.hidden.has(i.categoryId));
}
