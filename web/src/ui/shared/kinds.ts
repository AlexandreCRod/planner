// What kind of item something is, in words, and the kinds Search filters by.
import { formatDate, formatTime } from "../../domain/dates.ts";
import { describe } from "../../domain/recurrence.ts";
import { type Item, isRecurring } from "../../domain/types.ts";
import type { Snapshot } from "../../store/store.ts";
import { count } from "../../domain/plural.ts";
import { isRoutineItem } from "../../domain/routines.ts";

/** A routine (task or event) is "Routine" wherever it's named (341, 286), never "Recurring task". */
export const typeLabel = (i: Item) =>
  isRoutineItem(i) ? "Routine"
  : i.type === "TASK" ? (i.freq !== "NONE" ? "Recurring task" : "Task") : i.type === "EVENT" ? (i.freq !== "NONE" ? "Recurring event" : "Event") : i.noteDay !== null ? "Daily note" : "Note";

/** Search's kind chips: each item is in one of them (a routine only in Routines, 341). */
export const KINDS: [string, string, (i: Item) => boolean][] = [
  ["ALL", "All", () => true],
  ["EVENTS", "Events", (i) => i.type === "EVENT" && !isRecurring(i) && !isRoutineItem(i)],
  ["RECURRING_EVENTS", "Recurring events", (i) => i.type === "EVENT" && isRecurring(i) && !isRoutineItem(i)],
  ["TASKS", "Tasks", (i) => i.type === "TASK" && !isRecurring(i) && !isRoutineItem(i)],
  ["ROUTINES", "Routines", (i) => isRoutineItem(i)],
  ["RECURRING_TASKS", "Recurring tasks", (i) => i.type === "TASK" && isRecurring(i) && !isRoutineItem(i)],
  ["NOTES", "Notes", (i) => i.type === "NOTE" && i.noteDay === null],
  ["DAILY_NOTES", "Daily notes", (i) => i.type === "NOTE" && i.noteDay !== null],
];

/**
 * Training's kind in Search (343, one search button): the plan's sessions, exercises and the words in its
 * documents. Not an item kind (they aren't items), so it's apart from KINDS.
 */
export const TRAINING_KIND = "TRAINING";
/** The kinds Search starts with when opened from a page: that page's own (none: All). */
export const PAGE_KINDS: Record<string, string[]> = {
  notes: ["NOTES"],
  tasks: ["TASKS", "ROUTINES", "RECURRING_TASKS"],
  calendar: ["EVENTS", "RECURRING_EVENTS", "ROUTINES"],
  training: [TRAINING_KIND],
};
/**
 * The kinds a route asks for ([initial], "a,b"), else the page's ([from]): only real kinds, never All. Training
 * only with a plan ([hasPlan]): without one its chip doesn't show, so a filter on it would find nothing, unseen.
 */
export function startKinds(initial: string, from: string, hasPlan = true): Set<string> {
  const known = (k: string) => (k === TRAINING_KIND ? hasPlan : KINDS.some(([x]) => x === k && x !== "ALL"));
  return new Set((initial ? initial.split(",") : PAGE_KINDS[from] ?? []).filter(known));
}
/** What Search lists for the picked kinds (none picked: All, both): the items, the training plan's hits, or both. */
export function searchParts(kinds: ReadonlySet<string>): { items: boolean; training: boolean } {
  if (kinds.size === 0) return { items: true, training: true };
  return { items: [...kinds].some((k) => k !== TRAINING_KIND), training: kinds.has(TRAINING_KIND) };
}

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

/**
 * Search's empty block: "Nothing found" once words are typed or a kind, category or tag chip is picked
 * (review of 2.10, finding 8), with a hint that fits; "Nothing here yet" only with nothing asked.
 */
export function searchEmpty(text: string, chipPicked: boolean): { title: string; hint: string } {
  if (text.trim()) return { title: "Nothing found", hint: "Try other words or fewer filters" };
  if (chipPicked) return { title: "Nothing found", hint: "Try fewer filters" };
  return { title: "Nothing here yet", hint: "What you add shows up here" };
}
