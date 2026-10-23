// What the home-screen widgets show (web/android/.../widget/): today's tasks with their ticks, and the
// events of the next two weeks, worked out here with the same rules as Today and sent to the phone's
// side, which draws them without this page running. Tomorrow's tasks go too, so the Today widget turns
// over at midnight on its own. Only titles, times, colours and ids leave the page, for the widgets.
import { type CompletionIndex, completionDay, occurrencesIn, tasksForDay } from "./schedule.ts";
import { type Item, displayTitle } from "./types.ts";

export interface WidgetTask { id: number; day: number; title: string; done: boolean; label: string; overdue: boolean; color: string }
export interface WidgetDay { day: number; tasks: WidgetTask[] }
/** endDay/endMin: when it's over, so the widget can drop it during the day (endMin null: at the end of endDay). */
export interface WidgetEvent { id: number; day: number; date: string; time: string; title: string; color: string; endDay: number; endMin: number | null }
export interface WidgetPush { days: WidgetDay[]; events: WidgetEvent[] }

export interface WidgetFormat { time: (min: number) => string; date: (day: number) => string; color: (item: Item) => string }

/** Days of events the Upcoming widget lists, and at most how many. */
const EVENT_DAYS = 14;
const MAX_EVENTS = 20;

export function buildWidgets(items: Item[], done: CompletionIndex, today: number, f: WidgetFormat, carry = true): WidgetPush {
  const dayOf = (t: number): WidgetDay => ({
    day: t,
    tasks: tasksForDay(items, done, t, carry)
      .filter((e) => e.status !== "ANYTIME")
      .map((e) => ({
        id: e.item.id,
        day: completionDay(e),
        title: displayTitle(e.item),
        done: e.status === "DONE",
        label: e.status === "OVERDUE" ? "Overdue" : e.status === "CARRIED" ? "Carried over" : e.item.startMin !== null ? f.time(e.item.startMin) : "",
        overdue: e.status === "OVERDUE",
        color: f.color(e.item),
      })),
  });
  const events = occurrencesIn(items.filter((i) => i.type === "EVENT"), done, today, today + EVENT_DAYS)
    .filter((o) => o.day >= today)
    .sort((a, b) => a.day - b.day || (a.startMin ?? -1) - (b.startMin ?? -1))
    .slice(0, MAX_EVENTS)
    .map((o) => ({ id: o.item.id, day: o.day, date: f.date(o.day), time: o.timed && o.startMin !== null ? f.time(o.startMin) : "All day", title: displayTitle(o.item), color: f.color(o.item),
      endDay: o.endDay, endMin: o.timed ? (o.endMin ?? o.startMin) : null }));
  return { days: [dayOf(today), dayOf(today + 1)], events };
}
