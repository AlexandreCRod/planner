// How long things stay: deleted items wait in the trash for 30 days, whatever they are, and a ticked
// to-do (a task with no date) stays in the Completed list for two days before it moves to the trash
// itself. A note's history keeps its versions for 30 days, and always its 3 newest. Pure rules, used by
// the store and checked by test/retention.test.ts.
import { type Completion, type Item, type ItemType, type NoteVersion, NO_DAY } from "./types.ts";

/** Days anything stays in the trash (tasks, events and notes alike). */
export const TRASH_DAYS = 30;
export const TASK_EVENT_DAYS = TRASH_DAYS;
export const NOTE_DAYS = TRASH_DAYS;
export const DONE_TODO_HOURS = 48;
/** Days a note's saved versions are kept, and how many of its newest are kept whatever their age. */
export const VERSION_DAYS = 30;
export const VERSIONS_ALWAYS_KEPT = 3;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const keepDays = (type: ItemType) => (type === "NOTE" ? NOTE_DAYS : TASK_EVENT_DAYS);

export const RETENTION_TEXT = `Everything stays in the trash for ${TRASH_DAYS} days, then it's deleted for good.`;

/** Ids of trashed items whose time in the trash is up at [now]. */
export function expiredTrash(items: Item[], now: number): number[] {
  const out: number[] = [];
  for (const i of items) if (i.deletedAt !== null && now - i.deletedAt >= keepDays(i.type) * DAY_MS) out.push(i.id);
  return out;
}

/**
 * Ticked to-dos that have been done for [DONE_TODO_HOURS] at [now], with the moment they move to the
 * trash (the tick plus 48 hours, so their trash time counts from then even if the app was closed).
 */
export function doneTodosToTrash(items: Item[], completions: Completion[], now: number): { id: number; deletedAt: number }[] {
  const doneAt = new Map<number, number>();
  for (const c of completions) if (c.day === NO_DAY) doneAt.set(c.itemId, c.completedAt);
  const out: { id: number; deletedAt: number }[] = [];
  for (const i of items) {
    if (i.type !== "TASK" || i.startDay !== null || i.deletedAt !== null) continue;
    const at = doneAt.get(i.id);
    if (at !== undefined && now - at >= DONE_TODO_HOURS * HOUR_MS) out.push({ id: i.id, deletedAt: at + DONE_TODO_HOURS * HOUR_MS });
  }
  return out;
}

/**
 * Note versions to delete at [now]: those older than [VERSION_DAYS], except each note's
 * [VERSIONS_ALWAYS_KEPT] newest, which stay however old they are (a note left alone keeps its last few).
 */
export function staleVersions(versions: NoteVersion[], now: number): number[] {
  const byNote = new Map<number, NoteVersion[]>();
  for (const v of versions) {
    const list = byNote.get(v.itemId);
    if (list) list.push(v); else byNote.set(v.itemId, [v]);
  }
  const out: number[] = [];
  for (const list of byNote.values()) {
    list.sort((a, b) => b.savedAt - a.savedAt);
    list.forEach((v, i) => { if (i >= VERSIONS_ALWAYS_KEPT && now - v.savedAt > VERSION_DAYS * DAY_MS) out.push(v.id); });
  }
  return out;
}
