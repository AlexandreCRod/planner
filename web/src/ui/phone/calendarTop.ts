import { type CalendarRange, rangeShows } from "../../domain/dates.ts";

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

// The calendar's mover for 372, set while it's built; a day asked for before that waits for it.
let shower: ((day: number) => void) | null = null;
let pendingDay: number | null = null;
export const setDayShower = (fn: ((day: number) => void) | null) => { shower = fn; };
/** Something was just added on [day] (372): the calendar moves to show it, now or when it's next built. */
export function calendarShowDay(day: number) {
  if (shower) shower(day);
  else pendingDay = day;
}
/** The day asked for while the calendar wasn't built, once. */
export function takePendingDay(): number | null {
  const d = pendingDay;
  pendingDay = null;
  return d;
}
