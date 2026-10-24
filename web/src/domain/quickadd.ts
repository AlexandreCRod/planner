// Port of app/.../domain/QuickAddParser.kt, grown on the phone. Dates with slashes are day/month.
// Besides the native forms it reads date ranges ("27 Oct till 8 Nov", "27oct-8nov", "27/10-8/11",
// "27-30 Oct"), an end for a repeat ("every mon until 8 Nov"), reminders after the start ("alarm 10m
// after"), a category ("#work", when a category has that name), a priority by number ("!1" is the
// most urgent, "!4" the least) and a place ("@Decathlon", or "@" and a name in quotes). What's
// understood leaves the title.
import { addMonths, epochOf, today as todayEpoch, weekday, ymd } from "./dates.ts";
import { dayBit, hasWeekDay } from "./recurrence.ts";
import type { AlertType, Freq } from "./types.ts";

export interface QuickAdd {
  title: string;
  day: number | null;
  /** The last day of a date range ("27 Oct till 8 Nov"); null for one day. */
  endDay: number | null;
  startMin: number | null;
  endMin: number | null;
  freq: Freq;
  interval: number;
  weekDays: number;
  /** A repeat's last day ("every mon until 8 Nov"). */
  untilDay: number | null;
  /** Minutes before the start (negative: after it) and the kind. */
  alerts: [number, AlertType][];
  priority: number;
  tags: string[];
  /** The category named with "#" (its name as the category list has it), or null. */
  category: string | null;
  /** The place given with "@". */
  place: string | null;
}

const WD_NAMES: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WD = "(mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)";
const TIME = "(\\d{1,2})(?::(\\d{2})|h(\\d{2})?)?\\s*(am|pm)?";

// One date, written any of the ways the line understands (no groups inside, so they can be combined).
const MON = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const ORD = "(?:st|nd|rd|th)?";
const DATE = `(?:\\d{1,2}${ORD}\\s*${MON}|${MON}\\s*\\d{1,2}${ORD}(?![:\\d])|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)`;
const BARE_DAY = `\\d{1,2}${ORD}`;
const RANGE_SEP = "\\s*(?:-|–|—|\\bto\\b|\\btill\\b|\\btil\\b|\\buntil\\b|\\bthrough\\b|\\bthru\\b)\\s*";
const END = "(?=[\\s,.;!?])";

const unitMinutes = (u: string) => ({ m: 1, h: 60, d: 1440, w: 10080 } as Record<string, number>)[u[0].toLowerCase()] ?? 1;
const freqOf = (u: string): Freq => ({ d: "DAILY", w: "WEEKLY", m: "MONTHLY" } as Record<string, Freq>)[u[0].toLowerCase()] ?? "YEARLY";
/** "after" / "later" make a lead time come after the start (a negative offset). */
const signOf = (dir: string | undefined) => (dir && /^(after|later)$/i.test(dir) ? -1 : 1);

function toMinutes(h: string, m: string, ampm: string): number | null {
  let hour = parseInt(h, 10);
  const min = m ? parseInt(m, 10) : 0;
  if (Number.isNaN(hour)) return null;
  if (ampm.toLowerCase() === "am" && hour === 12) hour = 0;
  if (ampm.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;
  return hour * 60 + min;
}

/** A written date's day, month and year (null when it gave none); null when it isn't one. */
interface DMY { d: number; m: number | null; y: number | null }
function readDate(text: string): DMY | null {
  const s = text.trim().toLowerCase().replace(/\.$/, "");
  let r: RegExpExecArray | null;
  const mon = (w: string) => MONTHS.indexOf(w.slice(0, 3)) + 1;
  if ((r = /^(\d{1,2})(?:st|nd|rd|th)?\s*([a-z]+)\.?$/.exec(s))) return { d: +r[1], m: mon(r[2]) || null, y: null };
  if ((r = /^([a-z]+)\.?\s*(\d{1,2})(?:st|nd|rd|th)?$/.exec(s))) return { d: +r[2], m: mon(r[1]) || null, y: null };
  if ((r = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s))) {
    const y = r[3] ? (+r[3] < 100 ? +r[3] + 2000 : +r[3]) : null;
    return { d: +r[1], m: +r[2], y };
  }
  if ((r = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(s))) return { d: +r[1], m: null, y: null };
  return null;
}

