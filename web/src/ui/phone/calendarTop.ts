import { type CalendarRange, rangeShows } from "../../domain/dates.ts";
import { calendarShows } from "../../domain/routines.ts";
import type { Item } from "../../domain/types.ts";
import { type CalFilter, filterShows } from "./calFilter.ts";

/** The calendar's own scrolling lists: the Agenda, and the day's list under Month. */
export const CALENDAR_LISTS = ".p-agenda, .p-dayagenda";

/**
 * The jump to today (the Today button, the T key, a tap on the Calendar tab): the Agenda and Month's day list
 * open at their top again, as when the page was rebuilt (review of 2.10.2, finding 6: in Agenda the tab tap
 * left the list scrolled where it was). The Week and Day grids keep their hour, like Google Calendar's Today.
 */
export function listsToTop(root: Pick<ParentNode, "querySelectorAll"> | null) {
  root?.querySelectorAll<HTMLElement>(CALENDAR_LISTS).forEach((el) => { el.scrollTop = 0; });
}

/**
 * After something is added on [day] (372): the anchor the calendar moves to so that day is on screen (its week in
 * Week, the day in Day and 3-day, its month in Month, its year in Year; the Agenda lists from it when it's
 * earlier), or null when it's on screen already.
 */
export function anchorToShow(range: CalendarRange, anchor: number, day: number, mondayFirst: boolean): number | null {
  if (range === "agenda") return day >= anchor ? null : day;
  return rangeShows(range, anchor, day, mondayFirst) ? null : day;
}

/**
 * Would [item], just added, show in the calendar's [range] as it is now? Not when the filter hides it, nor a
 * routine that Month and Year leave out (or, in the other views, one whose "Show in calendar" is off). Then
 * the calendar doesn't move for it (review of 2.10.4, finding 4).
 */
export function addedShows(range: CalendarRange, item: Item, filter: CalFilter, allRoutines: boolean, byId?: ReadonlyMap<number, Item>): boolean {
  if (!filterShows(filter, item)) return false;
  const month = range === "month" || range === "year";
  return calendarShows(item, allRoutines ? "all" : month ? "none" : "chosen", byId);
}

// The calendar's mover for 372, set while it's built.
let shower: ((item: Item) => void) | null = null;
export const setItemShower = (fn: ((item: Item) => void) | null) => { shower = fn; };
/**
 * Something was just added from the Calendar itself (its + or a tap on its grid) (372): the calendar moves to
 * show it when its day isn't on screen. Adding from Today, Tasks or elsewhere leaves the Calendar where it was
 * (review of 2.10.4, finding 4), so this isn't called then.
 */
export function calendarShowItem(item: Item) {
  shower?.(item);
}
