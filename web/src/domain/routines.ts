// Routines: repeating tasks done as a habit (stretch, pills, journal). On Today they have their own short
// checklist instead of mixing with one-off tasks; a day missed doesn't pile up as overdue, it only
// ends the streak. Which tasks are routines is stored apart (store/routines.ts); these are the rules.
import { occursOn, previousBefore } from "./recurrence.ts";
import { type CompletionIndex, type TaskEntry, currentEntry, streak } from "./schedule.ts";
import { type Item, isRecurring } from "./types.ts";

/**
 * Whether [item] counts as a routine: marked as one, and still a repeating task. A mark left on a task
 * that no longer repeats (or was turned into an event, or is in the trash) is ignored.
 */
export function isRoutineItem(item: Item, marked: ReadonlySet<number>): boolean {
  return marked.has(item.id) && item.type === "TASK" && isRecurring(item) && item.startDay !== null && item.deletedAt === null;
}

const byTimeThenTitle = (a: TaskEntry, b: TaskEntry) =>
  (a.item.startMin ?? 1e9) - (b.item.startMin ?? 1e9) || (a.item.title < b.item.title ? -1 : a.item.title > b.item.title ? 1 : 0);

/**
 * The routines due on [day], for Today's checklist: only that day's occurrence of each, never an
 * earlier missed one. DONE when ticked; otherwise DUE, or MISSED for a day that has passed.
 * Sorted by time (untimed last), then title; no grouping by time of day.
 */
export function routinesOnDay(items: Item[], marked: ReadonlySet<number>, done: CompletionIndex, day: number, today: number): TaskEntry[] {
  return items
    .filter((i) => isRoutineItem(i, marked) && occursOn(i, day))
    .map((item): TaskEntry => ({ item, day, status: done.isDone(item.id, day) ? "DONE" : day < today ? "MISSED" : "DUE", missed: 0 }))
    .sort(byTimeThenTitle);
}

/** Today's task lists without the routines (they're in their own section), overdue ones included. */
export function withoutRoutines(entries: TaskEntry[], marked: ReadonlySet<number>): TaskEntry[] {
  return entries.filter((e) => !isRoutineItem(e.item, marked));
}

/**
 * The occurrence a routine's tick box acts on in the task list: today's if it's due today, else the
 * next one. Never a missed day (that's a broken streak, not something still owed).
 */
export function routineEntry(item: Item, done: CompletionIndex, today: number): TaskEntry {
  const e = currentEntry({ ...item, overduePolicy: "SKIP" }, done, today);
  return { ...e, item };
}

export interface RoutineStreak {
  /** Occurrences ticked in a row, up to the latest one; today's, while still open, doesn't end it. */
  current: number;
  best: number;
  /** The last occurrence before today was missed: the streak is broken (today can start a new one). */
  broken: boolean;
}

/** The streak rules for a routine (the same counting as the task history's, plus "broken"). */
export function routineStreak(item: Item, done: CompletionIndex, today: number): RoutineStreak {
  const st = streak(item, done, today);
  const prev = previousBefore(item, today);
  return { current: st.current, best: st.best, broken: prev !== null && !done.isDone(item.id, prev) };
}

/** "3 of 5": routines ticked out of those due on the day. */
export function routineProgress(list: TaskEntry[]): { done: number; total: number } {
  return { done: list.filter((e) => e.status === "DONE").length, total: list.length };
}
