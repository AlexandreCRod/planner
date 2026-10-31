// The Alarms page's rules, ported from the native app (alarm/ClockAlarms.kt, ClockTools.kt and
// ui/alarms/AlarmsScreen.kt), plus what the page sends to the alarm engine. Pure, so it's unit-tested
// (test/alarms.test.ts).
import type { AgendaDay } from "./agenda.ts";
import type { Completion, Item, Reminder } from "./types.ts";

// ---------- The engine's copy of the data ----------

export interface AlarmSettings {
  /** Time used for reminders on untimed tasks and all-day events (minutes after midnight). */
  defaultTaskTime: number;
  /** Ringtone for alarms without their own; null = the phone's alarm sound. */
  defaultAlarmSound: string | null;
  /** Its name, as the phone gave it when picked. */
  defaultAlarmSoundName: string | null;
  snoozeMinutes: number;
  /** The notice 2 h before an alarm, with Snooze / Stop. */
  upcomingAlarms: boolean;
  quietHoursEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  /** How long an event or task alarm rings before it stops by itself, in minutes (missing before 2.2: 1). */
  alarmRingMinutes: number;
  /** The same for clock alarms and timers (missing before 2.2: 10). */
  clockRingMinutes: number;
}

/** The fields of an item the engine schedules with (its Item class). */
const ITEM_FIELDS = ["id", "type", "title", "startDay", "startMin", "endDay", "endMin", "allDay", "freq", "interval", "weekDays",
  "monthDays", "months", "untilDay", "excludedDays", "deletedAt", "routine"] as const;

/** The native accents, in order (the engine's ringing screen takes the index). */
const ACCENTS = ["#1a73e8", "#00796b", "#b0285a", "#8b5000", "#2e7d32", "#6a3db8", "#0061a4", "#4f5b66", "#3f51b5"];

export interface MirrorPush {
  items: Pick<Item, (typeof ITEM_FIELDS)[number]>[];
  reminders: Reminder[];
  completions: { itemId: number; day: number }[];
  settings: Omit<AlarmSettings, "defaultAlarmSoundName"> & { clockFormat: number; dateFormat: number; accent: number } & Partial<CardChoices> & Partial<RingChoices>;
  /** What the ringing screen's Today card shows (246). */
  agenda?: AgendaDay[];
}

/** The notification card's choices, as the engine takes them (218, 254; TypeScript decides, Kotlin draws). */
export interface CardChoices {
  /** 1 Android's group, a row per item; 2 one plain list. */
  notificationCard: number;
  /** The icon set for rings, pops up and silent, 1 to 3. */
  notificationIcons: number;
  /** Clock alarms with the same days this close share a line, as on the Clock page. */
  bundleWindow: number;
}

/** From the looks' values ("1", "2") and the Clock page's bundle window; anything odd is the default. */
export function cardChoices(card: string, icons: string, bundleWindow: number): CardChoices {
  return { notificationCard: card === "2" ? 2 : 1, notificationIcons: icons === "2" ? 2 : icons === "3" ? 3 : 1, bundleWindow };
}

/** The ringing screen's choices, as the engine takes them (246, 254). Its plain layout (0) is what it falls back on. */
export interface RingChoices {
  /** 1 A: the calm clock; 2 B: two big buttons. */
  ringLayout: number;
  /** 1 slide, 2 hold, 3 tap. */
  ringStop: number;
  /** Show what's coming up. */
  ringComing: boolean;
  /** The icon set for stop and snooze, 1 to 3. */
  ringIcons: number;
}

/** From the looks' values; anything odd is the pick. */
export function ringChoices(layout: string, stop: string, coming: string, icons: string): RingChoices {
  return {
    ringLayout: layout === "B" ? 2 : 1, ringStop: stop === "hold" ? 2 : stop === "tap" ? 3 : 1, ringComing: coming !== "off",
    ringIcons: icons === "2" ? 2 : icons === "3" ? 3 : 1,
  };
}