/** The epoch day of [d]/[m]/[y], or null if there's no such day. */
function dayOf(d: number, m: number, y: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const e = epochOf(y, m, d);
  return ymd(e).d === d ? e : null;
}

/** A single date: in its own year if it gave one, else the next time it comes (today included). */
function oneDate(t: DMY, today: number): number | null {
  if (t.m === null) return null;
  const y0 = ymd(today).y;
  const e = dayOf(t.d, t.m, t.y ?? y0);
  if (e === null) return null;
  if (t.y === null && e < today) return dayOf(t.d, t.m, y0 + 1);
  return e;
}

/**
 * A date range's first and last days. A side that gave only a day takes the other's month; without a
 * year the range is this year's, or next year's once it has ended; an end before the start runs into
 * the next year ("28 Dec - 3 Jan").
 */
function dateRange(a: DMY, b: DMY, today: number): [number, number] | null {
  const am = a.m ?? b.m, bm = b.m ?? a.m;
  if (am === null || bm === null) return null;
  const y0 = ymd(today).y;
  let ya = a.y ?? b.y ?? y0, yb = b.y ?? ya;
  let start = dayOf(a.d, am, ya), end = dayOf(b.d, bm, yb);
  if (start === null || end === null) return null;
  if (end < start && b.y === null) { yb = ya + 1; end = dayOf(b.d, bm, yb); if (end === null) return null; }
  if (end < start) return null;
  if (a.y === null && b.y === null && end < today) {
    ya += 1; yb += 1;
    start = dayOf(a.d, am, ya); end = dayOf(b.d, bm, yb);
    if (start === null || end === null) return null;
  }
  return [start, end];
}

const UNIT = "(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)";
const UNIT_NC = "(?:m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)";
const DIR = "(before|early|earlier|after|later)";

/**
 * An alert phrase: [free] words count anywhere ("remind me"); [guarded] words ("alarm") only after
 * "!" or "with/set/add", before a lead time or "at time", or as the last word. An optional lead
 * time ("10 min before", "10 min after") is captured in groups 1-3.
 */
function alertPhrase(guarded: string, free: string): RegExp {
  const g = `(?:${guarded})`, f = `(?:${free})`;
  return new RegExp(
    String.raw`\s(?:!(?:${g}|${f})|(?:with|set|add|plus|and)\s+(?:an?\s+)?(?:${g}|${f})|${f}|${g}(?=\s+\d+\s*${UNIT_NC}|\s+at\s+(?:the\s+)?time|\s*$))` +
      String.raw`(?:\s+(\d+)\s*${UNIT}(?:\s+${DIR})?)?(?:\s+at\s+(?:the\s+)?time)?(?=\s)`,
    "i",
  );
}

/** Tidies what's left once dates, times and options are taken out, including dangling "with" or "and". */
function cleanTitle(text: string): string {
  let title = text.replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== title;) {
    prev = title;
    title = title.replace(/[\s,;-]+$/, "").replace(/\s+(and|with|at|on|plus|by|from)$/i, "").replace(/^(and|with|plus)\s+/i, "").trim();
  }
  return title;
}

/** A category name as "#" can write it: no case, spaces, dashes or underscores. */
const catKey = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/**
 * Reads the add line. [categories]: the category names "#name" can pick (the first match is the
 * category, other "#words" are tags).
 */
