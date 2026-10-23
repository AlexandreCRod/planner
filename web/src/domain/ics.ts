// Calendar invites (.ics files, RFC 5545), after the native app's domain/CalendarImport.kt: reads the
// events of an invitation such as the invite.ics Gmail attaches to a Google Calendar invitation, and
// turns one into the app's event fields. Only the file's text is read: no network, no Google account.
import { epochOf } from "./dates.ts";
import { LAST_DAY_OF_MONTH, dayBit, nextOnOrAfter } from "./recurrence.ts";
import { type Freq, type Item, newItem } from "./types.ts";

/** A wall-clock time: local days since 1970-01-01 and minutes after midnight. */
export interface LocalTime { day: number; min: number }

/** One VEVENT, with its times already moved into the phone's time zone. */
export interface IcsEvent {
  uid: string | null;
  title: string;
  description: string;
  location: string;
  start: LocalTime;
  end: LocalTime;
  allDay: boolean;
  rrule: string | null;
  exDays: number[];
  /** Minutes before the start of each of the event's alerts (negative: after it, as "10 minutes after"). */
  alerts: number[];
  /** Set on a changed occurrence of a series: the day it was originally on. */
  recurrenceOf: number | null;
  cancelled: boolean;
}

export interface IcsFile {
  /** The calendar's METHOD (REQUEST for an invitation, CANCEL when the organiser called it off), upper case. */
  method: string | null;
  events: IcsEvent[];
  /** VEVENTs that couldn't be read (no start, or a start in a shape we don't know). */
  skipped: number;
}

/** The app's repeat fields for an RRULE. */
export interface Repeat { freq: Freq; interval: number; weekDays: number; monthDays: string; months: number; untilDay: number | null; count: number | null }

const DAY_CODES: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
const MIN_DAY = 24 * 60;

// ---------- Time zones (through Intl, which knows the IANA database) ----------

/** The phone's own time zone. */
export const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(zone, f);
  }
  return f;
}
/** Whether Intl knows [zone] (some calendars write Windows names such as "W. Europe Standard Time"). */
export function knownZone(zone: string): boolean {
  try { formatter(zone); return true; } catch { return false; }
}
/** The wall-clock time in [zone] at the instant [ms], as milliseconds of a UTC-based clock. */
function wallMs(ms: number, zone: string): number {
  const p: Record<string, number> = {};
  for (const x of formatter(zone).formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
}
/** The instant at which the clocks in [zone] show [wall] (a gap in spring is read with the offset before it). */
function instantOf(wall: number, zone: string): number {
  let ms = wall - (wallMs(wall, zone) - wall);
  ms = wall - (wallMs(ms, zone) - ms);
  return ms;
}
function toLocal(ms: number, zone: string): LocalTime {
  const w = wallMs(ms, zone);
  const day = Math.floor(w / 86_400_000);
  return { day, min: Math.floor((w - day * 86_400_000) / 60_000) };
}

// ---------- Values ----------

/**
 * "20261015" (a whole day), "20261015T090000Z" (UTC), "20261015T090000" with a TZID, or floating local
 * time. Gives the time on this phone (in [zone]) and whether it's a whole day, or null when unreadable.
 */
export function parseDateTime(value: string, params: Record<string, string> | null, zone: string): { at: LocalTime; allDay: boolean } | null {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (params?.VALUE?.toUpperCase() === "DATE" || m[4] === undefined) return { at: { day: epochOf(y, mo, d), min: 0 }, allDay: true };
  const wall = Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  if (m[7]) return { at: toLocal(wall, zone), allDay: false };
  const from = params?.TZID;
  // A zone we don't know is taken as the phone's own, as the native import does.
  if (from && knownZone(from) && from !== zone) return { at: toLocal(instantOf(wall, from), zone), allDay: false };
  const day = Math.floor(wall / 86_400_000);
  return { at: { day, min: Math.floor((wall - day * 86_400_000) / 60_000) }, allDay: false };
}

/** "PT1H30M", "-PT15M", "P1D", "P1W", "P1DT2H", and Android's "P3600S", in minutes; null when unreadable. */
export function parseDuration(value: string): number | null {
  const v = value.trim().toUpperCase();
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v) ?? /^([+-])?P()()()()(\d+)S$/.exec(v);
  if (!m || v.replace(/^[+-]/, "") === "P" || v.endsWith("T")) return null;
  const n = (i: number) => Number(m[i] || 0);
  const min = n(2) * 7 * MIN_DAY + n(3) * MIN_DAY + n(4) * 60 + n(5) + Math.floor(n(6) / 60);
  return m[1] === "-" ? -min : min;
}