/**
 * What the engine gets: live (not trashed) tasks and events that have reminders, with only their
 * scheduling fields; their reminders and completions; and the settings. Sorted, so the same data always
 * gives the same text (a push is skipped when nothing changed).
 */
export function buildMirror(
  items: Item[], reminders: Map<number, Reminder[]>, completions: Completion[],
  settings: AlarmSettings, clock: "system" | "24" | "12", date: string, accent: string,
): MirrorPush {
  const out: MirrorPush["items"] = [];
  const rs: Reminder[] = [];
  const ids = new Set<number>();
  for (const it of items) {
    const list = reminders.get(it.id);
    if (!list?.length || it.type === "NOTE" || it.deletedAt !== null) continue;
    const slim = {} as Record<string, unknown>;
    for (const k of ITEM_FIELDS) slim[k] = it[k];
    out.push(slim as MirrorPush["items"][number]);
    ids.add(it.id);
    for (const r of list) rs.push({ id: r.id, itemId: r.itemId, offsetMin: r.offsetMin, type: r.type, soundUri: r.soundUri ?? null, ...(r.wake ? { wake: true } : {}) });
  }
  out.sort((a, b) => a.id - b.id);
  rs.sort((a, b) => a.id - b.id);
  const done = completions.filter((c) => ids.has(c.itemId)).map((c) => ({ itemId: c.itemId, day: c.day }))
    .sort((a, b) => a.itemId - b.itemId || a.day - b.day);
  const { defaultAlarmSoundName: _name, ...rest } = settings;
  return {
    items: out, reminders: rs, completions: done,
    settings: {
      ...rest,
      clockFormat: clock === "24" ? 1 : clock === "12" ? 2 : 0,
      dateFormat: Math.max(0, ["written", "dmy", "mdy", "ymd"].indexOf(date)),
      accent: Math.max(0, ACCENTS.indexOf(accent.toLowerCase())),
    },
  };
}

// ---------- Task and event alarms on the Alarms page ----------

/** How many days, from today, the Alarms page lists task and event alarms for ("From calendar"): today and tomorrow. */
export const CALENDAR_ALARM_DAYS = 2;

/**
 * One occurrence of a task's or event's ALARM reminder, as the alarm engine rings it. The engine works these
 * out itself (AlarmScheduler.upcoming, read through native.calendarAlarms), so the page never disagrees with
 * what rings, across a DST change too (194).
 */
export interface CalendarAlarm {
  itemId: number; reminderId: number; title: string;
  /** The occurrence's day (the item's, not the alarm's: an alarm the evening before belongs to the next day). */
  day: number;
  /** When it was due (identifies it to the engine's skips), and when it rings now (an early snooze moves it). */
  original: number; at: number;
  skipped: boolean;
}

// ---------- Clock alarms ----------

export const WEEKDAYS = 0b0011111;
export const WEEKEND = 0b1100000;
export const EVERY_DAY = 0b1111111;
/**
 * A plain alarm clock's schedule (alarm/ClockAlarms.kt has the same rules). [days]: bit 0 = Monday ...
 * bit 6 = Sunday, 0 = rings once. [dates] (local epoch days), when there are any, replace the weekdays:
 * it rings on those dates only. A repeating alarm (weekdays or dates) can skip chosen days ([skip]) or
 * be paused until a day ([pausedUntil]: the first day it rings again). Kept on the phone only.
 */
export interface Clockish {
  hour: number; minute: number; days: number; dates?: number[]; skip?: number[]; pausedUntil?: number | null;
  /** The series it belongs to (244: alarms made in one go, one bundle whatever the bundle window); missing on the rest. */
  series?: number | null;
}
const minuteOfDay = (a: Clockish) => a.hour * 60 + a.minute;
/** Monday = 0 ... Sunday = 6 (the days mask's bits). */
const dayIndex = (d: Date) => (d.getDay() + 6) % 7;
/** Monday = 0 ... Sunday = 6 for a local epoch day (1970-01-01 was a Thursday). */
export const epochDayIndex = (day: number) => (((day + 3) % 7) + 7) % 7;
export const repeatsOn = (a: Clockish, d: Date) => (a.days & (1 << dayIndex(d))) !== 0;
const epochOfDate = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
const dateOfEpoch = (day: number, minute: number) => {
  const u = new Date(day * 86_400_000);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), Math.floor(minute / 60), minute % 60);
};