export function parseQuickAdd(input: string, today = todayEpoch(), categories: readonly string[] = []): QuickAdd {
  let text = ` ${input} `;
  let day: number | null = null, endDay: number | null = null, untilDay: number | null = null;
  let start: number | null = null, end: number | null = null;
  let freq = "NONE" as Freq, interval = 1, weekDays = 0, priority = 0;
  let alarm = false, silent = false, atTime = false;
  let category: string | null = null, place: string | null = null;
  const offsets: number[] = [];
  const tags: string[] = [];

  /** Takes the first match out of the text, unless [fn] turns it down (returns false). */
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void | false) => {
    const m = re.exec(text);
    if (m && fn(m) !== false) text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
  };
  const takeAll = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    for (let m = re.exec(text); m; m = re.exec(text)) { fn(m); text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length); }
  };
  const ci = (p: string) => new RegExp(p, "i");

  // "Remind me to call mom": the request goes, and so does its "to" (the reminder stays).
  const remindLead = /^\s*remind(?:\s+me)?\s+(?:to|about)\s+/i.exec(input);
  if (remindLead) text = ` remind me ${input.slice(remindLead[0].length)} `;

  const keys = new Map(categories.map((c) => [catKey(c), c]));
  takeAll(/(?<=\s)#([\p{L}\d_-]+)/u, (m) => {
    const c = keys.get(catKey(m[1]));
    if (c !== undefined && category === null) category = c; else tags.push(m[1]);
  });
  take(/(?<=\s)@(?:"([^"]+)"|“([^”]+)”|([^\s@"]+))/u, (m) => { place = (m[1] ?? m[2] ?? m[3]).trim() || null; });
  // Alerts. "!alarm", "with alarm", "alarm 10 min before" or a final "alarm" add an alarm;
  // "remind me", "reminder 1h before" or "with reminder" add a reminder; "notify" / "silent" make
  // reminders silent. Plain words like "alarm" only count in those positions, so "Buy alarm clock"
  // stays a title. "after" puts the lead time after the start. Whatever is understood is removed.
  const alarmOffsets: number[] = [];
  let reminderAsked = false;
  const lead = (m: RegExpExecArray) => signOf(m[3]) * parseInt(m[1], 10) * unitMinutes(m[2]);
  takeAll(alertPhrase("alarms?|alerts?", "(?!)"), (m) => {
    alarm = true;
    alarmOffsets.push(m[1] ? lead(m) : 0);
  });
  takeAll(alertPhrase("reminders?", String.raw`remind(?:\s+me)?`), (m) => {
    reminderAsked = true;
    if (m[1]) offsets.push(lead(m)); else atTime = true;
  });
  takeAll(alertPhrase(String.raw`notifications?|silent(?:ly)?`, String.raw`notify(?:\s+me)?`), (m) => {
    silent = true;
    if (m[1]) offsets.push(lead(m));
  });
  // More times for the same alert: "remind 1 day before and 1 hour before", "alarm 5m before and 10m after".
  takeAll(ci(String.raw`\s(?:and\s+|,\s*)?(\d+)\s*${UNIT}\s+${DIR}\b`), (m) => {
    const o = lead(m);
    if (alarm && !reminderAsked && !silent) alarmOffsets.push(o); else offsets.push(o);
  });
  take(ci(String.raw`\s(?:!(low|med|medium|high|urgent)|(low|medium|high|urgent)\s+priority|priority\s+(low|medium|high|urgent))\b`), (m) => {
    priority = ({ low: 1, med: 2, medium: 2, high: 3 } as Record<string, number>)[(m[1] ?? m[2] ?? m[3]).toLowerCase()] ?? 4;
  });
  // "!1" is the most urgent, "!4" the least (as P1 to P4); "!0" none.
  if (!priority) take(/\s!([0-4])(?=\s)/, (m) => { priority = m[1] === "0" ? 0 : 5 - Number(m[1]); });

  take(ci("\\s(?:every\\s+weekday|weekdays)\\b"), () => { freq = "WEEKLY"; weekDays = 0b0011111; });
  take(ci("\\severy\\s+(\\d+)\\s+(days?|weeks?|months?|years?)\\b"), (m) => { interval = parseInt(m[1], 10); freq = freqOf(m[2]); });
  take(ci(`\\severy\\s+(${WD}(?:\\s*(?:,|and|&)\\s*${WD})*)\\b`), (m) => {
    freq = "WEEKLY";
    for (const w of m[1].match(new RegExp(WD, "gi")) ?? []) weekDays |= dayBit(WD_NAMES[w.toLowerCase()]);
  });
  take(ci("\\s(?:every\\s+(day|week|month|year)|(daily|weekly|monthly|yearly|annually))\\b"), (m) => {
    const w = (m[1] ?? m[2]).toLowerCase();
    freq = w.startsWith("d") ? "DAILY" : w.startsWith("w") ? "WEEKLY" : w.startsWith("m") ? "MONTHLY" : "YEARLY";
  });
  // A repeat's end: "every mon until 8 Nov".
  if (freq !== "NONE") {
    take(ci(`\\s(?:until|till|til|through|thru|ends?)\\s+(${DATE})${END}`), (m) => {
      const t = readDate(m[1]);
      const e = t ? oneDate(t, today) : null;
      if (e === null) return false;
      untilDay = e;
    });
  }

  // Dates: a range first ("27 Oct till 8 Nov", "27oct-8nov", "27/10-8/11", "27-30 Oct"), then one day.
  take(ci(`\\s(?:from\\s+)?(${DATE}|${BARE_DAY})${RANGE_SEP}(${DATE}|${BARE_DAY})${END}`), (m) => {
    const a = readDate(m[1]), b = readDate(m[2]);
    if (!a || !b || (a.m === null && b.m === null)) return false;
    const r = dateRange(a, b, today);
    if (!r) return false;
    [day, endDay] = r;
    if (endDay === day) endDay = null;
  });
  if (day === null) {
    take(ci(`\\s(?:on\\s+)?(${DATE})${END}`), (m) => {
      const t = readDate(m[1]);
      const e = t ? oneDate(t, today) : null;
      if (e === null) return false;
      day = e;
    });
  }

  take(ci(`\\s(?:at\\s+)?${TIME}\\s*(?:-|–|to|until)\\s*${TIME}(?=\\s)`), (m) => {
    const endAmPm = m[8] ?? "";
    const s = toMinutes(m[1], m[2] ?? m[3] ?? "", m[4] ?? endAmPm), e = toMinutes(m[5], m[6] ?? m[7] ?? "", endAmPm);
    if (s === null || e === null) return false;
    start = s; end = e;
  });
  if (start === null) take(ci("\\s(?:at\\s+)?(\\d{1,2})(?::(\\d{2})|h(\\d{2})?)\\s*(am|pm)?(?=\\s)"), (m) => { start = toMinutes(m[1], m[2] ?? m[3] ?? "", m[4] ?? ""); });
  if (start === null) take(ci("\\s(?:at\\s+)?(\\d{1,2})\\s*(am|pm)(?=\\s)"), (m) => { start = toMinutes(m[1], "", m[2]); });
  if (start === null) take(ci("\\sat\\s+(\\d{1,2})(?=\\s)"), (m) => { start = toMinutes(m[1], "", ""); });
  take(ci("\\s(noon|midday)\\b"), () => { start = 720; });
  take(ci("\\s(tonight)\\b"), () => { if (start === null) start = 1200; day = today; });
  take(ci("\\sfor\\s+(\\d+)\\s*(m|min|mins|minutes?|h|hrs?|hours?)\\b"), (m) => {
    if (start !== null) end = Math.min(start + parseInt(m[1], 10) * unitMinutes(m[2]), 1439);
  });

  take(ci("\\s(today)\\b"), () => { day = today; });
  take(ci("\\s(tomorrow|tmrw|tmr)\\b"), () => { day = today + 1; });
  take(ci("\\sin\\s+(\\d+)\\s+(days?|weeks?|months?)\\b"), (m) => {
    const n = parseInt(m[1], 10), f = freqOf(m[2]);
    day = f === "WEEKLY" ? today + 7 * n : f === "MONTHLY" ? addMonths(today, n) : today + n;
  });
  take(ci(`\\s(?:on\\s+)?(next\\s+)?${WD}\\b`), (m) => {
    const dow = WD_NAMES[m[2].toLowerCase()];
    let d = today + ((dow - weekday(today) + 7) % 7);
    if (m[1] && d === today) d += 7;
    day = d;
    if (freq === "WEEKLY" && weekDays === 0) weekDays = dayBit(dow);
  });

  if (day === null && (start !== null || freq !== "NONE")) day = today;
  if (freq === "WEEKLY" && weekDays !== 0 && day !== null && endDay === null) {
    let d: number = day;
    for (let i = 0; i < 7 && !hasWeekDay(weekDays, weekday(d)); i++) d++;
    day = d;
  }
  if (start !== null && end === null) end = Math.min((start as number) + 60, 1439);

  // A bare "remind me" asks for a reminder at the time; with an alarm typed, the alarm is that reminder
  // ("Remind me to call mom 3pm alarm" rings once, with no extra notification at 3pm).
  if ((atTime && !alarm) || (silent && offsets.length === 0)) offsets.push(0);
  const remindType: AlertType = silent ? "NOTIFICATION" : "REMINDER";
  const alerts: [number, AlertType][] = [...new Set(offsets)].map((o) => [o, remindType]);
  for (const o of new Set(alarmOffsets)) alerts.push([o, "ALARM"]);
  let title = cleanTitle(text);
  // The request taken from the front ("Remind me to call mom"): the title starts with a capital, as typed.
  if (remindLead && /^\s*[A-Z]/.test(input) && title) title = title[0].toUpperCase() + title.slice(1);
  return { title, day, endDay, startMin: start, endMin: end, freq, interval, weekDays, untilDay, alerts, priority, tags, category, place };
}