/**
 * Maps an RRULE ("FREQ=WEEKLY;BYDAY=MO,WE") onto the app's repeat fields, or null when it can't be
 * said with them (hourly rules, "second Tuesday", BYSETPOS...). Same rules as CalendarImport.repeatOf.
 */
export function repeatOf(rrule: string, zone: string = deviceZone()): Repeat | null {
  const parts: Record<string, string> = {};
  for (const p of rrule.replace(/^RRULE:/i, "").split(";")) {
    if (!p.trim()) continue;
    const i = p.indexOf("=");
    parts[(i < 0 ? p : p.slice(0, i)).trim().toUpperCase()] = i < 0 ? "" : p.slice(i + 1).trim();
  }
  const interval = parts.INTERVAL !== undefined ? parseInt(parts.INTERVAL, 10) : 1;
  if (!(interval >= 1)) return null;
  const known = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "UNTIL", "COUNT", "WKST"]);
  if (Object.keys(parts).some((k) => !known.has(k))) return null;
  const freq = parts.FREQ?.toUpperCase();
  if (parts.WKST && parts.WKST.toUpperCase() !== "MO" && interval > 1 && freq === "WEEKLY") return null;
  let untilDay: number | null = null;
  if (parts.UNTIL !== undefined) {
    const u = parseDateTime(parts.UNTIL, null, zone);
    if (!u) return null;
    untilDay = u.at.day;
  }
  let count: number | null = null;
  if (parts.COUNT !== undefined) {
    count = parseInt(parts.COUNT, 10);
    if (!(count > 0)) return null;
  }
  // Plain weekdays only ("MO,WE"); "1MO" or "-1FR" (nth weekday of the month) can't be expressed.
  let byDay: number[] | null = null;
  if (parts.BYDAY !== undefined) {
    byDay = [];
    for (const code of parts.BYDAY.split(",")) {
      const wd = DAY_CODES[code.trim().toUpperCase()];
      if (!wd) return null;
      byDay.push(wd);
    }
  }
  const weekMask = (byDay ?? []).reduce((acc, wd) => acc | dayBit(wd), 0);
  let monthDays = "";
  if (parts.BYMONTHDAY !== undefined) {
    const list: number[] = [];
    for (const v of parts.BYMONTHDAY.split(",")) {
      const n = Number(v.trim());
      if (Number.isInteger(n) && n >= 1 && n <= 31) list.push(n);
      else if (n === -1) list.push(LAST_DAY_OF_MONTH);
      else return null;
    }
    monthDays = [...new Set(list)].sort((a, b) => a - b).join(",");
  }
  let months = 0;
  if (parts.BYMONTH !== undefined) {
    for (const v of parts.BYMONTH.split(",")) {
      const n = Number(v.trim());
      if (!(Number.isInteger(n) && n >= 1 && n <= 12)) return null;
      months |= 1 << (n - 1);
    }
  }
  const base = { interval, weekDays: 0, monthDays: "", months: 0, untilDay, count };
  switch (freq) {
    case "DAILY":
      if (monthDays || months) return null;
      // "Every weekday" is often written as a daily rule limited to some days.
      if (byDay) return interval === 1 ? { ...base, freq: "WEEKLY", weekDays: weekMask } : null;
      return { ...base, freq: "DAILY" };
    case "WEEKLY":
      return monthDays || months ? null : { ...base, freq: "WEEKLY", weekDays: weekMask };
    case "MONTHLY":
      return byDay || months ? null : { ...base, freq: "MONTHLY", monthDays };
    case "YEARLY":
      return byDay ? null : { ...base, freq: "YEARLY", monthDays, months };
    default:
      return null;
  }
}

