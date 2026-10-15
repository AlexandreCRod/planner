// Port of app/.../domain/QuickAddParser.kt. Dates with slashes are day/month.
import { addMonths, epochOf, today as todayEpoch, weekday, ymd } from "./dates.ts";
import { dayBit, hasWeekDay } from "./recurrence.ts";
import type { AlertType, Freq } from "./types.ts";

export interface QuickAdd {
  title: string;
  day: number | null;
  startMin: number | null;
  endMin: number | null;
  freq: Freq;
  interval: number;
  weekDays: number;
  alerts: [number, AlertType][];
  priority: number;
  tags: string[];
}

const WD_NAMES: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WD = "(mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)";
const TIME = "(\\d{1,2})(?::(\\d{2})|h(\\d{2})?)?\\s*(am|pm)?";

const unitMinutes = (u: string) => ({ m: 1, h: 60, d: 1440, w: 10080 } as Record<string, number>)[u[0].toLowerCase()] ?? 1;
const freqOf = (u: string): Freq => ({ d: "DAILY", w: "WEEKLY", m: "MONTHLY" } as Record<string, Freq>)[u[0].toLowerCase()] ?? "YEARLY";

function toMinutes(h: string, m: string, ampm: string): number | null {
  let hour = parseInt(h, 10);
  const min = m ? parseInt(m, 10) : 0;
  if (Number.isNaN(hour)) return null;
  if (ampm.toLowerCase() === "am" && hour === 12) hour = 0;
  if (ampm.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;
  return hour * 60 + min;
}

function monthDay(d: number, mon: string, today: number): number | null {
  const mo = MONTHS.indexOf(mon.toLowerCase().slice(0, 3)) + 1;
  const { y } = ymd(today);
  if (mo < 1 || d < 1 || d > 31) return null;
  let e = epochOf(y, mo, d);
  if (ymd(e).d !== d) return null;
  if (e < today) e = epochOf(y + 1, mo, d);
  return e;
}

const UNIT = "(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)";
const UNIT_NC = "(?:m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)";

/**
 * An alert phrase: [free] words count anywhere ("remind me"); [guarded] words ("alarm") only after
 * "!" or "with/set/add", before a lead time or "at time", or as the last word. An optional lead
 * time ("10 min before") is captured in groups 1-2.
 */
function alertPhrase(guarded: string, free: string): RegExp {
  const g = `(?:${guarded})`, f = `(?:${free})`;
  return new RegExp(
    String.raw`\s(?:!(?:${g}|${f})|(?:with|set|add|plus|and)\s+(?:an?\s+)?(?:${g}|${f})|${f}|${g}(?=\s+\d+\s*${UNIT_NC}|\s+at\s+(?:the\s+)?time|\s*$))` +
      String.raw`(?:\s+(\d+)\s*${UNIT}(?:\s+(?:before|early|earlier))?)?(?:\s+at\s+(?:the\s+)?time)?(?=\s)`,
    "i",
  );
}

/** Tidies what's left once dates, times and options are taken out, including dangling "with" or "and". */
function cleanTitle(text: string): string {
  let title = text.replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== title;) {
    prev = title;
    title = title.replace(/[\s,;-]+$/, "").replace(/\s+(and|with|at|on|plus|by)$/i, "").replace(/^(and|with|plus)\s+/i, "").trim();
  }
  return title;
}

