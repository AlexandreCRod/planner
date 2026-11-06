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
