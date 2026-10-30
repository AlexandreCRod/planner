// The Clock page's alarm list (2.9): its filters (71), bundles of alarms with the same days (73, 110) and
// skipping the next ring or tomorrow's (75). Pure, so it's unit-tested (test/clockList.test.ts). The alarm
// schedule rules themselves are in alarms.ts.
import { type Clockish, WEEKDAYS, WEEKEND, alarmDayMask, isRepeating, nextRing, ringsOnDay } from "./alarms.ts";

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

/**
 * A bundle moved to start at [to] (minutes after midnight): every alarm shifts by the same amount (110).
 * The shift stops at midnight on either side, so no alarm moves to another day (that would change its
 * days); [to] is then as near as it can be.
 */
export function shiftBundle<T extends Clockish>(group: T[], to: number): T[] {
  if (!group.length) return group;
  const times = group.map(minuteOf);
  const lo = Math.min(...times), hi = Math.max(...times);
  const delta = Math.max(-lo, Math.min(1439 - hi, to - minuteOf(group[0])));
  return group.map((a) => { const m = minuteOf(a) + delta; return { ...a, hour: Math.floor(m / 60), minute: m % 60 }; });
}

// ---------- Skip the next ring, or tomorrow's (75) ----------

type Skippable = Clockish & { enabled: boolean };
const ringAt = (day: number, minute: number) => {
  const u = new Date(day * 86_400_000);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), Math.floor(minute / 60), minute % 60);
};

/**
 * [a] skipping its ring on local day [day], or null when there's nothing to skip (it's off, doesn't ring
 * that day, or that day's ring has passed). A repeating alarm adds the day to its skips (the engine reads
 * them: ClockAlarms.kt); one that rings once is switched off, as ringing would have done.
 */
export function skipDay<T extends Skippable>(a: T, day: number, now: Date): T | null {
  if (!a.enabled) return null;
  if (!isRepeating(a)) {
    const next = nextRing(a, now);
    return next && epochOfDate(next) === day ? { ...a, enabled: false } : null;
  }
  if (!ringsOnDay(a, day) || ringAt(day, minuteOf(a)) <= now) return null;
  return { ...a, skip: [...(a.skip ?? []), day].sort((x, y) => x - y) };
}

/** The day the first alarm of [group] that's on rings next, or null. */
export function nextRingDay(group: Skippable[], now: Date): number | null {
  let best: Date | null = null;
  for (const a of group) {
    if (!a.enabled) continue;
    const at = nextRing(a, now);
    if (at && (!best || at < best)) best = at;
  }
  return best ? epochOfDate(best) : null;
}

/** The alarms of [group] changed to skip local day [day] (only those that would ring then). */
export function skipGroupOn<T extends Skippable>(group: T[], day: number, now: Date): T[] {
  return group.map((a) => skipDay(a, day, now)).filter((a): a is T => a !== null);
}

/** "Skip next": the alarm, or the whole bundle, doesn't ring on the day it would next ring. */
export function skipNext<T extends Skippable>(group: T[], now: Date): T[] {
  const day = nextRingDay(group, now);
  return day === null ? [] : skipGroupOn(group, day, now);
}

/** "Skip tomorrow": none of [group] rings tomorrow. */
export const skipTomorrow = <T extends Skippable>(group: T[], now: Date): T[] => skipGroupOn(group, epochOfDate(now) + 1, now);

/** The upcoming days [a] skips (that it would otherwise ring on), soonest first. */
export function upcomingSkips(a: Clockish, today: number): number[] {
  const plain = { ...a, skip: [], pausedUntil: null };
  return (a.skip ?? []).filter((d) => d >= today && ringsOnDay(plain, d)).sort((x, y) => x - y);
}

/** [a] ringing as usual again: its upcoming skipped days cleared (a pause stays). Null when it skips none. */
export function unskip<T extends Clockish>(a: T, today: number): T | null {
  return upcomingSkips(a, today).length ? { ...a, skip: (a.skip ?? []).filter((d) => d < today) } : null;
}

/** The note for one skipped day: "Skips tomorrow", "Skips Fri 30"; for more, "Skips 3 days"; else "". */
export function skipText(a: Clockish, today: number, date: (day: number) => string): string {
  if (a.pausedUntil != null && a.pausedUntil > today) return "";
  const days = upcomingSkips(a, today);
  if (!days.length) return "";
  if (days.length > 1) return `Skips ${days.length} days`;
  return days[0] === today ? "Skips today" : days[0] === today + 1 ? "Skips tomorrow" : `Skips ${date(days[0])}`;
}