// ---------- Timers and alarm clocks from the add line (phone) ----------
// The native quick-add line only makes tasks and events. On the phone, which has the Alarms page, the
// same line can also start a timer or set an alarm clock, when it clearly asks for one:
//   "timer 10 min", "pasta timer 12m", "set a timer for 1h 30m", "timer 5:00 tea", "tea 4 min timer"
//   "alarm 6:30", "alarm 7am weekdays gym", "set an alarm for 6:45 mon wed fri", "wake me up at 7",
//   "alarm in 20 min", "wake me in 8 hours"
// "timer" must be there with a length; an alarm must start with "alarm" / "set an alarm" / "wake me"
// and give a clock time (or "in ..."). Anything else ("Buy alarm clock", "Dentist 3pm alarm",
// "alarm 10 min before") stays an item, read by parseQuickAdd as before.

export type ClockCommand =
  | { kind: "timer"; durationMs: number; label: string }
  | { kind: "alarm"; hour: number; minute: number; days: number; label: string };

const DUR_UNIT = "(h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)";
const unitMs = (u: string) => {
  const c = u[0].toLowerCase();
  return c === "h" ? 3_600_000 : c === "m" ? 60_000 : 1000;
};
const tidyLabel = (t: string) => t.replace(/\s+/g, " ").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").replace(/^(for|at|to|on)\s+/i, "").replace(/\s+(for|at|to|on|and)$/i, "").trim();

