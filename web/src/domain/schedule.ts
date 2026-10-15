// Port of app/.../domain/Schedule.kt: occurrences on the calendar, task states, streaks.
import { occurrences as occ, occursOn, nextOnOrAfter, previousBefore } from "./recurrence.ts";
import { addMonths, toTimestamp } from "./dates.ts";
import { type Completion, type Item, NO_DAY, isRecurring } from "./types.ts";

export interface Occurrence {
  item: Item;
  day: number;
  startMin: number | null;
  endDay: number;
  endMin: number | null;
  completed: boolean;
  timed: boolean;
  multiDay: boolean;
  /** A one-time task whose day has passed, shown on today instead (see forCalendar). */
  overdue?: boolean;
}

/** MISSED: not ticked on a day that has passed (Today looking at an earlier day). */
export type TaskStatus = "OVERDUE" | "DUE" | "CARRIED" | "DONE" | "UPCOMING" | "ANYTIME" | "MISSED";
const order = (s: TaskStatus) => ["OVERDUE", "DUE", "CARRIED", "DONE", "UPCOMING", "ANYTIME", "MISSED"].indexOf(s);

export interface TaskEntry {
  item: Item;
  day: number | null;
  status: TaskStatus;
  missed: number;
}

/**
 * Title tie-break by UTF-16 code unit, like Kotlin's String.compareTo on the phone ("B" before "a"),
 * not localeCompare, which depends on the browser's locale.
 */
const byTitle = (a: { item: Item }, b: { item: Item }) => {
  const x = a.item.title, y = b.item.title;
  return x < y ? -1 : x > y ? 1 : 0;
};

export const completionDay = (e: TaskEntry) => e.day ?? NO_DAY;
export const dueAt = (e: TaskEntry) => (e.day !== null && e.item.startMin !== null ? toTimestamp(e.day, e.item.startMin) : null);

export class CompletionIndex {
  private byItem = new Map<number, Set<number>>();
  constructor(list: Completion[]) {
    for (const c of list) {
      let s = this.byItem.get(c.itemId);
      if (!s) this.byItem.set(c.itemId, (s = new Set()));
      s.add(c.day);
    }
  }
  isDone(itemId: number, day: number) { return this.byItem.get(itemId)?.has(day) ?? false; }
  days(itemId: number) { return this.byItem.get(itemId) ?? new Set<number>(); }
}

export function occurrencesIn(items: Item[], done: CompletionIndex, from: number, to: number): Occurrence[] {
  const out: Occurrence[] = [];
  for (const item of items) {
    if (item.type === "NOTE" || item.startDay === null) continue;
    const span = Math.max(0, (item.endDay ?? item.startDay) - item.startDay);
    for (const d of occ(item, from - span, to)) {
      const cday = item.type === "TASK" && !isRecurring(item) ? item.startDay : d;
      const startMin = item.allDay ? null : item.startMin;
      out.push({
        item, day: d, startMin, endDay: d + span, endMin: item.allDay ? null : item.endMin,
        completed: item.type === "TASK" && done.isDone(item.id, cday),
        timed: startMin !== null, multiDay: span > 0,
      });
    }
  }
  return out.sort((a, b) => a.day - b.day || (a.startMin ?? -1) - (b.startMin ?? -1) || byTitle(a, b));
}

/**
 * Occurrences for the calendar: like occurrencesIn, except that an unticked one-time task whose day has
 * passed moves forward to today, untimed (like Google Calendar), unless it's set to be skipped when missed.
 */
export function forCalendar(items: Item[], done: CompletionIndex, from: number, to: number, today: number): Occurrence[] {
  const late = items.filter((i) => i.type === "TASK" && !isRecurring(i) && i.startDay !== null && i.startDay < today &&
    i.overduePolicy !== "SKIP" && !done.isDone(i.id, i.startDay));
  const lateIds = new Set(late.map((i) => i.id));
  const rest = occurrencesIn(items.filter((i) => !lateIds.has(i.id)), done, from, to);
  if (today < from || today > to) return rest;
  const moved = late.map((item): Occurrence => ({ item, day: today, startMin: null, endDay: today, endMin: null, completed: false, timed: false, multiDay: false, overdue: true }));
  return [...moved, ...rest].sort((a, b) => a.day - b.day || (a.startMin ?? -1) - (b.startMin ?? -1) || byTitle(a, b));
}

function missedSince(item: Item, done: CompletionIndex, today: number): number {
  let count = 0;
  let d = previousBefore(item, today);
  while (d !== null && count < 99 && !done.isDone(item.id, d)) {
    count++;
    d = previousBefore(item, d);
  }
  return count;
}

