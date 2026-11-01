// The number on Today's to-dos button (304). It counts only the to-dos at the highest priority level
// present, in that level's flag colour; a to-do with no priority never counts. Clearing it notes every
// to-do's priority at that moment: from then on only what's new counts, a to-do that wasn't there or
// one whose priority has gone up since, by the same rule. The note syncs (store/todoNumber.ts).

/** What the rules read of a to-do. */
export interface TodoPriority { id: number; priority: number }

/** What the clearing noted: the priority of each to-do that had one, by id. */
export type ClearedTodos = Record<string, number>;

/** The number to show: how many, and the priority level they're at. */
export interface TodoNumber { count: number; level: number }

/** The number for [open] (the to-dos not yet done), counting only what's new since [cleared], if it was cleared. Null: no number. */
export function todoNumber(open: readonly TodoPriority[], cleared: ClearedTodos | null): TodoNumber | null {
  const counted = open.filter((t) => t.priority > (cleared?.[t.id] ?? 0));
  if (!counted.length) return null;
  const level = Math.max(...counted.map((t) => t.priority));
  return { count: counted.filter((t) => t.priority === level).length, level };
}

/** A task with no date is a to-do, ticked or in the trash too. */
export const isTodo = (i: { type: string; startDay: number | null }) => i.type === "TASK" && i.startDay === null;

/**
 * What clearing notes. [todos] are all of them, not only the open ones: one ticked or in the trash when
 * the number was cleared and brought back later isn't new.
 */
export function clearedNow(todos: readonly TodoPriority[]): ClearedTodos {
  const cleared: ClearedTodos = {};
  for (const t of todos) if (t.priority > 0) cleared[t.id] = t.priority;
  return cleared;
}
