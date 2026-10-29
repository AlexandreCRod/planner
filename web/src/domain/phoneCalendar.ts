// Importing from the phone's calendars (272): Google Calendar's birthdays, holidays and the user's own
// calendars, as Android's calendar store holds them (read by android/.../calendar/CalendarPlugin.kt).
// This turns what the plugin returns into the app's events, grouped by calendar for the import screen,
// and says how an event imported before is brought up to date. Nothing here touches the store.
import { cleanDescription, deviceZone, repeatOf, textToHtml } from "./ics.ts";
import { occurrences } from "./recurrence.ts";
import { type Category, type Item, newItem } from "./types.ts";

/** A calendar on the phone (CalendarContract.Calendars). */
export interface PhoneCalendar {
  id: string;
  name: string;
  /** The account it syncs with (an email address for Google), and that account's type ("com.google"). */
  account: string;
  accountType: string;
  /** The calendar's own address: Google's birthdays and holidays calendars are told apart by it. */
  owner: string;
  /** ARGB, as Android keeps colours; null when it has none. */
  color: number | null;
}

/**
 * One event, or one occurrence of a repeating one, from today on. A repeating event comes once per
 * occurrence in the next 400 days, each with the series' rule, except a yearly one, which comes once
 * (its next occurrence) with its rule.
 */
export interface PhoneEvent {
  calendarId: string;
  /** The event's id on this phone, and Google's own id for it (the same on every phone) when it has one. */
  eventId: string;
  syncId: string | null;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  /** The occurrence's start and end, epoch ms (an all-day one: UTC midnights, the end exclusive). */
  begin: number;
  end: number;
  rrule: string | null;
}

export type CalendarKind = "birthdays" | "holidays" | "own";
/** Birthdays become yearly all-day events, special days (holidays) all-day events; the rest keep their times. */
export type EntryKind = "birthday" | "special" | "event";

/** One row of the import screen: what would be saved (not saved yet: id 0, no category). */
export interface ImportEntry {
  source: string;
  kind: EntryKind;
  item: Item;
  /** How many of the next 400 days' occurrences it stands for (a repeating series imported as one). */
  count: number;
}

export interface ImportGroup { calendar: PhoneCalendar; kind: CalendarKind; entries: ImportEntry[] }

const DAY_MS = 86_400_000;
const LAST_MIN = 24 * 60 - 1;

/** Google's birthdays calendar ("#contacts@group.v.calendar.google.com"), holidays ("…#holiday@…"), or the user's. */
export function calendarKind(c: PhoneCalendar): CalendarKind {
  const owner = c.owner.toLowerCase(), name = c.name.toLowerCase();
  if (owner.includes("#contacts@") || /birthday|aniversário|anniversaire|cumpleaños|geburtstag/.test(name)) return "birthdays";
  if (owner.includes("#holiday@") || /holiday|feriado|vacances|feiertag/.test(name)) return "holidays";
  return "own";
}

const KIND_ORDER: Record<CalendarKind, number> = { birthdays: 0, holidays: 1, own: 2 };

/** The calendar's lasting name in a source: its own address (the same on every phone), else its id here. */
const calendarKey = (c: PhoneCalendar | undefined, id: string) => c?.owner || id;
const eventKey = (e: PhoneEvent) => e.syncId || e.eventId;

/** The local day and minute of [ms]; [offsetAt] is the phone's offset from UTC then, in minutes. */
function localTime(ms: number, offsetAt: (ms: number) => number): { day: number; min: number } {
  const t = ms + offsetAt(ms) * 60_000;
  const day = Math.floor(t / DAY_MS);
  return { day, min: Math.floor((t - day * DAY_MS) / 60_000) };
}

const phoneOffset = (ms: number) => -new Date(ms).getTimezoneOffset();

/** The app's event for one occurrence, before any repeat. */
function baseItem(e: PhoneEvent, source: string, offsetAt: (ms: number) => number): Item {
  let startDay: number, endDay: number, startMin: number | null = null, endMin: number | null = null;
  if (e.allDay) {
    // All-day times are UTC midnights, the end the day after the last one.
    startDay = Math.floor(e.begin / DAY_MS);
    endDay = Math.max(startDay, Math.floor(e.end / DAY_MS) - 1);
  } else {
    const s = localTime(e.begin, offsetAt), en = localTime(Math.max(e.end, e.begin), offsetAt);
    startDay = s.day; startMin = s.min; endDay = en.day; endMin = en.min;
    // Ending at midnight: the last minute of the day before, so it stays a one-day event.
    if (endMin === 0 && endDay > startDay) { endDay -= 1; endMin = LAST_MIN; }
  }
  return newItem({
    type: "EVENT", title: e.title.trim(), content: textToHtml(cleanDescription(e.description)), location: e.location.trim(),
    startDay, startMin, endDay, endMin, allDay: e.allDay, source,
  });
}

/** Made a whole-day event on its first day (a special day at a time). */
const asAllDay = (i: Item): Item => (i.allDay ? i : { ...i, allDay: true, startMin: null, endMin: null, endDay: i.startDay });