export function entriesFor(item: Item, done: CompletionIndex, today: number): TaskEntry[] {
  const start = item.startDay;
  if (start === null) return done.isDone(item.id, NO_DAY) ? [] : [{ item, day: null, status: "ANYTIME", missed: 0 }];
  if (!isRecurring(item)) {
    const isDone = done.isDone(item.id, start);
    if (start === today) return [{ item, day: start, status: isDone ? "DONE" : "DUE", missed: 0 }];
    if (start > today || isDone) return [];
    if (item.overduePolicy === "SHOW_OVERDUE") return [{ item, day: start, status: "OVERDUE", missed: 1 }];
    if (item.overduePolicy === "CARRY_OVER") return [{ item, day: start, status: "CARRIED", missed: 0 }];
    return [];
  }
  const out: TaskEntry[] = [];
  const todayOcc = occursOn(item, today);
  const prev = previousBefore(item, today);
  if (prev !== null && !done.isDone(item.id, prev)) {
    if (item.overduePolicy === "SHOW_OVERDUE") out.push({ item, day: prev, status: "OVERDUE", missed: missedSince(item, done, today) });
    else if (item.overduePolicy === "CARRY_OVER" && !todayOcc) out.push({ item, day: prev, status: "CARRIED", missed: 0 });
  }
  if (todayOcc) out.push({ item, day: today, status: done.isDone(item.id, today) ? "DONE" : "DUE", missed: 0 });
  return out;
}

/**
 * Tasks scheduled on `day`, ticked or not, for Today looking at a day other than today:
 * MISSED on earlier days, DUE on later ones.
 */
export function tasksOnDay(items: Item[], done: CompletionIndex, day: number, today: number): TaskEntry[] {
  return items
    .filter((i) => i.type === "TASK" && i.startDay !== null && (isRecurring(i) ? occursOn(i, day) : i.startDay === day))
    .map((item): TaskEntry => ({ item, day, status: done.isDone(item.id, day) ? "DONE" : day < today ? "MISSED" : "DUE", missed: 0 }))
    .sort((a, b) => Number(a.status === "DONE") - Number(b.status === "DONE") || b.item.priority - a.item.priority ||
      (a.item.startMin ?? 1e9) - (b.item.startMin ?? 1e9) || byTitle(a, b));
}

/** Tasks ticked during `day` by the clock, whichever occurrence they completed, in the order they were ticked. */
export function tickedDuring(items: Item[], completions: Completion[], day: number): TaskEntry[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const from = toTimestamp(day, 0), to = toTimestamp(day + 1, 0);
  return completions
    .filter((c) => c.completedAt >= from && c.completedAt < to)
    .sort((a, b) => a.completedAt - b.completedAt)
    .flatMap((c): TaskEntry[] => {
      const item = byId.get(c.itemId);
      return item && item.type === "TASK" ? [{ item, day: c.day === NO_DAY ? null : c.day, status: "DONE", missed: 0 }] : [];
    });
}

export function tasksForDay(items: Item[], done: CompletionIndex, today: number): TaskEntry[] {
  return items
    .filter((i) => i.type === "TASK")
    .flatMap((i) => entriesFor(i, done, today))
    .sort((a, b) => order(a.status) - order(b.status) || b.item.priority - a.item.priority ||
      (a.item.startMin ?? 1e9) - (b.item.startMin ?? 1e9) || byTitle(a, b));
}

/** The occurrence a task's checkbox acts on in the task list (overdue > today > next). */
export function currentEntry(item: Item, done: CompletionIndex, today: number): TaskEntry {
  const entries = entriesFor(item, done, today);
  const open = entries.find((e) => e.status !== "DONE");
  if (open) return open;
  if (entries.length) return entries[0];
  if (item.startDay === null) return { item, day: null, status: "DONE", missed: 0 };
  const next = nextOnOrAfter(item, today + 1);
  if (next === null) return { item, day: item.startDay, status: "DONE", missed: 0 };
  // A future occurrence can be ticked early: show it as done so it can also be unticked.
  return { item, day: next, status: done.isDone(item.id, next) ? "DONE" : "UPCOMING", missed: 0 };
}

export interface Streak { current: number; best: number; rate30: number; total: number }

export function streak(item: Item, done: CompletionIndex, today: number): Streak {
  const days = done.days(item.id);
  if (!isRecurring(item) || item.startDay === null) return { current: 0, best: 0, rate30: 0, total: days.size };
  // Three calendar years back, like LocalDate.minusYears(3) on the phone (Feb 29 clamps to Feb 28).
  const list = occ(item, Math.max(item.startDay, addMonths(today, -36)), today);
  let best = 0, run = 0;
  for (const d of list) {
    if (days.has(d)) { run++; best = Math.max(best, run); } else if (d !== today) run = 0;
  }
  let current = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    if (days.has(d)) current++;
    else if (d === today) continue;
    else break;
  }
  const recent = list.filter((d) => d < today || days.has(d)).slice(-30);
  const rate = recent.length ? recent.filter((d) => days.has(d)).length / recent.length : 0;
  return { current, best, rate30: rate, total: days.size };
}