/** A timer or alarm clock asked for on the add line, or null when it's an ordinary item. */
export function parseClockCommand(input: string, now = new Date()): ClockCommand | null {
  const text = ` ${input.trim()} `;
  if (/\btimer\b|\bcountdown\b/i.test(text)) return parseTimer(text);
  if (/^\s(?:set\s+(?:an?\s+|the\s+)?)?alarm\b|^\swake\s+me\b/i.test(text)) return parseAlarm(text, now);
  return null;
}

function parseTimer(input: string): ClockCommand | null {
  let text = input.replace(/\s(?:set|start)\s+(?:an?\s+|the\s+)?(?=timer\b|countdown\b)/i, " ").replace(/\s(?:timer|countdown)\b/i, " ");
  let ms = 0;
  // "1:30:00" (h:mm:ss) or "5:00" (m:ss)
  text = text.replace(/\s(\d{1,2}):(\d{2})(?::(\d{2}))?(?=\s)/, (_m, a: string, b: string, c?: string) => {
    ms += c !== undefined ? (+a * 3600 + +b * 60 + +c) * 1000 : (+a * 60 + +b) * 1000;
    return " ";
  });
  // "1h30", "1h 30m", "90 sec", "1.5 h", "2 hours and 10 minutes"
  text = text.replace(/\s(\d{1,2})h(\d{2})(?=\s)/i, (_m, h: string, m: string) => { ms += +h * 3_600_000 + +m * 60_000; return " "; });
  const re = new RegExp(String.raw`\s(?:and\s+|for\s+)?(\d+(?:[.,]\d+)?)\s*${DUR_UNIT}(?=[\s,])`, "i");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    ms += parseFloat(m[1].replace(",", ".")) * unitMs(m[2]);
    text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
  }
  ms = Math.round(ms);
  if (ms <= 0 || ms > 100 * 3_600_000) return null;
  return { kind: "timer", durationMs: ms, label: tidyLabel(text) };
}

