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
const inSeries = (a: Clockish) => a.series !== null && a.series !== undefined;
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
 * keeps every alarm on its own. A series (244) is one bundle of its own, however far apart its alarms are
 * and whatever their days; nothing else joins it. Bundles (and single alarms) come out sorted by their first time.
 */
export function bundleAlarms<T extends Clockish>(alarms: T[], now: Date, windowMin = BUNDLE_WINDOW_MIN): T[][] {
  const out: T[][] = [];
  const open = new Map<string, T[]>();
  for (const a of [...alarms].sort((x, y) => minuteOf(x) - minuteOf(y))) {
    const key = inSeries(a) ? `s:${a.series}` : daysKey(a, now);
    const b = open.get(key);
    if (b && (inSeries(a) || (windowMin > 0 && minuteOf(a) - minuteOf(b[b.length - 1]) <= windowMin))) { b.push(a); continue; }
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

// ---------- A series of alarms, made in one go (244) ----------

/** The most alarms in one series: each one is a pending alarm and a pending notice, and Android allows 500 in all. */
export const SERIES_MAX = 30;

/** From one time to another (both minutes after midnight, on the same day), every so many minutes. */
export interface SeriesPlan { from: number; to: number; every: number }

/** The times a series rings at: [from], then every [every] minutes up to [to] at the latest. */
export function seriesTimes({ from, to, every }: SeriesPlan): number[] {
  if (every < 1) return [];
  const out: number[] = [];
  for (let m = from; m <= to; m += every) out.push(m);
  return out;
}

/** Why a plan can't be saved, in the editor's words, or null when it can. */
export function seriesProblem(plan: SeriesPlan): string | null {
  if (plan.to <= plan.from) return "The end has to be after the start, on the same day";
  const n = seriesTimes(plan).length;
  if (n < 2) return "That's only one alarm: make the gap shorter";
  return n > SERIES_MAX ? `Up to ${SERIES_MAX} alarms: make the gap longer` : null;
}

/** What the editor shows for a saved series: its first and last times and the first gap. */
export function seriesPlan(group: Clockish[]): SeriesPlan {
  const times = group.map(minuteOf).sort((a, b) => a - b);
  return { from: times[0], to: times[times.length - 1], every: Math.max(1, (times[1] ?? times[0] + 10) - times[0]) };
}

/**
 * Saving [plan]: an alarm for each of its times, as [base] says (its label, days, sound...), all on. Alarms of
 * the series already there at one of the times keep their ids; new ones get [freshId] onwards; the rest of
 * [existing] are to be deleted.
 */
export function buildSeries<T extends Clockish & { id: number; enabled: boolean }>(base: T, plan: SeriesPlan, existing: T[], seriesId: number, freshId: number): { save: T[]; remove: number[] } {
  const left = [...existing];
  let next = freshId;
  const save = seriesTimes(plan).map((m) => {
    const i = left.findIndex((a) => minuteOf(a) === m);
    const old = i >= 0 ? left.splice(i, 1)[0] : null;
    return { ...base, id: old?.id ?? next++, hour: Math.floor(m / 60), minute: m % 60, enabled: true, series: seriesId };
  });
  return { save, remove: left.map((a) => a.id) };
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

/** "Skips today", "Skips tomorrow" or "Skips Fri 30", for one skipped day. */
export const skipsOn = (day: number, today: number, date: (day: number) => string) =>
  day === today ? "Skips today" : day === today + 1 ? "Skips tomorrow" : `Skips ${date(day)}`;

/** The note for one skipped day: "Skips tomorrow", "Skips Fri 30"; for more, "Skips 3 days"; else "". */
export function skipText(a: Clockish, today: number, date: (day: number) => string): string {
  if (a.pausedUntil != null && a.pausedUntil > today) return "";
  const days = upcomingSkips(a, today);
  if (!days.length) return "";
  if (days.length > 1) return `Skips ${days.length} days`;
  return skipsOn(days[0], today, date);
}

// ---------- One-tap Skip on each card, with Undo in its place (317) ----------

/**
 * Whether [a] would ring on local day [day] if it skipped nothing ("ring": it will; "off": it won't, because
 * the day is skipped or the alarm is paused), or null when it wouldn't ring then anyway (it's off, it doesn't
 * ring that day, or that day's ring has passed). A one-off rings on the day it next rings.
 */
export function ringState(a: Skippable, day: number, now: Date): "ring" | "off" | null {
  if (!a.enabled) return null;
  if (!isRepeating(a)) {
    const next = nextRing(a, now);
    return next && epochOfDate(next) === day ? "ring" : null;
  }
  if (!ringsOnDay({ ...a, skip: [], pausedUntil: null }, day) || ringAt(day, minuteOf(a)) <= now) return null;
  return ringsOnDay(a, day) ? "ring" : "off";
}

/** The day [group]'s next ring would be (skips aside; a pause counts), or null. */
function plainNextDay(group: Skippable[], now: Date): number | null {
  let best: Date | null = null;
  for (const a of group) {
    if (!a.enabled) continue;
    const at = nextRing({ ...a, skip: [] }, now);
    if (at && (!best || at < best)) best = at;
  }
  return best ? epochOfDate(best) : null;
}

/**
 * The day [group]'s next ring is skipped on, when it is: every alarm of it that would ring that day skips
 * it (the card's Skip turned into Undo). Null when the next ring still rings (or there's none).
 */
export function skippedNext(group: Skippable[], now: Date): number | null {
  const day = plainNextDay(group, now);
  if (day === null) return null;
  const due = group.filter((a) => ringState(a, day, now) !== null);
  return due.length && due.every((a) => isRepeating(a) && (a.skip ?? []).includes(day)) ? day : null;
}

/** Undo of a card's Skip: the alarms of [group] that skip [day], ringing that day again (only those). */
export function unskipDay<T extends Clockish>(group: T[], day: number): T[] {
  return group.filter((a) => (a.skip ?? []).includes(day)).map((a) => ({ ...a, skip: (a.skip ?? []).filter((d) => d !== day) }));
}

// ---------- Skip days: a window of rings to preview and untick (317) ----------

/** The longest window the Skip days sheet takes, so an alarm's skip list stays small. */
export const SKIP_WINDOW_DAYS = 90;
/** A pause up to this long becomes skip days when the sheet saves the alarm; a longer one stays a pause. */
const PAUSE_TO_SKIPS_MAX = 366;

/** One alarm's ring on one day of the window; [off]: it already won't ring (skipped or paused). */
export interface WindowRing<T> { alarm: T; key: string; off: boolean }
/** One bundle (or a single alarm) on one day: its rings, in time order. */
export interface WindowEntry<T> { minute: number; rings: WindowRing<T>[] }
export interface WindowDay<T> { day: number; entries: WindowEntry<T>[] }

/** What names one ring in the sheet's ticks: the alarm and the day. */
export const ringKey = (id: number, day: number) => `${id}@${day}`;

/**
 * Every ring of [alarms] from local day [from] to [to] (both included, at most SKIP_WINDOW_DAYS), day by day,
 * bundled as the list bundles them (bundleAlarms), those already off (skipped, paused) marked. Days with no
 * ring are left out, and so are rings that have passed.
 */
export function ringsBetween<T extends Skippable & { id: number }>(alarms: T[], from: number, to: number, now: Date, windowMin = BUNDLE_WINDOW_MIN): WindowDay<T>[] {
  const groups = bundleAlarms(alarms.filter((a) => a.enabled), now, windowMin);
  const last = Math.min(to, from + SKIP_WINDOW_DAYS - 1);
  const out: WindowDay<T>[] = [];
  for (let day = from; day <= last; day++) {
    const entries: WindowEntry<T>[] = [];
    for (const g of groups) {
      const rings: WindowRing<T>[] = [];
      for (const a of g) {
        const st = ringState(a, day, now);
        if (st) rings.push({ alarm: a, key: ringKey(a.id, day), off: st === "off" });
      }
      if (rings.length) entries.push({ minute: minuteOf(rings[0].alarm), rings });
    }
    if (entries.length) out.push({ day, entries: entries.sort((x, y) => x.minute - y.minute) });
  }
  return out;
}

/** Every ring of the window, by key: the sheet starts with all of them ticked (to be quiet). */
export const windowKeys = <T>(days: WindowDay<T>[]) => days.flatMap((d) => d.entries.flatMap((e) => e.rings.map((r) => r.key)));

/** How many rings saving would silence that ring now ([skips]), and how many already off would ring again ([back]). */
export function windowCount<T>(days: WindowDay<T>[], off: ReadonlySet<string>): { skips: number; back: number } {
  let skips = 0, back = 0;
  for (const d of days) for (const e of d.entries) for (const r of e.rings) {
    if (off.has(r.key) && !r.off) skips++;
    else if (!off.has(r.key) && r.off) back++;
  }
  return { skips, back };
}

/**
 * Saving the Skip days sheet: the alarms that change so that exactly the rings in [off] stay quiet in the
 * window. A repeating alarm gets those days in its skip list (and loses the unticked ones); a one-off that
 * rings in the window is switched off instead. A pause (from an older build) becomes skip days first and is
 * cleared, so a paused ring can be unticked too. Days past are dropped from the skip lists.
 */
export function applyWindow<T extends Skippable & { id: number }>(days: WindowDay<T>[], off: ReadonlySet<string>, today: number): T[] {
  const byAlarm = new Map<number, { alarm: T; rings: { day: number; key: string }[] }>();
  for (const d of days) for (const e of d.entries) for (const r of e.rings) {
    const x = byAlarm.get(r.alarm.id) ?? { alarm: r.alarm, rings: [] };
    x.rings.push({ day: d.day, key: r.key });
    byAlarm.set(r.alarm.id, x);
  }
  const out: T[] = [];
  for (const { alarm: a, rings } of byAlarm.values()) {
    if (!isRepeating(a)) {
      if (a.enabled && rings.some((r) => off.has(r.key))) out.push({ ...a, enabled: false });
      continue;
    }
    const skip = new Set((a.skip ?? []).filter((d) => d >= today));
    let pausedUntil = a.pausedUntil != null && a.pausedUntil > today ? a.pausedUntil : null;
    if (pausedUntil !== null && pausedUntil - today <= PAUSE_TO_SKIPS_MAX) {
      const plain = { ...a, skip: [], pausedUntil: null };
      for (let d = today; d < pausedUntil; d++) if (ringsOnDay(plain, d)) skip.add(d);
      pausedUntil = null;
    }
    for (const r of rings) { if (off.has(r.key)) skip.add(r.day); else skip.delete(r.day); }
    const next = [...skip].sort((x, y) => x - y);
    const was = [...(a.skip ?? [])].sort((x, y) => x - y);
    if (next.join() !== was.join() || pausedUntil !== (a.pausedUntil ?? null)) out.push({ ...a, skip: next, pausedUntil });
  }
  return out;
}

/** The Skip days sheet's quick choices, as [name, first day, last day]; "Rest of week" runs to Sunday. */
export function quickWindows(today: number, nextDay: number | null): [string, number, number][] {
  const sunday = today + 6 - ((((today + 3) % 7) + 7) % 7);
  const out: [string, number, number][] = [];
  if (nextDay !== null) out.push(["Next ring", nextDay, nextDay]);
  out.push(["Tomorrow", today + 1, today + 1]);
  if (sunday > today + 1) out.push(["Rest of week", today + 1, sunday]);
  out.push(["Next 7 days", today + 1, today + 7], ["2 weeks", today + 1, today + 14]);
  return out;
}

// ---------- Selecting several alarms (348) ----------

/** A tap or hold on a card while selecting: its alarms (a bundle's all) go in, or out if they all were in. */
export function toggleAlarms(sel: ReadonlySet<number>, ids: readonly number[]): Set<number> {
  const next = new Set(sel);
  const all = ids.length > 0 && ids.every((id) => sel.has(id));
  for (const id of ids) { if (all) next.delete(id); else next.add(id); }
  return next;
}

/** The selected alarms, in time order (as a skip sheet lists them); ids no longer there drop out. */
export const selectedAlarms = <T extends Clockish & { id: number }>(all: T[], sel: ReadonlySet<number>): T[] =>
  all.filter((a) => sel.has(a.id)).sort((x, y) => x.hour * 60 + x.minute - (y.hour * 60 + y.minute));

/** The selection bar's switch: "off" while any picked alarm is on (they all go off), else "on". */
export const selectionSwitch = (picked: { enabled: boolean }[]): "on" | "off" => (picked.some((a) => a.enabled) ? "off" : "on");

/** The alarms to save to turn [picked] [to] "on" or "off": only those not already so. */
export const switchAlarms = <T extends { enabled: boolean }>(picked: T[], to: "on" | "off"): T[] =>
  picked.filter((a) => a.enabled !== (to === "on")).map((a) => ({ ...a, enabled: to === "on" }));
