// Port of app/.../domain/Recurrence.kt: which days a task or event occurs on.
import { addMonths, daysInMonth, formatDate, monthShort, monthsBetween, ordinal, startOfWeek, weekday, ymd, dayShort } from "./dates.ts";
import type { Item } from "./types.ts";

export const LAST_DAY_OF_MONTH = 32;

export const parseIntList = (s: string) => s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));
export const parseDays = (s: string) => new Set(parseIntList(s));
export const dayBit = (wd: number) => 1 << (wd - 1);
export const hasWeekDay = (mask: number, wd: number) => (mask & dayBit(wd)) !== 0;
export const hasMonth = (mask: number, m: number) => (mask & (1 << (m - 1))) !== 0;

function matchesMonthDay(item: Item, start: number, day: number): boolean {
  const days = parseIntList(item.monthDays);
  const list = days.length ? days : [ymd(start).d];
  const { y, m, d } = ymd(day);
  const last = daysInMonth(y, m);
  return list.some((md) => (md === LAST_DAY_OF_MONTH ? d === last : d === md));
}

export function occursOn(item: Item, day: number): boolean {
  const start = item.startDay;
  if (start === null || day < start) return false;
  if (item.untilDay !== null && day > item.untilDay) return false;
  if (item.freq === "NONE") return day === start;
  if (parseDays(item.excludedDays).has(day)) return false;
  const n = Math.max(1, item.interval);
  switch (item.freq) {
    case "DAILY":
      return (day - start) % n === 0;
    case "WEEKLY": {
      const mask = item.weekDays === 0 ? dayBit(weekday(start)) : item.weekDays;
      const weeks = (startOfWeek(day, true) - startOfWeek(start, true)) / 7;
      return hasWeekDay(mask, weekday(day)) && weeks % n === 0;
    }
    case "MONTHLY":
      return monthsBetween(start, day) % n === 0 && matchesMonthDay(item, start, day);
    case "YEARLY": {
      const years = ymd(day).y - ymd(start).y;
      const mask = item.months === 0 ? 1 << (ymd(start).m - 1) : item.months;
      return years % n === 0 && hasMonth(mask, ymd(day).m) && matchesMonthDay(item, start, day);
    }
  }
  return false;
}

export function occurrences(item: Item, from: number, to: number): number[] {
  const start = item.startDay;
  if (start === null) return [];
  if (item.freq === "NONE") return start >= from && start <= to ? [start] : [];
  const end = item.untilDay !== null ? Math.min(to, item.untilDay) : to;
  const out: number[] = [];
  for (let d = Math.max(from, start); d <= end; d++) if (occursOn(item, d)) out.push(d);
  return out;
}

export function nextOnOrAfter(item: Item, from: number): number | null {
  const start = item.startDay;
  if (start === null) return null;
  if (item.freq === "NONE") return start >= from ? start : null;
  const limit = addMonths(Math.max(from, start), 60);
  for (let d = Math.max(from, start); d <= limit; d++) {
    if (item.untilDay !== null && d > item.untilDay) return null;
    if (occursOn(item, d)) return d;
  }
  return null;
}

/** The occurrence an item opened on [occ] means: that one, or the next one when it was opened without a day. */
export const occurrenceDay = (item: Item, occ: number | null, today: number): number | null =>
  occ ?? nextOnOrAfter(item, today) ?? item.startDay;

export function previousBefore(item: Item, before: number, maxDays = 400): number | null {
  const start = item.startDay;
  if (start === null) return null;
  const limit = Math.max(start, before - maxDays);
  for (let d = before - 1; d >= limit; d--) if (occursOn(item, d)) return d;
  return null;
}

/**
 * The series ended the day before [day] ("This and following" on delete), or null when no occurrence
 * comes before [day], so nothing of the series would be left.
 */
export function endedBefore(item: Item, day: number): Item | null {
  const start = item.startDay;
  if (start === null || previousBefore(item, day, Infinity) === null) return null;
  return { ...item, untilDay: item.untilDay !== null ? Math.min(item.untilDay, day - 1) : day - 1 };
}

export const dayLabel = (d: number) => (d === LAST_DAY_OF_MONTH ? "last day" : ordinal(d));

export function describe(item: Item): string {
  const n = Math.max(1, item.interval);
  const start = item.startDay;
  let base: string;
  switch (item.freq) {
    case "NONE":
      return "Does not repeat";
    case "DAILY":
      base = n === 1 ? "Every day" : `Every ${n} days`;
      break;
    case "WEEKLY": {
      const mask = item.weekDays === 0 ? (start !== null ? dayBit(weekday(start)) : 0) : item.weekDays;
      const prefix = n === 1 ? "Weekly" : `Every ${n} weeks`;
      if (mask === 0b0011111) base = `${prefix} on weekdays`;
      else if (mask === 0b1111111) base = `${prefix}, every day`;
      else base = `${prefix} on ${[1, 2, 3, 4, 5, 6, 7].filter((w) => hasWeekDay(mask, w)).map(dayShort).join(", ")}`;
      break;
    }
    case "MONTHLY": {
      const days = parseIntList(item.monthDays);
      const list = days.length ? days : start !== null ? [ymd(start).d] : [];
      base = `${n === 1 ? "Monthly" : `Every ${n} months`} on the ${list.map(dayLabel).join(", ")}`;
      break;
    }
    case "YEARLY": {
      const mask = item.months === 0 ? (start !== null ? 1 << (ymd(start).m - 1) : 0) : item.months;
      const days = parseIntList(item.monthDays);
      const list = days.length ? days : start !== null ? [ymd(start).d] : [];
      const ms = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => hasMonth(mask, m)).map(monthShort);
      base = `${n === 1 ? "Yearly" : `Every ${n} years`}: ${ms.join(", ")} on the ${list.map(dayLabel).join(", ")}`;
      break;
    }
  }
  return item.untilDay !== null ? `${base} until ${formatDate(item.untilDay)}` : base;
}

/**
 * The repeat rule once occurrence [from] has moved to [to], with the others moving the same way: the
 * chosen weekdays, days of the month and months turn with it (otherwise the moved day isn't a day the
 * series falls on, and drops out), and its skipped days and its end stay with the days they were for.
 */
export function movedRule(item: Item, from: number, to: number): Pick<Item, "weekDays" | "monthDays" | "months" | "untilDay" | "excludedDays"> {
  const delta = to - from;
  const a = ymd(from), b = ymd(to);
  const turn = (mask: number, by: number, bits: number) => ((mask << by) | (mask >> (bits - by))) & ((1 << bits) - 1);
  const list = parseIntList(item.monthDays);
  const monthDays = list.length === 1 ? [b.d] : list.map((d) => (d === LAST_DAY_OF_MONTH ? d : ((d - 1 + b.d - a.d + 31) % 31) + 1));
  return {
    weekDays: turn(item.weekDays, ((delta % 7) + 7) % 7, 7),
    monthDays: delta ? monthDays.join(",") : item.monthDays,
    months: turn(item.months, (b.m - a.m + 12) % 12, 12),
    untilDay: item.untilDay !== null ? item.untilDay + delta : null,
    excludedDays: delta ? parseIntList(item.excludedDays).map((d) => d + delta).join(",") : item.excludedDays,
  };
}
