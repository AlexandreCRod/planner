// What a task row says on its right (226): one status pill, the same rule on Today, Tasks, the to-dos and the
// calendar's lists.
import { dayPill, dueCountdown } from "./dates.ts";
import { type TaskEntry, dueAt } from "./schedule.ts";

/**
 * The one status pill on a task row's right (226), or null: its words, and whether it's a warning (red).
 * [showDay]: the list holds tasks of several days (Tasks), so a task due today says "Today"; on a day's own
 * list (Today, the calendar's day) it says nothing. [underOverdue]: under Today's Overdue heading, where the
 * heading and the red date say it.
 */
export function taskPill(entry: TaskEntry, now: number, showDay: boolean, underOverdue = false, t?: number): { text: string; danger: boolean } | null {
  const { status, day } = entry;
  switch (status) {
    case "OVERDUE": return underOverdue ? null : { text: entry.missed > 1 ? `${entry.missed} missed` : "Overdue", danger: true };
    case "CARRIED": return { text: "Carried over", danger: false };
    case "MISSED": return { text: "Missed", danger: true };
    case "DUE": {
      const due = dueAt(entry);
      if (due !== null) return { text: dueCountdown(due, now), danger: due < now };
      return showDay && day !== null ? { text: dayPill(day, t), danger: false } : null;
    }
    case "UPCOMING": return day !== null ? { text: dayPill(day, t), danger: false } : null;
    default: return null; // done, or a to-do with no date
  }
}