/** Whether [a] rings more than once: on weekdays or on chosen dates. */
export const isRepeating = (a: Clockish) => a.days !== 0 || (a.dates?.length ?? 0) > 0;

/** Whether [a] rings on local day [day] (its time aside). */
export function ringsOnDay(a: Clockish, day: number): boolean {
  if (a.dates?.length) { if (!a.dates.includes(day)) return false; }
  else if (a.days === 0) return true; // once: the next time it comes round
  else if ((a.days & (1 << epochDayIndex(day))) === 0) return false;
  if (a.skip?.includes(day)) return false;
  return a.pausedUntil == null || day >= a.pausedUntil;
}

/** How far ahead a ring is looked for (a pause or a date can be months away). */
const HORIZON_DAYS = 400;

/** The next time [a] rings after [now], or null if it won't (its dates are all past). (ClockAlarms.nextRing) */
export function nextRing(a: Clockish, now: Date): Date | null {
  const t0 = epochOfDate(now);
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    if (!ringsOnDay(a, t0 + i)) continue;
    const at = dateOfEpoch(t0 + i, minuteOfDay(a));
    if (at > now) return at;
  }
  return null;
}

/** The quiet note under a paused or skipping alarm: "Paused until Mon 20", "Skips 3 days", or "". */
export function pauseText(a: Clockish, today: number, date: (day: number) => string): string {
  if (!isRepeating(a)) return "";
  if (a.pausedUntil != null && a.pausedUntil > today) return `Paused until ${date(a.pausedUntil)}`;
  const n = (a.skip ?? []).filter((d) => d >= today && ringsOnDay({ ...a, skip: [], pausedUntil: null }, d)).length;
  return n ? `Skips ${n === 1 ? "1 day" : `${n} days`}` : "";
}

/** [a] with days already past dropped from its dates and skips, and a pause that has ended cleared. */
export function tidySchedule<T extends Clockish>(a: T, today: number): T {
  return {
    ...a,
    dates: (a.dates ?? []).filter((d) => d >= today).sort((x, y) => x - y),
    skip: (a.skip ?? []).filter((d) => d >= today).sort((x, y) => x - y),
    pausedUntil: a.pausedUntil != null && a.pausedUntil > today ? a.pausedUntil : null,
  };
}

/** The weekdays [a] rings on (bit 0 = Monday): its repeat days, or the day it rings next if it rings once. */
export function alarmDayMask(a: Clockish, now: Date): number {
  const today = epochOfDate(now);
  if (a.dates?.length) return a.dates.filter((d) => d >= today).reduce((m, d) => m | (1 << epochDayIndex(d)), 0);
  if (a.days !== 0) return a.days;
  const next = nextRing(a, now);
  return next ? 1 << dayIndex(next) : 0;
}

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const NARROW_DAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** Under an alarm: "Once · Tomorrow", "Every day", "Weekdays", "Mon Wed Fri" (AlarmsScreen.repeatText). */
export function repeatText(a: Clockish, now: Date, relative: (d: Date) => string): string {
  if (a.dates?.length) {
    const next = nextRing(a, now);
    const left = a.dates.filter((d) => d >= epochOfDate(now)).length;
    if (!next) return "Dates passed";
    return left === 1 ? `Once · ${relative(next)}` : `${left} dates · next ${relative(next)}`;
  }
  switch (a.days) {
    case 0: { const next = nextRing(a, now); return next ? `Once · ${relative(next)}` : "Once"; }
    case EVERY_DAY: return "Every day";
    case WEEKDAYS: return "Weekdays";
    case WEEKEND: return "Weekends";
    default: return SHORT_DAYS.filter((_, i) => a.days & (1 << i)).join(" ");
  }
}

