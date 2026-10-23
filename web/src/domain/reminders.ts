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

/** The strongest kind among [list]: an alarm, then a reminder that pops up, then a silent one; null for none. */
export function reminderKind(list: readonly Reminder[] | undefined): AlertType | null {
  if (!list?.length) return null;
  if (list.some((r) => r.type === "ALARM")) return "ALARM";
  if (list.some((r) => r.type === "REMINDER")) return "REMINDER";
  return "NOTIFICATION";
}