// ---------- The file ----------

interface Prop { name: string; params: Record<string, string>; value: string }

function parseProp(line: string): Prop | null {
  // The value starts at the first colon outside quotes (parameters can be quoted).
  let quoted = false, colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of head.slice(1)) {
    const i = p.indexOf("=");
    params[(i < 0 ? p : p.slice(0, i)).toUpperCase()] = i < 0 ? "" : p.slice(i + 1).replace(/^"|"$/g, "");
  }
  return { name: head[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

/** "\n", "\,", "\;" and "\\" in text values. */
export const unescapeText = (s: string) => s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** Reads every VEVENT of an iCalendar file, with its times in [zone] (the phone's own by default). */
export function parseIcs(text: string, zone: string = deviceZone()): IcsFile {
  // Long lines are folded: a line starting with a space or tab continues the one before.
  const lines: string[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length) lines[lines.length - 1] += raw.slice(1);
    else if (raw) lines.push(raw);
  }
  const events: IcsEvent[] = [];
  let skipped = 0, method: string | null = null;
  let props: Prop[] | null = null, triggers: string[] = [], inAlarm = false;
  for (const line of lines) {
    const p = parseProp(line);
    if (!p) continue;
    const v = p.value.trim().toUpperCase();
    if (p.name === "BEGIN" && v === "VEVENT") { props = []; triggers = []; }
    else if (p.name === "BEGIN" && v === "VALARM") inAlarm = true;
    else if (p.name === "END" && v === "VALARM") inAlarm = false;
    else if (p.name === "END" && v === "VEVENT") {
      const e = props ? eventOf(props, triggers, zone) : null;
      if (e) events.push(e); else skipped++;
      props = null;
    } else if (inAlarm) { if (p.name === "TRIGGER" && p.params.RELATED?.toUpperCase() !== "END") triggers.push(p.value); }
    else if (props) props.push(p);
    else if (p.name === "METHOD") method = v;
  }
  return { method, events, skipped };
}

function eventOf(props: Prop[], triggers: string[], zone: string): IcsEvent | null {
  const one = (name: string) => props.find((p) => p.name === name);
  const sp = one("DTSTART");
  if (!sp) return null;
  const s = parseDateTime(sp.value, sp.params, zone);
  if (!s) return null;
  const start = s.at;
  const plus = (t: LocalTime, min: number): LocalTime => {
    const total = t.day * MIN_DAY + t.min + min;
    const day = Math.floor(total / MIN_DAY);
    return { day, min: total - day * MIN_DAY };
  };
  let end: LocalTime | null = null;
  const ep = one("DTEND");
  if (ep) end = parseDateTime(ep.value, ep.params, zone)?.at ?? null;
  if (!end) { const dur = one("DURATION"); const m = dur ? parseDuration(dur.value) : null; if (m !== null) end = plus(start, m); }
  if (!end) end = s.allDay ? { day: start.day + 1, min: 0 } : start;
  const exDays = props.filter((p) => p.name === "EXDATE").flatMap((p) =>
    p.value.split(",").map((v) => parseDateTime(v, p.params, zone)?.at.day).filter((d): d is number => d !== undefined));
  const alerts = triggers.map(parseDuration).filter((d): d is number => d !== null && d <= 1440).map((d) => -d || 0);
  const rid = one("RECURRENCE-ID");
  return {
    uid: one("UID")?.value ?? null,
    title: unescapeText(one("SUMMARY")?.value ?? ""),
    description: unescapeText(one("DESCRIPTION")?.value ?? ""),
    location: unescapeText(one("LOCATION")?.value ?? ""),
    start, end, allDay: s.allDay,
    rrule: one("RRULE")?.value ?? null,
    exDays,
    alerts: [...new Set(alerts)],
    recurrenceOf: rid ? parseDateTime(rid.value, rid.params, zone)?.at.day ?? null : null,
    cancelled: one("STATUS")?.value.trim().toUpperCase() === "CANCELLED",
  };
}

// ---------- Into the app ----------

/**
 * Google's invitations append a block of joining details and account links to the description, between
 * "-::~:~::~:~…" lines. Only the organiser's own text is kept (nothing in it is opened or fetched).
 */
export function cleanDescription(text: string): string {
  const cut = text.search(/^-::~:~::~/m);
  return (cut >= 0 ? text.slice(0, cut) : text).replace(/\s+$/, "").replace(/^\s*\n/, "");
}

/** Plain text as the editor's HTML: one paragraph per line. */
export function textToHtml(text: string): string {
  const t = text.trim();
  if (!t) return "";
  return t.split("\n").map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join("");
}

/** The day of the [count]th occurrence, so "COUNT=10" becomes an end date. */
export function lastOfCount(item: Item, count: number): number | null {
  let d = item.startDay;
  if (d === null) return null;
  d = nextOnOrAfter(item, d) ?? d;
  for (let i = 1; i < count; i++) {
    const n = nextOnOrAfter(item, d + 1);
    if (n === null) return d;
    d = n;
  }
  return d;
}

export interface Invite {
  /** The new event, not saved (id 0). */
  item: Item;
  /** Minutes before the start, from the file's own alerts (may be empty). */
  alerts: number[];
  /** The file had a repeat rule the app can't say: the event is added once, and this says so. */
  repeatDropped: boolean;
}

/** The app's event for [e]. A repeat rule the app can't express is dropped (and reported), not guessed. */
export function inviteItem(e: IcsEvent, zone: string = deviceZone()): Invite {
  const startDay = e.start.day;
  let endDay = e.end.day;
  let startMin: number | null = e.start.min, endMin: number | null = e.end.min;
  if (e.allDay) {
    // All-day ends are exclusive (the day after the last one).
    endDay = endDay > startDay ? endDay - 1 : startDay;
    startMin = null; endMin = null;
  } else if (endMin === 0 && endDay > startDay) {
    // Ending at midnight: the last minute of the day before, so it stays a one-day event.
    endDay -= 1; endMin = MIN_DAY - 1;
  }
  if (endDay < startDay) endDay = startDay;
  let item = newItem({
    type: "EVENT",
    title: e.title.trim(),
    content: textToHtml(cleanDescription(e.description)),
    location: e.location.trim(),
    startDay, startMin, endDay, endMin, allDay: e.allDay,
  });
  let repeatDropped = false;
  if (e.rrule && e.recurrenceOf === null) {
    const r = repeatOf(e.rrule, zone);
    if (!r) repeatDropped = true;
    else {
      item = {
        ...item, freq: r.freq, interval: r.interval, weekDays: r.weekDays, monthDays: r.monthDays, months: r.months,
        untilDay: r.untilDay, excludedDays: [...new Set(e.exDays)].sort((a, b) => a - b).join(","),
      };
      // COUNT counts the rule's own days, before EXDATE takes some out (RFC 5545).
      if (r.count !== null) item = { ...item, untilDay: lastOfCount({ ...item, excludedDays: "" }, r.count) };
    }
  }
  return { item, alerts: e.alerts, repeatDropped };
}

export type InviteResult =
  | { kind: "event"; invite: Invite; others: number }
  | { kind: "cancelled"; title: string; day: number | null }
  | { kind: "empty" };

/**
 * What opening the file should do: show its event pre-filled ("event"), or say it's a cancellation and
 * add nothing ("cancelled"), or that there's no event in it ("empty"). An invitation has one event;
 * changed occurrences of a series (RECURRENCE-ID) are not counted as others.
 */
export function readInvite(text: string, zone: string = deviceZone()): InviteResult {
  const file = parseIcs(text, zone);
  const masters = file.events.filter((e) => e.recurrenceOf === null);
  const list = masters.length ? masters : file.events;
  const first = list[0];
  if (file.method === "CANCEL" || (first && first.cancelled && masters.length <= 1)) {
    return { kind: "cancelled", title: first?.title.trim() ?? "", day: first?.start.day ?? null };
  }
  if (!first) return { kind: "empty" };
  return { kind: "event", invite: inviteItem(first, zone), others: list.length - 1 };
}
