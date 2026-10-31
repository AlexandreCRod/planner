// What the ringing screen's "Today" card shows (246): the day's timed events, and how many routines and
// tasks are still to do. Worked out here and handed to the alarm engine for the days ahead, since an alarm
// rings with this page closed (and the engine only knows items that have reminders). Kotlin adds what rings
// later and picks what's still to come. Only titles and start times leave the page.
import { type CompletionIndex, occurrencesIn, tasksForDay } from "./schedule.ts";
import { isRoutineItem, routinesOnDay, withoutRoutines } from "./routines.ts";
import { type Item, displayTitle } from "./types.ts";

export interface AgendaEvent { min: number; title: string }
export interface AgendaDay { day: number; events: AgendaEvent[]; routines: number; tasks: number }

/** Days ahead the engine keeps (the phone may stay untouched for days). */
const AGENDA_DAYS = 7;
/** Enough for the first one still to come when the alarm rings. */
const EVENTS_PER_DAY = 5;

export function buildAgenda(items: Item[], done: CompletionIndex, today: number, carry = true): AgendaDay[] {
  const events = items.filter((i) => i.type === "EVENT" && !isRoutineItem(i));
  return Array.from({ length: AGENDA_DAYS }, (_, i): AgendaDay => {
    const day = today + i;
    return {
      day,
      events: occurrencesIn(events, done, day, day).filter((o) => o.day === day && o.timed).slice(0, EVENTS_PER_DAY)
        .map((o) => ({ min: o.startMin as number, title: displayTitle(o.item) })),
      routines: routinesOnDay(items, done, day, today).filter((e) => e.status !== "DONE").length,
      tasks: withoutRoutines(tasksForDay(items, done, day, carry)).filter((e) => e.status === "DUE" || e.status === "OVERDUE" || e.status === "CARRIED").length,
    };
  });
}