function parseAlarm(input: string, now: Date): ClockCommand | null {
  // Lead times belong to an item's alarm ("alarm 10 min before", "alarm 5 min after"), not to an alarm clock.
  if (/\b(before|earlier|early|after|later)\b/i.test(input)) return null;
  let text = input.replace(/^\s(?:set\s+(?:an?\s+|the\s+)?alarm|alarm|wake\s+me(?:\s+up)?)\b/i, " ");
  let hour = null as number | null, minute = 0, days = 0;
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(text);
    if (m) { fn(m); text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length); }
  };
  // "in 20 min", "in 8 hours": a one-off alarm that far from now.
  take(/\s(?:for\s+)?in\s+(\d+)\s*(h|hrs?|hours?|m|mins?|minutes?)(?=\s)/i, (m) => {
    const at = new Date(now.getTime() + +m[1] * (m[2][0].toLowerCase() === "h" ? 3_600_000 : 60_000));
    hour = at.getHours(); minute = at.getMinutes();
  });
  if (hour === null) {
    const set = (h: string, mm: string, ampm: string) => {
      let x = parseInt(h, 10);
      const y = mm ? parseInt(mm, 10) : 0;
      if (ampm.toLowerCase() === "am" && x === 12) x = 0;
      if (ampm.toLowerCase() === "pm" && x < 12) x += 12;
      if (x >= 0 && x <= 23 && y >= 0 && y <= 59) { hour = x; minute = y; }
    };
    take(/\s(?:for\s+|at\s+)?(\d{1,2})(?::(\d{2})|h(\d{2})?)\s*(am|pm)?(?=\s)/i, (m) => set(m[1], m[2] ?? m[3] ?? "", m[4] ?? ""));
    if (hour === null) take(/\s(?:for\s+|at\s+)?(\d{1,2})\s*(am|pm)(?=\s)/i, (m) => set(m[1], "", m[2]));
    if (hour === null) take(/\s(?:for\s+)?at\s+(\d{1,2})(?=\s)/i, (m) => set(m[1], "", ""));
    if (hour === null) take(/\s(?:at\s+)?(noon|midday)(?=\s)/i, () => set("12", "", ""));
  }
  if (hour === null) return null;
  take(/\s(?:on\s+)?(?:every\s+weekday|weekdays)\b/i, () => { days = 0b0011111; });
  take(/\s(?:on\s+)?(?:every\s+weekend|weekends)\b/i, () => { days = 0b1100000; });
  take(/\s(?:every\s*day|daily)\b/i, () => { days = 0b1111111; });
  take(new RegExp(String.raw`\s(?:every\s+|on\s+)?(${WD}(?:\s*(?:,|and|&)?\s*${WD})*)\b`, "i"), (m) => {
    for (const w of m[1].match(new RegExp(WD, "gi")) ?? []) days |= 1 << (WD_NAMES[w.toLowerCase()] - 1);
  });
  // "today" / "tomorrow": a one-off alarm rings at its next time anyway.
  take(/\s(today|tonight|tomorrow|tmrw|tmr)\b/i, () => {});
  return { kind: "alarm", hour, minute, days, label: tidyLabel(text) };
}