export function parseQuickAdd(input: string, today = todayEpoch()): QuickAdd {
  let text = ` ${input} `;
  let day: number | null = null, start: number | null = null, end: number | null = null;
  let freq = "NONE" as Freq, interval = 1, weekDays = 0, priority = 0;
  let alarm = false, silent = false, atTime = false;
  const offsets: number[] = [];
  const tags: string[] = [];

  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(text);
    if (m) { fn(m); text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length); }
  };
  const takeAll = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    for (let m = re.exec(text); m; m = re.exec(text)) { fn(m); text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length); }
  };
  const ci = (p: string) => new RegExp(p, "i");

  takeAll(/(?<=\s)#([\p{L}\d_-]+)/u, (m) => tags.push(m[1]));
  // Alerts. "!alarm", "with alarm", "alarm 10 min before" or a final "alarm" add an alarm;
  // "remind me", "reminder 1h before" or "with reminder" add a reminder; "notify" / "silent" make
  // reminders silent. Plain words like "alarm" only count in those positions, so "Buy alarm clock"
  // stays a title. Whatever is understood is removed from the title.
  const alarmOffsets: number[] = [];
  let reminderAsked = false;
  takeAll(alertPhrase("alarms?|alerts?", "(?!)"), (m) => {
    alarm = true;
    alarmOffsets.push(m[1] ? parseInt(m[1], 10) * unitMinutes(m[2]) : 0);
  });
  takeAll(alertPhrase("reminders?", String.raw`remind(?:\s+me)?`), (m) => {
    reminderAsked = true;
    if (m[1]) offsets.push(parseInt(m[1], 10) * unitMinutes(m[2])); else atTime = true;
  });
  takeAll(alertPhrase(String.raw`notifications?|silent(?:ly)?`, String.raw`notify(?:\s+me)?`), (m) => {
    silent = true;
    if (m[1]) offsets.push(parseInt(m[1], 10) * unitMinutes(m[2]));
  });
  // More times for the same alert: "remind 1 day before and 1 hour before".
  takeAll(ci(String.raw`\s(?:and\s+|,\s*)?(\d+)\s*${UNIT}\s+(?:before|early|earlier)\b`), (m) => {
    const o = parseInt(m[1], 10) * unitMinutes(m[2]);
    if (alarm && !reminderAsked && !silent) alarmOffsets.push(o); else offsets.push(o);
  });
  take(ci(String.raw`\s(?:!(low|med|medium|high|urgent)|(low|medium|high|urgent)\s+priority|priority\s+(low|medium|high|urgent))\b`), (m) => {
    priority = ({ low: 1, med: 2, medium: 2, high: 3 } as Record<string, number>)[(m[1] ?? m[2] ?? m[3]).toLowerCase()] ?? 4;
  });

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

  take(ci(`\\s(?:at\\s+)?${TIME}\\s*(?:-|to|until)\\s*${TIME}(?=\\s)`), (m) => {
    const endAmPm = m[8] ?? "";
    start = toMinutes(m[1], m[2] ?? m[3] ?? "", m[4] ?? endAmPm);
    end = toMinutes(m[5], m[6] ?? m[7] ?? "", endAmPm);
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
  take(ci("\\s(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b"), (m) => {
    const d = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    let y = m[3] ? parseInt(m[3], 10) : null;
    if (y !== null && y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
    let e = epochOf(y ?? ymd(today).y, mo, d);
    if (ymd(e).d !== d) return;
    if (y === null && e < today) e = epochOf(ymd(today).y + 1, mo, d);
    day = e;
  });
  take(ci("\\s(\\d{1,2})(?:st|nd|rd|th)?\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\b"), (m) => { day = monthDay(parseInt(m[1], 10), m[2], today) ?? day; });
  take(ci("\\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b"), (m) => { day = monthDay(parseInt(m[2], 10), m[1], today) ?? day; });
  take(ci(`\\s(?:on\\s+)?(next\\s+)?${WD}\\b`), (m) => {
    const dow = WD_NAMES[m[2].toLowerCase()];
    let d = today + ((dow - weekday(today) + 7) % 7);
    if (m[1] && d === today) d += 7;
    day = d;
    if (freq === "WEEKLY" && weekDays === 0) weekDays = dayBit(dow);
  });

  if (day === null && (start !== null || freq !== "NONE")) day = today;
  if (freq === "WEEKLY" && weekDays !== 0 && day !== null) {
    let d: number = day;
    for (let i = 0; i < 7 && !hasWeekDay(weekDays, weekday(d)); i++) d++;
    day = d;
  }
  if (start !== null && end === null) end = Math.min((start as number) + 60, 1439);

  if (atTime || (silent && offsets.length === 0)) offsets.push(0);
  const remindType: AlertType = silent ? "NOTIFICATION" : "REMINDER";
  const alerts: [number, AlertType][] = [...new Set(offsets)].map((o) => [o, remindType]);
  for (const o of new Set(alarmOffsets)) alerts.push([o, "ALARM"]);
  const title = cleanTitle(text);
  return { title, day, startMin: start, endMin: end, freq, interval, weekDays, alerts, priority, tags };
}
