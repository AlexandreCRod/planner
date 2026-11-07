// The when line of an item's page: its day and times in words.
import { formatDate as formatDateLong, formatTime, relativeDay } from "./dates.ts";
import { isRoutineItem } from "./routines.ts";
import type { Item } from "./types.ts";

/**
 * "Thu, 15 Oct · 3 PM – 4 PM", "All day, 3 Aug – 10 Aug", "Due Fri, 16 Oct at 9 AM"; a routine says its day
 * instead of a deadline: "Today at 9:30 PM", "Today · 7 AM – 8 AM" (286).
 */
export function whenText(item: Item, day: number | null): string {
  const start = day ?? item.startDay;
  if (start === null) return "No date";
  // A routine is about its day, not a deadline (286): "Today", "Tomorrow" or the date, never "Due".
  const routine = isRoutineItem(item);
  const formatDate = routine ? relativeDay : formatDateLong;
  if (item.type !== "EVENT") return `${routine ? "" : "Due "}${formatDate(start)}${item.startMin !== null ? ` at ${formatTime(item.startMin)}` : ""}`;
  const span = Math.max(0, (item.endDay ?? item.startDay ?? 0) - (item.startDay ?? 0));
  const end = start + span;
  const t = (m: number | null) => (m !== null ? formatTime(m) : "");
  if (item.allDay) return span ? `All day, ${formatDate(start)} – ${formatDate(end)}` : `${formatDate(start)} · all day`;
  return span ? `${formatDate(start)} ${t(item.startMin)} – ${formatDate(end)} ${t(item.endMin)}` : `${formatDate(start)} · ${t(item.startMin)} – ${t(item.endMin)}`;
}

/**
 * "No time" (376): only the time goes; the date, the repeat and everything else stay. An event without a time
 * is an all-day one.
 */
export const noTimePatch = (d: { type: Item["type"] }): Partial<Item> => (d.type === "EVENT" ? { allDay: true, startMin: null, endMin: null } : { startMin: null, endMin: null });