/** Under the editor's days: "Rings once", "Every day"... */
export function daysText(days: number): string {
  return days === 0 ? "Rings once" : days === EVERY_DAY ? "Every day" : days === WEEKDAYS ? "Weekdays" : days === WEEKEND ? "Weekends" : "On the chosen days";
}

/** "7 h 12 min" until [at] (the "Alarm in ..." line; rounded up to the minute, like native). */
export function untilText(at: Date, now: Date): string {
  const mins = Math.floor((at.getTime() - now.getTime()) / 60_000) + 1;
  if (mins < 60) return `${mins} min`;
  if (mins % 60 === 0) return `${mins / 60} h`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

// ---------- Timers and the stopwatch ----------

/** "4:05", "1:02:03"; with [hundredths] "4:05.27" (ClockTools.formatDuration). */
export function formatDuration(ms: number, hundredths = false): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000), m = Math.floor(total / 60_000) % 60, s = Math.floor(total / 1000) % 60;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const base = h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
  return hundredths ? `${base}.${p2(Math.floor(total / 10) % 100)}` : base;
}

/** The stopwatch's big readout: hours, minutes and seconds always two digits ("00:00:00"), and the hundredths. */
export function stopwatchParts(ms: number): { main: string; cs: string } {
  const total = Math.max(0, Math.floor(ms));
  const p2 = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(total / 3_600_000), m = Math.floor(total / 60_000) % 60, s = Math.floor(total / 1000) % 60;
  return { main: `${p2(h)}:${p2(m)}:${p2(s)}`, cs: p2(Math.floor(total / 10) % 100) };
}

/** What's left on a timer at [now]. */
export const timerLeft = (t: { endAt: number | null; remainingMs: number }, now: number) =>
  t.endAt !== null ? Math.max(0, t.endAt - now) : t.remainingMs;

/** The stopwatch's time at [now]. */
export const elapsed = (sw: { startedAt: number | null; accumulatedMs: number }, now: number) =>
  sw.accumulatedMs + (sw.startedAt !== null ? Math.max(0, now - sw.startedAt) : 0);

/** Each lap's own length, oldest first. */
export const lapLengths = (laps: number[]) => laps.map((t, i) => t - (i > 0 ? laps[i - 1] : 0));

export const TIMER_PRESETS = [1, 3, 5, 10, 15, 30, 60];
export const presetText = (min: number) => (min >= 60 ? `${min / 60} h` : `${min} min`);

// ---------- World clock ----------

/** The city part of a zone id: "America/New_York" → "New York". */
export const cityName = (zone: string) => zone.slice(zone.lastIndexOf("/") + 1).replace(/_/g, " ");

const REGIONS = new Set(["Africa", "America", "Antarctica", "Asia", "Atlantic", "Australia", "Europe", "Indian", "Pacific"]);
/** The zones the city picker offers (like native: region/city ids only), by city name. */
export function cityZones(all: string[]): string[] {
  return all.filter((z) => z.includes("/") && REGIONS.has(z.slice(0, z.indexOf("/")))).sort((a, b) => cityName(a).localeCompare(cityName(b)));
}

const parts = new Map<string, Intl.DateTimeFormat>();
function wall(zone: string, at: number): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  let f = parts.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    parts.set(zone, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(at))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

/** A zone's offset from UTC at [at], in minutes. */
export function zoneOffsetMin(zone: string, at: number): number {
  const w = wall(zone, at);
  return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(at / 1000) * 1000) / 60_000);
}

