import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf } from "../src/domain/dates.ts";
import { type PhoneCalendar, type PhoneEvent, birthdayCategory, calendarKind, importGroups, importedBySource, importedItem } from "../src/domain/phoneCalendar.ts";

// The phone is an hour ahead of UTC in these cases.
const opts = { zone: "UTC", offsetAt: () => 60 };
const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);
const day = epochOf;

const cal = (id: string, name: string, owner: string): PhoneCalendar => ({ id, name, account: "me@example.com", accountType: "com.google", owner, color: -16776961 });
const BIRTHDAYS = cal("3", "Birthdays", "addressbook#contacts@group.v.calendar.google.com");
const HOLIDAYS = cal("4", "Holidays in Portugal", "en.portuguese#holiday@group.v.calendar.google.com");
const MINE = cal("1", "me@example.com", "me@example.com");
const ev = (o: Partial<PhoneEvent> & { calendarId: string; eventId: string; begin: number; end: number }): PhoneEvent =>
  ({ syncId: null, title: "Event", description: "", location: "", allDay: false, rrule: null, ...o });

test("calendars are told apart by Google's addresses, else by name", () => {
  assert.equal(calendarKind(BIRTHDAYS), "birthdays");
  assert.equal(calendarKind(HOLIDAYS), "holidays");
  assert.equal(calendarKind(MINE), "own");
  assert.equal(calendarKind(cal("9", "Feriados", "x@y")), "holidays");
});

test("a birthday becomes a yearly all-day event, once", () => {
  const [g] = importGroups([BIRTHDAYS], [ev({ calendarId: "3", eventId: "50", title: "Ana's birthday", allDay: true, begin: utc(2026, 12, 3), end: utc(2026, 12, 4), rrule: "FREQ=YEARLY;WKST=SU" })], opts);
  assert.equal(g.kind, "birthdays");
  assert.equal(g.entries.length, 1);
  const { item, source, kind } = g.entries[0];
  assert.equal(kind, "birthday");
  assert.equal(source, "gcal:addressbook#contacts@group.v.calendar.google.com/50");
  assert.deepEqual([item.allDay, item.startDay, item.endDay, item.startMin, item.freq, item.interval], [true, day(2026, 12, 3), day(2026, 12, 3), null, "YEARLY", 1]);
});

test("a holiday is an all-day event; a timed one is made all-day on its day", () => {
  const [g] = importGroups([HOLIDAYS], [
    ev({ calendarId: "4", eventId: "7", title: "Christmas Day", allDay: true, begin: utc(2026, 12, 25), end: utc(2026, 12, 26) }),
    ev({ calendarId: "4", eventId: "8", title: "Carnival", begin: utc(2027, 2, 9, 9), end: utc(2027, 2, 9, 10) }),
  ], opts);
  assert.deepEqual(g.entries.map((e) => [e.item.title, e.item.allDay, e.item.startDay, e.item.endDay, e.item.startMin]), [
    ["Christmas Day", true, day(2026, 12, 25), day(2026, 12, 25), null],
    ["Carnival", true, day(2027, 2, 9), day(2027, 2, 9), null],
  ]);
});

test("an ordinary event keeps its local times, its place and its description", () => {
  const [g] = importGroups([MINE], [ev({ calendarId: "1", eventId: "9", syncId: "abc123", title: " Dentist ", location: "Rua A", description: "Bring the card",
    begin: utc(2026, 11, 2, 8, 30), end: utc(2026, 11, 2, 9, 15) })], opts);
  const { item, source } = g.entries[0];
  assert.equal(source, "gcal:me@example.com/abc123");
  assert.deepEqual([item.title, item.location, item.content, item.startDay, item.startMin, item.endMin, item.allDay, item.freq],
    ["Dentist", "Rua A", "<p>Bring the card</p>", day(2026, 11, 2), 9 * 60 + 30, 10 * 60 + 15, false, "NONE"]);
});

test("an event ending at midnight stays on its day; a multi-day all-day event keeps its span", () => {
  const [g] = importGroups([MINE], [
    ev({ calendarId: "1", eventId: "1", title: "Party", begin: utc(2026, 11, 7, 19), end: utc(2026, 11, 7, 23) }),
    ev({ calendarId: "1", eventId: "2", title: "Trip", allDay: true, begin: utc(2026, 11, 10), end: utc(2026, 11, 13) }),
  ], opts);
  assert.deepEqual(g.entries.map((e) => [e.item.startDay, e.item.endDay, e.item.endMin]), [
    [day(2026, 11, 7), day(2026, 11, 7), 24 * 60 - 1],
    [day(2026, 11, 10), day(2026, 11, 12), null],
  ]);
});