/**
 * Every event found, as import rows, grouped by calendar: birthdays first, then holidays, then the user's
 * own calendars; calendars with nothing ahead are left out. A repeating series whose rule the app can say
 * is one row (the occurrences missing from it become skipped days); one it can't say is a row per occurrence.
 */
export function importGroups(calendars: PhoneCalendar[], events: PhoneEvent[], opts: { zone?: string; offsetAt?: (ms: number) => number } = {}): ImportGroup[] {
  const zone = opts.zone ?? deviceZone();
  const offsetAt = opts.offsetAt ?? phoneOffset;
  const calById = new Map(calendars.map((c) => [c.id, c]));
  const series = new Map<string, PhoneEvent[]>();
  for (const e of [...events].sort((a, b) => a.begin - b.begin)) {
    const k = `${e.calendarId}\n${e.eventId}`;
    const list = series.get(k);
    if (list) list.push(e); else series.set(k, [e]);
  }
  const byCal = new Map<string, ImportEntry[]>();
  for (const list of series.values()) {
    const first = list[0];
    const cal = calById.get(first.calendarId);
    const calKind = cal ? calendarKind(cal) : "own";
    const kind: EntryKind = calKind === "birthdays" ? "birthday" : calKind === "holidays" ? "special" : "event";
    const key = `gcal:${calendarKey(cal, first.calendarId)}/${eventKey(first)}`;
    const out = byCal.get(first.calendarId) ?? [];
    byCal.set(first.calendarId, out);
    if (kind === "birthday") {
      const b = asAllDay(baseItem(first, key, offsetAt));
      out.push({ source: key, kind, count: 1, item: { ...b, endDay: b.startDay, freq: "YEARLY", interval: 1 } });
      continue;
    }
    const repeat = first.rrule ? repeatOf(first.rrule, zone) : null;
    if (repeat && repeat.count === null) {
      let item = baseItem(first, key, offsetAt);
      item = { ...item, freq: repeat.freq, interval: repeat.interval, weekDays: repeat.weekDays, monthDays: repeat.monthDays, months: repeat.months, untilDay: repeat.untilDay };
      if (kind === "special") item = asAllDay(item);
      // Occurrences the rule has but the phone doesn't (deleted, or moved: a moved one comes as its own event).
      const days = new Set(list.map((e) => baseItem(e, key, offsetAt).startDay!));
      const last = Math.max(...days);
      const skipped = list.length > 1 ? occurrences(item, item.startDay!, last).filter((d) => !days.has(d)) : [];
      out.push({ source: key, kind, count: list.length, item: { ...item, excludedDays: skipped.join(",") } });
      continue;
    }
    for (const e of list) {
      const source = first.rrule ? `${key}@${e.begin}` : key;
      const item = baseItem(e, source, offsetAt);
      out.push({ source, kind, count: 1, item: kind === "special" ? asAllDay(item) : item });
    }
  }
  const groups: ImportGroup[] = [];
  for (const [id, entries] of byCal) {
    if (!entries.length) continue;
    const calendar = calById.get(id) ?? { id, name: "Calendar", account: "", accountType: "", owner: "", color: null };
    entries.sort((a, b) => a.item.startDay! - b.item.startDay! || (a.item.startMin ?? -1) - (b.item.startMin ?? -1) || a.item.title.localeCompare(b.item.title));
    groups.push({ calendar, kind: calendarKind(calendar), entries });
  }
  return groups.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.calendar.name.localeCompare(b.calendar.name));
}

/** The category birthdays go into: the user's Personal one, else none. */
export function birthdayCategory(categories: Category[]): number | null {
  return categories.find((c) => c.name.trim().toLowerCase() === "personal")?.id ?? null;
}

/** The imported events in the app (not in the trash), by source. */
export function importedBySource(items: Item[]): Map<string, Item> {
  const m = new Map<string, Item>();
  for (const i of items) if (i.source && i.deletedAt === null) m.set(i.source, i);
  return m;
}

/** What an import sets, and so what it compares to tell whether an event changed since. */
const IMPORTED = ["title", "location", "startDay", "startMin", "endDay", "endMin", "allDay", "freq", "interval", "weekDays", "monthDays", "months", "untilDay", "excludedDays"] as const;

/**
 * What to save for [entry]: a new event (a birthday in [birthdayCat]), or [existing] brought up to date
 * (its category, colour, reminders and anything else of the user's kept; its notes filled only while
 * empty), or null when nothing changed.
 */
export function importedItem(entry: ImportEntry, existing: Item | undefined, birthdayCat: number | null): Item | null {
  if (!existing) return { ...entry.item, categoryId: entry.kind === "birthday" ? birthdayCat : null };
  const next: Item = { ...existing, source: entry.source, content: existing.content || entry.item.content };
  for (const k of IMPORTED) (next as unknown as Record<string, unknown>)[k] = entry.item[k];
  const same = IMPORTED.every((k) => existing[k] === next[k]) && next.content === existing.content;
  return same ? null : next;
}
