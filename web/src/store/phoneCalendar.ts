// The phone's door to its calendars (272; android/.../calendar/CalendarPlugin.kt): asking for them, reading
// every calendar and the events ahead, and saving the ones picked (domain/phoneCalendar.ts maps them). On
// the PC there is no plugin and nothing here runs (Settings hides the import).
import { registerPlugin } from "@capacitor/core";
import { isNative } from "../platform.ts";
import { type ImportEntry, type PhoneCalendar, type PhoneEvent, birthdayCategory, importedBySource, importedItem } from "../domain/phoneCalendar.ts";
import { saveItem, snapshot } from "./store.ts";

interface CalendarPlugin {
  permission(): Promise<{ granted: boolean }>;
  request(): Promise<{ granted: boolean }>;
  openSettings(): Promise<void>;
  read(o: { days: number }): Promise<{ calendars: PhoneCalendar[]; events: PhoneEvent[] }>;
}

const plugin = isNative ? registerPlugin<CalendarPlugin>("PhoneCalendar") : null;

/** Whether this device can read a phone's calendars (the app on the phone). */
export const canImportCalendars = plugin !== null;

/** How far ahead repeating events are read. */
export const READ_DAYS = 400;

/** Whether the calendars may be read; asks (Android's own dialog) when [ask] and they may not yet. */
export async function calendarAccess(ask: boolean): Promise<boolean> {
  if (!plugin) return false;
  const { granted } = await plugin.permission();
  if (granted || !ask) return granted;
  return (await plugin.request()).granted;
}

export const openCalendarSettings = () => void plugin?.openSettings().catch(() => {});

/** Every calendar and the events ahead, tidied (Android leaves out empty values). */
export async function readPhoneCalendars(): Promise<{ calendars: PhoneCalendar[]; events: PhoneEvent[] }> {
  if (!plugin) return { calendars: [], events: [] };
  const r = await plugin.read({ days: READ_DAYS });
  return {
    calendars: (r.calendars ?? []).map((c) => ({ id: String(c.id), name: c.name ?? "", account: c.account ?? "", accountType: c.accountType ?? "", owner: c.owner ?? "", color: typeof c.color === "number" ? c.color : null })),
    events: (r.events ?? []).map((e) => ({
      calendarId: String(e.calendarId), eventId: String(e.eventId), syncId: e.syncId ?? null, title: e.title ?? "", description: e.description ?? "",
      location: e.location ?? "", allDay: !!e.allDay, begin: Number(e.begin), end: Number(e.end), rrule: e.rrule ?? null,
    })),
  };
}

/** Saves the picked rows: new ones added, ones imported before brought up to date. */
export function importEntries(entries: ImportEntry[]): { added: number; updated: number } {
  const s = snapshot();
  const known = importedBySource(s.items);
  const cat = birthdayCategory(s.categories);
  let added = 0, updated = 0;
  for (const e of entries) {
    const existing = known.get(e.source);
    const item = importedItem(e, existing, cat);
    if (!item) continue;
    saveItem(item);
    if (existing) updated++; else added++;
  }
  return { added, updated };
}