test("a weekly series is one repeating event; a missing week becomes a skipped day", () => {
  const weeks = [0, 1, 3].map((w) => ev({ calendarId: "1", eventId: "20", title: "Gym", begin: utc(2026, 11, 2 + w * 7, 17), end: utc(2026, 11, 2 + w * 7, 18), rrule: "FREQ=WEEKLY;BYDAY=MO" }));
  const [g] = importGroups([MINE], weeks, opts);
  assert.equal(g.entries.length, 1);
  const { item, count, source } = g.entries[0];
  assert.equal(source, "gcal:me@example.com/20");
  assert.equal(count, 3);
  assert.deepEqual([item.freq, item.startDay, item.startMin, item.excludedDays], ["WEEKLY", day(2026, 11, 2), 18 * 60, String(day(2026, 11, 16))]);
});

test("a rule the app can't say comes as one event per occurrence, each with its own source", () => {
  const list = [0, 1].map((m) => ev({ calendarId: "1", eventId: "30", title: "Board", begin: utc(2026, 11 + m, 3, 9), end: utc(2026, 11 + m, 3, 10), rrule: "FREQ=MONTHLY;BYDAY=1TU" }));
  const [g] = importGroups([MINE], list, opts);
  assert.equal(g.entries.length, 2);
  assert.deepEqual(g.entries.map((e) => [e.item.freq, e.source]), [
    ["NONE", `gcal:me@example.com/30@${utc(2026, 11, 3, 9)}`],
    ["NONE", `gcal:me@example.com/30@${utc(2026, 12, 3, 9)}`],
  ]);
});

test("groups come birthdays, holidays, then the user's calendars; empty ones are left out", () => {
  const gs = importGroups([MINE, HOLIDAYS, BIRTHDAYS, cal("5", "Empty", "e@x")], [
    ev({ calendarId: "1", eventId: "1", begin: utc(2026, 11, 1, 9), end: utc(2026, 11, 1, 10) }),
    ev({ calendarId: "3", eventId: "2", allDay: true, begin: utc(2026, 11, 2), end: utc(2026, 11, 3), rrule: "FREQ=YEARLY" }),
    ev({ calendarId: "4", eventId: "3", allDay: true, begin: utc(2026, 12, 1), end: utc(2026, 12, 2) }),
  ], opts);
  assert.deepEqual(gs.map((g) => g.kind), ["birthdays", "holidays", "own"]);
});

test("birthdays go into Personal when there is one", () => {
  assert.equal(birthdayCategory([{ id: 7, name: "Work", color: 0, defaultAlert: "REMINDER" }, { id: 1, name: "Personal", color: 0, defaultAlert: "REMINDER" }]), 1);
  assert.equal(birthdayCategory([{ id: 7, name: "Work", color: 0, defaultAlert: "REMINDER" }]), null);
});

test("importing again updates the event, keeps the user's own changes, and skips what hasn't changed", () => {
  const [g] = importGroups([BIRTHDAYS], [ev({ calendarId: "3", eventId: "50", title: "Ana's birthday", allDay: true, begin: utc(2026, 12, 3), end: utc(2026, 12, 4), rrule: "FREQ=YEARLY" })], opts);
  const entry = g.entries[0];
  const first = importedItem(entry, undefined, 1)!;
  assert.equal(first.categoryId, 1);
  assert.equal(first.id, 0);
  const saved = { ...first, id: 42, categoryId: 4, color: 123, content: "<p>Gift: a book</p>" };
  assert.equal(importedItem(entry, saved, 1), null);
  assert.equal(importedBySource([saved, { ...saved, id: 43, source: undefined }]).get(entry.source)?.id, 42);
  const renamed = { ...entry, item: { ...entry.item, title: "Ana Silva's birthday" } };
  const updated = importedItem(renamed, saved, 1)!;
  assert.deepEqual([updated.id, updated.title, updated.categoryId, updated.color, updated.content], [42, "Ana Silva's birthday", 4, 123, "<p>Gift: a book</p>"]);
  // Trashed ones aren't matched: importing brings a new one.
  assert.equal(importedBySource([{ ...saved, deletedAt: 5 }]).size, 0);
});
