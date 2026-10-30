// The Clock page's alarm list (2.9): its filters (71), bundles of alarms with the same days (73, 110) and
// skipping the next ring or tomorrow's (75). Pure, so it's unit-tested (test/clockList.test.ts). The alarm
// schedule rules themselves are in alarms.ts.
import { type Clockish, WEEKDAYS, WEEKEND, alarmDayMask } from "./alarms.ts";

// ---------- Filters (71) ----------

/** The alarm list's filter chips; none on shows every alarm. */
export type ClockFilter = "on" | "off" | "weekdays" | "weekend";
export const CLOCK_FILTERS: [ClockFilter, string][] = [["on", "Active"], ["off", "Inactive"], ["weekdays", "Weekdays"], ["weekend", "Weekends"]];

/** Whether [a] shows under filter [f] (null: every alarm). Weekdays and weekends go by the days it rings. */
export function shownBy(a: Clockish & { enabled: boolean }, f: ClockFilter | null, now: Date): boolean {
  switch (f) {
    case null: return true;
    case "on": return a.enabled;
    case "off": return !a.enabled;
    case "weekdays": return (alarmDayMask(a, now) & WEEKDAYS) !== 0;
    case "weekend": return (alarmDayMask(a, now) & WEEKEND) !== 0;
  }
}

/** A tap on chip [f]: turns it on, or off again if it was the one on. */
export const toggleFilter = (current: ClockFilter | null, f: ClockFilter) => (current === f ? null : f);

// ---------- Bundles (73, 110) ----------

/** By default, an alarm with the same days within 19 minutes of a bundle's last alarm joins it (110). */
export const BUNDLE_WINDOW_MIN = 19;
const minuteOf = (a: Clockish) => a.hour * 60 + a.minute;
const epochOfDate = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

/**
 * What an alarm's days are, as a key: alarms bundle only with the exact same days (73). Weekdays by their
 * mask, chosen dates by the dates; an alarm that rings once by the day it rings next (06:30 and 06:40 both
 * tomorrow bundle; one today and one tomorrow don't). Skips and pauses don't count: they're one-day exceptions.
 */
export function daysKey(a: Clockish, now: Date): string {
  if (a.dates?.length) return `d:${[...a.dates].sort((x, y) => x - y).join(",")}`;
  if (a.days !== 0) return `w:${a.days}`;
  // Once: today if its time is still to come, else tomorrow (nextRing's rule, without the skips).
  return `o:${epochOfDate(now) + (minuteOf(a) > now.getHours() * 60 + now.getMinutes() ? 0 : 1)}`;
}

/**
 * Splits alarms into bundles, in time order: an alarm joins a bundle when it has the same days (daysKey)
 * and rings at most [windowMin] minutes after the bundle's latest alarm (as before 2.9, when the gap was
 * 29 minutes): 06:30, 06:45 and 07:00 travel together with a 19-minute window. A window of 0
 * keeps every alarm on its own. Bundles (and single alarms) come out sorted by their first time.
 */
export function bundleAlarms<T extends Clockish>(alarms: T[], now: Date, windowMin = BUNDLE_WINDOW_MIN): T[][] {
  const out: T[][] = [];
  const open = new Map<string, T[]>();
  for (const a of [...alarms].sort((x, y) => minuteOf(x) - minuteOf(y))) {
    const key = daysKey(a, now);
    const b = open.get(key);
    if (b && windowMin > 0 && minuteOf(a) - minuteOf(b[b.length - 1]) <= windowMin) { b.push(a); continue; }
    const fresh = [a];
    open.set(key, fresh);
    out.push(fresh);
  }
  return out;
}