/** How far [zone] is from [local] at [at]: "Same time", "+1 h", "−5 h 30 min" (ClockTools.offsetLabel). */
export function zoneOffsetLabel(zone: string, at: number, local: string): string {
  const diff = zoneOffsetMin(zone, at) - zoneOffsetMin(local, at);
  if (diff === 0) return "Same time";
  const abs = Math.abs(diff), h = Math.floor(abs / 60), m = abs % 60;
  return (diff < 0 ? "−" : "+") + (h > 0 ? `${h} h` : "") + (h > 0 && m > 0 ? " " : "") + (m > 0 ? `${m} min` : "");
}

/** "Tomorrow" / "Yesterday" when [zone] is on another day than [local], else null (ClockTools.dayLabel). */
export function zoneDayLabel(zone: string, at: number, local: string): string | null {
  const a = wall(zone, at), b = wall(local, at);
  const there = Date.UTC(a.y, a.mo - 1, a.d), here = Date.UTC(b.y, b.mo - 1, b.d);
  return there > here ? "Tomorrow" : there < here ? "Yesterday" : null;
}

/** Time of day with seconds in [zone]: "14:05:09" or "2:05:09 PM". */
export function zoneClock(zone: string, at: number, use24h: boolean): string {
  const w = wall(zone, at);
  const p2 = (n: number) => String(n).padStart(2, "0");
  if (use24h) return `${p2(w.h)}:${p2(w.mi)}:${p2(w.s)}`;
  const h12 = w.h % 12 === 0 ? 12 : w.h % 12;
  return `${h12}:${p2(w.mi)}:${p2(w.s)} ${w.h < 12 ? "AM" : "PM"}`;
}

/** The hour of day in [zone] (for a day or night weather symbol). */
export const zoneHour = (zone: string, at: number) => wall(zone, at).h;

// ---------- Weather (Open-Meteo's WMO codes) ----------

/** A symbol (icon name) and a word for an Open-Meteo weather code. */
export function weatherSymbol(code: number, day: boolean): { icon: string; label: string } {
  if (code === 0) return day ? { icon: "oWbSunny", label: "Clear" } : { icon: "oNightsStay", label: "Clear" };
  if (code <= 2) return day ? { icon: "oFilterDrama", label: "Partly cloudy" } : { icon: "oNightsStay", label: "Partly cloudy" };
  if (code === 3) return { icon: "oCloud", label: "Cloudy" };
  if (code === 45 || code === 48) return { icon: "oWbCloudy", label: "Fog" };
  if (code >= 51 && code <= 57) return { icon: "oGrain", label: "Drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: "oUmbrella", label: "Rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: "oAcUnit", label: "Snow" };
  if (code >= 95) return { icon: "oThunderstorm", label: "Thunderstorm" };
  return { icon: "oCloud", label: "Cloudy" };
}

/** An hourly forecast: hour starts (ms), °C and weather codes (alarms/weather.ts). */
export interface HourlyForecast { at: number[]; t: number[]; c: number[] }

/** The weather in the hour holding [at] ("12°C" and its symbol), or null when the forecast doesn't reach it. */
export function forecastAt(h: HourlyForecast | null, at: Date | null): { text: string; icon: string; label: string } | null {
  if (!h || !at) return null;
  const ts = at.getTime();
  const i = h.at.findIndex((s) => ts >= s && ts < s + 3600_000);
  if (i < 0 || i >= h.t.length || i >= h.c.length) return null;
  const hour = at.getHours();
  return { text: `${Math.round(h.t[i])}°C`, ...weatherSymbol(h.c[i], hour >= 6 && hour < 20) };
}

/** Countries that read temperatures in Fahrenheit. */
const FAHRENHEIT = new Set(["US", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH", "PR", "GU", "VI", "AS", "MP", "UM"]);
/** °F for locales of those countries ("en-US"), else °C. */
export function usesFahrenheit(locale: string): boolean {
  const region = locale.split(/[-_]/).slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
  return !!region && FAHRENHEIT.has(region.toUpperCase());
}

export const toFahrenheit = (c: number) => c * 9 / 5 + 32;
