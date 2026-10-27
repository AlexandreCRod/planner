// Dates are "local days since 1970-01-01" (like Android's LocalDate.toEpochDay) so a 9:00 task
// stays at 9:00 wall time on every device.

import { count } from "./plural.ts";

const DAY_MS = 86_400_000;

export interface YMD { y: number; m: number; d: number } // m = 1..12

export function epochOf(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function ymd(epoch: number): YMD {
  const dt = new Date(epoch * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function today(): number {
  const n = new Date();
  return epochOf(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export function nowMinutes(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

/** ISO weekday: Monday = 1 ... Sunday = 7. */
export function weekday(epoch: number): number {
  return ((((epoch + 3) % 7) + 7) % 7) + 1; // 1970-01-01 was a Thursday
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(epoch: number, n: number): number {
  const { y, m, d } = ymd(epoch);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return epochOf(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function monthsBetween(a: number, b: number): number {
  const x = ymd(a), z = ymd(b);
  return (z.y - x.y) * 12 + (z.m - x.m);
}

export function startOfWeek(epoch: number, mondayFirst: boolean): number {
  const wd = weekday(epoch);
  return epoch - (mondayFirst ? wd - 1 : wd % 7);
}

/** Local wall time (epoch day + minutes) → a JS timestamp. */
export function toTimestamp(epoch: number, minutes: number): number {
  const { y, m, d } = ymd(epoch);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).getTime();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const monthShort = (m: number) => MONTHS[m - 1];
export const monthLong = (m: number) => MONTHS_LONG[m - 1];
export const dayShort = (wd: number) => DAYS[wd - 1];

/** "written" (Thu, 15 Oct), "dmy" (15/10/2026), "mdy" (10/15/2026) or "ymd" (2026-10-15); chosen in Settings. */
export type DateStyle = "written" | "dmy" | "mdy" | "ymd";
export const DATE_STYLES: [DateStyle, string][] = [["written", "Written (Thu, 15 Oct)"], ["dmy", "DD/MM/YYYY"], ["mdy", "MM/DD/YYYY"], ["ymd", "YYYY-MM-DD"]];
export function dateStyle(): DateStyle {
  try {
    const v = globalThis.localStorage?.getItem("dateFormat");
    return DATE_STYLES.some(([k]) => k === v) ? (v as DateStyle) : "written";
  } catch {
    return "written";
  }
}

function numericDate(epoch: number, style: DateStyle): string | null {
  const { y, m, d } = ymd(epoch);
  const dd = String(d).padStart(2, "0"), mm = String(m).padStart(2, "0");
  if (style === "dmy") return `${dd}/${mm}/${y}`;
  if (style === "mdy") return `${mm}/${dd}/${y}`;
  if (style === "ymd") return `${y}-${mm}-${dd}`;
  return null;
}

/** The date alone: "15 Oct 2026" or "15/10/2026". */
export function formatDateShort(epoch: number): string {
  const { y, m, d } = ymd(epoch);
  return numericDate(epoch, dateStyle()) ?? `${d} ${monthShort(m)} ${y}`;
}

/** Weekday and date: "Thu, 15 Oct" (year added when it isn't this year) or "Thu, 15/10/2026". */
export function formatDate(epoch: number): string {
  const numeric = numericDate(epoch, dateStyle());
  if (numeric) return `${dayShort(weekday(epoch))}, ${numeric}`;
  const { y, m, d } = ymd(epoch);
  const base = `${dayShort(weekday(epoch))}, ${d} ${monthShort(m)}`;
  return y === ymd(today()).y ? base : `${base} ${y}`;
}

export function relativeDay(epoch: number): string {
  const t = today();
  if (epoch === t) return "Today";
  if (epoch === t + 1) return "Tomorrow";
  if (epoch === t - 1) return "Yesterday";
  return formatDate(epoch);
}

const system24h = (() => {
  const s = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2020, 0, 1, 15));
  return !/[AP]M/i.test(s);
})();

/**
 * The phone's own 24-hour setting, read from Android (the phone app sets it at start and whenever the
 * app comes back). When known it is the only source: the in-app choice isn't offered there.
 */
let device24h: boolean | null = null;
export function setDeviceClock24(v: boolean | null) { device24h = v; }
export const deviceClockKnown = () => device24h !== null;

/** "system" (this computer's setting), "24" or "12"; chosen in Settings. */
export type ClockFormat = "system" | "24" | "12";
export function clockFormat(): ClockFormat {
  if (device24h !== null) return "system";
  try {
    const v = globalThis.localStorage?.getItem("clockFormat");
    return v === "24" || v === "12" ? v : "system";
  } catch {
    return "system";
  }
}
export const use24h = () => (device24h !== null ? device24h : clockFormat() === "system" ? system24h : clockFormat() === "24");

export function formatTime(min: number): string {
  const h = Math.floor(min / 60), mm = min % 60;
  if (use24h()) return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? ":" + String(mm).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** Clock time of a timestamp, in the chosen format. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  return formatTime(d.getHours() * 60 + d.getMinutes());
}

/** Date and time of a timestamp, e.g. "15/10/2026, 09:30". */
export function formatDateTime(ts: number): string {
  const t = new Date(ts);
  return `${formatDateShort(epochOf(t.getFullYear(), t.getMonth() + 1, t.getDate()))}, ${formatClock(ts)}`;
}

export function dueCountdown(dueTs: number, now = Date.now()): string {
  const mins = Math.round((dueTs - now) / 60000);
  const abs = Math.abs(mins);
  if (abs < 1) return "due now";
  const text = abs < 60 ? `${abs}m` : abs < 1440 ? `${Math.floor(abs / 60)}h ${abs % 60}m` : `${Math.floor(abs / 1440)}d ${Math.floor((abs % 1440) / 60)}h`;
  return mins > 0 ? `in ${text}` : `${text} overdue`;
}

/**
 * A reminder's lead time, short: "At time", "30 min before", "1 hour before", "10 min after" (negative: after
 * the start). Given the minute it rings at [at] (the item's time, or the default reminder time for one with
 * none), "at the time" says it: "At 09:00" (216).
 */
export function offsetLabel(min: number, at: number | null = null): string {
  if (min === 0) return at === null ? "At time" : `At ${formatTime(at)}`;
  return `${leadParts(Math.abs(min), (m) => `${m} min`)} ${min < 0 ? "after" : "before"}`;
}

/** A reminder's lead time in full: "At the time", "15 minutes before", "1 hour 30 minutes before", "10 minutes after". */
export function offsetText(min: number): string {
  return min === 0 ? "At the time" : `${leadParts(Math.abs(min), (m) => count(m, "minute"))} ${min < 0 ? "after" : "before"}`;
}

/** [a] minutes as weeks, or days, hours and minutes ("1 day 2 hours"); [mins] words the minutes. */
function leadParts(a: number, mins: (m: number) => string): string {
  if (a % 10080 === 0) return count(a / 10080, "week");
  const d = Math.floor(a / 1440), h = Math.floor((a % 1440) / 60), m = a % 60;
  return [d ? count(d, "day") : "", h ? count(h, "hour") : "", m ? mins(m) : ""].filter(Boolean).join(" ");
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
