// Port of app/.../domain/Schedule.kt: occurrences on the calendar, task states, streaks.
import { occurrences as occ, occursOn, nextOnOrAfter, previousBefore } from "./recurrence.ts";
import { toTimestamp } from "./dates.ts";
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
}

export type TaskStatus = "OVERDUE" | "DUE" | "CARRIED" | "DONE" | "UPCOMING" | "ANYTIME";
const order = (s: TaskStatus) => ["OVERDUE", "DUE", "CARRIED", "DONE", "UPCOMING", "ANYTIME"].indexOf(s);

export interface TaskEntry {
  item: Item;
  day: number | null;
  status: TaskStatus;
  missed: number;
}

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
  return out.sort((a, b) => a.day - b.day || (a.startMin ?? -1) - (b.startMin ?? -1) || a.item.title.localeCompare(b.item.title));
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

export function tasksForDay(items: Item[], done: CompletionIndex, today: number): TaskEntry[] {
  return items
    .filter((i) => i.type === "TASK")
    .flatMap((i) => entriesFor(i, done, today))
    .sort((a, b) => order(a.status) - order(b.status) || b.item.priority - a.item.priority ||
      (a.item.startMin ?? 1e9) - (b.item.startMin ?? 1e9) || a.item.title.localeCompare(b.item.title));
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
  const list = occ(item, Math.max(item.startDay, today - 3 * 366), today);
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
