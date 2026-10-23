// What Today shows beyond the day's own lists: a glance at a day ahead (the phone's Tomorrow, the wide
// window's Next 7 days), and on the phone what folds away (ticked tasks, events already over) so the
// page stays about one screen.
import { toTimestamp } from "./dates.ts";
import { type CompletionIndex, type Occurrence, type TaskEntry, occurrencesIn, tasksOnDay } from "./schedule.ts";
import { withoutRoutines } from "./routines.ts";
import type { Item } from "./types.ts";

/** One line of a day at a glance: an event or an open task, its time (null: untimed), all day or not. */
export interface GlanceRow { key: string; item: Item; min: number | null; allDay: boolean }

/** A day's events and open tasks (no routines) at a glance, in time order: all day first, untimed tasks last. */
export function dayGlance(items: Item[], done: CompletionIndex, day: number, today: number): GlanceRow[] {
  const events = occurrencesIn(items.filter((i) => i.type === "EVENT"), done, day, day)
    .filter((o) => o.day <= day && o.endDay >= day)
    .map((o): GlanceRow => ({ key: `e${o.item.id}`, item: o.item, min: o.timed && o.day === day ? o.startMin : null, allDay: !o.timed || o.day !== day }));
  const tasks = withoutRoutines(tasksOnDay(items, done, day, today)).filter((e) => e.status !== "DONE")
    .map((e): GlanceRow => ({ key: `t${e.item.id}`, item: e.item, min: e.item.startMin, allDay: false }));
  const rank = (g: GlanceRow) => (g.allDay ? -1 : g.min ?? 1e4);
  return [...events, ...tasks].sort((a, b) => rank(a) - rank(b) || a.item.title.localeCompare(b.item.title));
}

/** The [n] days after [day], each at a glance (the wide Today's Next 7 days). */
export function weekAhead(items: Item[], done: CompletionIndex, day: number, today: number, n = 7): { day: number; rows: GlanceRow[] }[] {
  return Array.from({ length: n }, (_, k) => ({ day: day + 1 + k, rows: dayGlance(items, done, day + 1 + k, today) }));
}

/** On today's page, what's behind us: an event that has ended, a timed task ticked once its time came. */
export const eventOver = (o: Occurrence, now: number) => o.timed && toTimestamp(o.endDay, o.endMin ?? o.startMin ?? 0) <= now;
export const taskOver = (e: TaskEntry, now: number) => e.status === "DONE" && e.day !== null && e.item.startMin !== null && toTimestamp(e.day, e.item.startMin) <= now;

/** Today's events split into those already over ("2 earlier · hidden") and the rest (all day, now, later). */
export function foldEvents(events: Occurrence[], now: number): { earlier: Occurrence[]; rest: Occurrence[] } {
  const earlier: Occurrence[] = [], rest: Occurrence[] = [];
  for (const o of events) (eventOver(o, now) ? earlier : rest).push(o);
  return { earlier, rest };
}

/**
 * Today's ticked tasks folded into one line ("2 done · hidden"): the day's ticked tasks, then those ticked
 * today from elsewhere ([also]), each once, leaving out the ones still shown in place ([shown] keys: a
 * task just ticked stays where it was for a moment).
 */
export function foldDone(dayTasks: TaskEntry[], also: TaskEntry[], shown: Set<string>, key: (e: TaskEntry) => string): TaskEntry[] {
  const out: TaskEntry[] = [], seen = new Set(shown);
  for (const e of [...dayTasks.filter((x) => x.status === "DONE"), ...also]) {
    const k = key(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
