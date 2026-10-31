// The rules for an item's reminders that the editors and rows share: what a new item starts with, and
// which kind of reminder a row's small icon shows. Pure, checked by test/reminders.test.ts.
import type { AlertType, Item, ItemType, Reminder } from "./types.ts";

/** How long before a timed item its first reminder comes. */
export const DEFAULT_REMINDER_MIN = 30;

/** Notifications follow the kind of item: popping up for an event, silent for a task. */
export const defaultAlert = (type: ItemType): AlertType => (type === "EVENT" ? "REMINDER" : "NOTIFICATION");

/** Whether the item has a time of day (not untimed, not all day). */
export const isTimed = (item: Item) => !item.allDay && item.startMin !== null;

/** The first offset a new reminder gets: 30 minutes before a timed item, at the default time on the day otherwise. */
export const defaultOffset = (item: Item) => (isTimed(item) ? DEFAULT_REMINDER_MIN : 0);

/**
 * The reminders a new item starts with: none without a date; otherwise one, 30 minutes before a timed
 * task or event, or at the day's default time for an untimed one.
 */
export function firstReminders(item: Item): Reminder[] {
  if (item.startDay === null || item.type === "NOTE") return [];
  return [{ id: 0, itemId: 0, offsetMin: defaultOffset(item), type: defaultAlert(item.type), soundUri: null }];
}

/** Whether [list] is still exactly what [item] would start with (so it can follow the item's new time). */
export function isDefaultReminders(list: Reminder[], item: Item): boolean {
  const def = firstReminders(item);
  return list.length === def.length && list.every((r, i) => r.offsetMin === def[i].offsetMin && r.type === def[i].type && !r.soundUri);
}

/**
 * A new item's reminders after its date or time changed from [before] to [after]: while they're still
 * the untouched defaults they follow (a time added means 30 minutes before); once changed, they stay.
 */
export function followDefaults(list: Reminder[], before: Item, after: Item): Reminder[] {
  if (before.startDay === after.startDay && isTimed(before) === isTimed(after) && before.type === after.type) return list;
  return isDefaultReminders(list, before) ? firstReminders(after) : list;
}

// ---------- Wake-up alarms on an event (245) ----------

/** "Start 2 h before, every 10 min, 4 alarms". Saved as one wake reminder per alarm, so each moves with the event. */
export interface WakePlan { before: number; every: number; count: number }

export const WAKE_START: WakePlan = { before: 120, every: 10, count: 4 };
const WAKE_MAX = 12;

/** The most alarms that fit: at most [WAKE_MAX], and none after the event starts. */
export const wakeMax = (before: number, every: number) => Math.max(2, Math.min(WAKE_MAX, Math.floor(before / Math.max(1, every)) + 1));

/** [p] as it can ring: never further apart than the start is from the event, so the last alarm is at the start at the latest. */
export function fitWake(p: WakePlan): WakePlan {
  const every = Math.max(1, Math.min(p.every, p.before));
  return { before: p.before, every, count: Math.min(p.count, wakeMax(p.before, every)) };
}

/** Each alarm's minutes before the start, soonest ringing first. */
export function wakeOffsets(p: WakePlan): number[] {
  const { before, every, count } = fitWake(p);
  return Array.from({ length: count }, (_, i) => before - i * every).filter((o) => o >= 0);
}

/** The plan in [list], or null without wake-up alarms. */
export function wakePlan(list: readonly Reminder[]): WakePlan | null {
  const offsets = list.filter((r) => r.wake).map((r) => r.offsetMin).sort((a, b) => b - a);
  if (!offsets.length) return null;
  return { before: offsets[0], every: Math.max(1, offsets[0] - (offsets[1] ?? offsets[0] - 10)), count: offsets.length };
}

/**
 * [list] with its wake-up alarms now as [plan] (null: none). Those staying at the same time keep their ids, so
 * what the engine knows about them (a skip, a snooze) stays; all take [plan]'s sound.
 */
export function withWakePlan(list: readonly Reminder[], plan: WakePlan | null, soundUri: string | null = null): Reminder[] {
  const others = list.filter((r) => !r.wake);
  if (!plan) return others;
  const old = list.filter((r) => r.wake);
  return [...others, ...wakeOffsets(plan).map((offsetMin): Reminder => ({
    id: old.find((r) => r.offsetMin === offsetMin)?.id ?? 0, itemId: old[0]?.itemId ?? 0, offsetMin, type: "ALARM", soundUri, wake: true,
  }))];
}

const spanText = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);

/** "start 2 h before, every 10 min, 4 alarms" */
export const wakeText = (p: WakePlan) => `start ${spanText(p.before)} before, every ${spanText(p.every)}, ${p.count} alarms`;
export { spanText as wakeSpan };

/** The strongest kind among [list]: an alarm, then a reminder that pops up, then a silent one; null for none. */
export function reminderKind(list: readonly Reminder[] | undefined): AlertType | null {
  if (!list?.length) return null;
  if (list.some((r) => r.type === "ALARM")) return "ALARM";
  if (list.some((r) => r.type === "REMINDER")) return "REMINDER";
  return "NOTIFICATION";
}
