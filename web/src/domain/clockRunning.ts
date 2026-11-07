// What runs on the Clock page while it isn't open (336, the user's pick: A's behaviour with C's look). Nothing
// is added to the pages: the Clock tab in the bottom bar shows a ring and the time of the soonest running timer
// or stopwatch (a count with several), a tap on it opens that one's section, and a hold lists them with names.
import { elapsed, formatDuration, stopwatchLabel, stopwatchesOf, timerLeft, timerShare } from "./alarms.ts";

interface TimerLike { id: number; durationMs: number; label: string; endAt: number | null; remainingMs: number }
interface SwLike { id?: number; name?: string; startedAt: number | null; accumulatedMs: number; laps: number[] }

export interface Running {
  kind: "timer" | "stopwatch";
  id: number;
  /** Its name: the timer's label, else "5:00 timer"; the stopwatch's name, else "Stopwatch", "Stopwatch 2"... */
  name: string;
  /** What the tab shows: the time left on a timer, the time so far on a stopwatch ("12:41", "1:02:03"). */
  time: string;
  /**
   * The ring, 0 to 1: how much of a timer is left (it empties as the timer runs); for a stopwatch, which has no
   * end, the seconds of the current minute (it goes round once a minute, like a stopwatch's hand).
   */
  ring: number;
  /** When a timer ends (ms); a stopwatch: never. The soonest end comes first. */
  endsAt: number;
}

/**
 * Every timer and stopwatch counting now, the one that ends soonest first: timers by their end, then the
 * stopwatches in their own order. Paused ones aren't running.
 */
export function runningClocks(tools: { timers: TimerLike[]; stopwatch: SwLike; moreStopwatches?: SwLike[] }, now: number): Running[] {
  const timers: Running[] = tools.timers.filter((t) => t.endAt !== null).map((t): Running => {
    const left = timerLeft(t, now);
    return {
      kind: "timer", id: t.id, name: t.label.trim() || `${formatDuration(t.durationMs)} timer`,
      time: formatDuration(Math.ceil(left / 1000) * 1000), ring: timerShare(t, left), endsAt: t.endAt!,
    };
  }).sort((a, b) => a.endsAt - b.endsAt);
  const sws: Running[] = stopwatchesOf(tools).map((sw, i) => ({ sw, i })).filter(({ sw }) => sw.startedAt !== null).map(({ sw, i }) => {
    const ms = elapsed(sw, now);
    return { kind: "stopwatch", id: sw.id, name: stopwatchLabel(sw, i), time: formatDuration(ms), ring: (ms % 60_000) / 60_000, endsAt: Infinity };
  });
  return [...timers, ...sws];
}

/**
 * A running one's key in the Clock tab's list: the same while it runs, whatever comes before it, and never
 * another's (a timer and a stopwatch may share a number). A lit row keeps its item when the list re-sorts.
 */
export const runningKey = (r: Running): string => `${r.kind}-${r.id}`;

/** What the Clock tab shows: the soonest one's time and ring, and how many run (a count from 2); null when none. */
export function clockTab(list: Running[]): { time: string; ring: number; count: number; first: Running } | null {
  if (!list.length) return null;
  return { time: list[0].time, ring: list[0].ring, count: list.length, first: list[0] };
}
