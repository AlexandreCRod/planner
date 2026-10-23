// What kind of item something is, in words, and the kinds Search filters by.
import { formatDate, formatTime } from "../../domain/dates.ts";
import { describe } from "../../domain/recurrence.ts";
import { type Item, isRecurring } from "../../domain/types.ts";
import type { Snapshot } from "../../store/store.ts";
import { count } from "../../domain/plural.ts";

export const typeLabel = (i: Item) =>
  i.type === "TASK" ? (i.freq !== "NONE" ? "Recurring task" : "Task") : i.type === "EVENT" ? (i.freq !== "NONE" ? "Recurring event" : "Event") : i.noteDay !== null ? "Daily note" : "Note";

export const KINDS: [string, string, (i: Item) => boolean][] = [
  ["ALL", "All", () => true],
  ["EVENTS", "Events", (i) => i.type === "EVENT" && !isRecurring(i)],
  ["RECURRING_EVENTS", "Recurring events", (i) => i.type === "EVENT" && isRecurring(i)],
  ["TASKS", "Tasks", (i) => i.type === "TASK" && !isRecurring(i)],
  ["RECURRING_TASKS", "Recurring tasks", (i) => i.type === "TASK" && isRecurring(i)],
  ["NOTES", "Notes", (i) => i.type === "NOTE" && i.noteDay === null],
  ["DAILY_NOTES", "Daily notes", (i) => i.type === "NOTE" && i.noteDay !== null],
];

export function subtitle(i: Item, s: Snapshot) {
  const parts = [typeLabel(i)];
  if (i.noteDay !== null) parts.push(formatDate(i.noteDay));
  else if (isRecurring(i)) parts.push(describe(i));
  else if (i.startDay !== null) parts.push(formatDate(i.startDay) + (i.startMin !== null ? " " + formatTime(i.startMin) : ""));
  const c = i.categoryId !== null ? s.categoryById.get(i.categoryId) : undefined;
  if (c) parts.push(c.name);
  const n = s.neighbours(i.id).size;
  if (n) parts.push(count(n, "link"));
  return parts.join(" · ");
}
