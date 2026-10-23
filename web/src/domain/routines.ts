// Routines: repeating tasks done as a habit (stretch, pills, journal), or repeating events kept as one
// (gym, swimming lessons). On Today they have their own short checklist instead of mixing with one-off
// tasks; a day missed doesn't pile up as overdue, it only ends the streak. An item is one when its
// synced `routine` field is set; these are the rules.
import { describe, nextOnOrAfter, occursOn, previousBefore } from "./recurrence.ts";
import { type CompletionIndex, type TaskEntry, currentEntry, streak } from "./schedule.ts";
import { type Item, isRecurring } from "./types.ts";

/**
 * Whether [item] counts as a routine: marked as one, and still a repeating task or event, or one day of
 * a routine changed on its own (a copy with the series as parent, which doesn't repeat itself). A mark
 * left on one that no longer repeats (or was turned into a note, or is in the trash) is ignored.
 */
export function isRoutineItem(item: Item): boolean {
  return item.routine === true && (item.type === "TASK" || item.type === "EVENT") && (isRecurring(item) || item.parentId !== null) &&
    item.startDay !== null && item.deletedAt === null;
}

/** A routine itself (the repeating one), not one of its days changed on its own: for lists and streaks. */
export function isRoutineSeries(item: Item): boolean {
  return isRoutineItem(item) && isRecurring(item);
}

/** The routine a day belongs to: the series for one of its days changed on its own, else [item] itself. */
export function routineSeriesOf(item: Item, byId: ReadonlyMap<number, Item>): Item {
  return !isRecurring(item) && item.parentId !== null ? byId.get(item.parentId) ?? item : item;
}

/** Whether a task or event can carry the routine mark: one that repeats, or a single changed day of one. */
export function canBeRoutine(item: Pick<Item, "type" | "freq" | "parentId">): boolean {
  return (item.type === "TASK" || item.type === "EVENT") && (item.freq !== "NONE" || item.parentId !== null);
}

/**
 * The one-time move of the phone's old device-only marks (a list of ids) into the synced field: the
 * items to save with `routine: true`. Marks on items this copy doesn't have were for items deleted for
 * good, so they're dropped; nothing is marked twice, so running it again changes nothing.
 */
export function itemsToMarkAsRoutines(allItems: Item[], marks: Iterable<number>): Item[] {
  const ids = new Set(marks);
  return allItems.filter((i) => ids.has(i.id) && i.routine !== true).map((i) => ({ ...i, routine: true }));
}

const byTimeThenTitle = (a: TaskEntry, b: TaskEntry) =>
  (a.item.startMin ?? 1e9) - (b.item.startMin ?? 1e9) || (a.item.title < b.item.title ? -1 : a.item.title > b.item.title ? 1 : 0);

/**
 * The routines due on [day], for Today's checklist: only that day's occurrence of each, never an
 * earlier missed one. DONE when ticked; otherwise DUE, or MISSED for a day that has passed.
 * Sorted by time (untimed last), then title; no grouping by time of day.
 */
export function routinesOnDay(items: Item[], done: CompletionIndex, day: number, today: number): TaskEntry[] {
  return items
    .filter((i) => isRoutineItem(i) && occursOn(i, day))
    .map((item): TaskEntry => ({ item, day, status: done.isDone(item.id, day) ? "DONE" : day < today ? "MISSED" : "DUE", missed: 0 }))
    .sort(byTimeThenTitle);
}

/** Today's task lists without the routines (they're in their own section), overdue ones included. */
export function withoutRoutines(entries: TaskEntry[]): TaskEntry[] {
  return entries.filter((e) => !isRoutineItem(e.item));
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

/** A routine in the list of them all: how it repeats, where it stands today, its streak. */
export interface RoutineRow {
  item: Item;
  repeat: string;
  /** done or due today, or not on today (then [next] is its next day, if any). */
  today: "done" | "due" | "off";
  next: number | null;
  streak: RoutineStreak;
}

/** Every routine, for the list opened from Today's chips: by time (untimed last), then title. */
export function routineList(items: Item[], done: CompletionIndex, today: number): RoutineRow[] {
  return items
    .filter((i) => isRoutineSeries(i))
    .map((item): RoutineRow => {
      const on = occursOn(item, today);
      return {
        item,
        repeat: describe(item),
        today: on ? (done.isDone(item.id, today) ? "done" : "due") : "off",
        next: on ? today : nextOnOrAfter(item, today + 1),
        streak: routineStreak(item, done, today),
      };
    })
    .sort((a, b) => (a.item.startMin ?? 1e9) - (b.item.startMin ?? 1e9) || (a.item.title < b.item.title ? -1 : a.item.title > b.item.title ? 1 : 0));
}

/** "3 of 5": routines ticked out of those due on the day. */
export function routineProgress(list: TaskEntry[]): { done: number; total: number } {
  return { done: list.filter((e) => e.status === "DONE").length, total: list.length };
}
