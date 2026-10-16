import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf } from "../src/domain/dates.ts";
import { cleanDescription, parseDateTime, parseDuration, parseIcs, readInvite, repeatOf, unescapeText } from "../src/domain/ics.ts";

// The phone is in Lisbon in these cases (UTC+1 in summer, UTC+0 in winter), as in CalendarImportTest.
const LISBON = "Europe/Lisbon";
const day = (y: number, m: number, d: number) => epochOf(y, m, d);
const ics = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");

// What Gmail attaches to a Google Calendar invitation (trimmed), with a time in another zone.
const GOOGLE_INVITE = ics(
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "CALSCALE:GREGORIAN",
  "METHOD:REQUEST",
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "DTSTART:19700308T020000",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "DTSTART;TZID=America/New_York:20261020T090000",
  "DTEND;TZID=America/New_York:20261020T100000",
  "DTSTAMP:20261016T120000Z",
  "ORGANIZER;CN=Sam:mailto:sam@example.com",
  "UID:7kq2@google.com",
  "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=me@example.com;X-NUM-GUESTS=0:mailto:me@example.com",
  "DESCRIPTION:Agenda:\\n- budget\\, Q4\\n- hiring\\n\\n-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-\\nJoin with Google Meet: https://meet.google.com/abc-defg-hij\\n\\nInvitation from Google Calendar: https://calendar.google.com/calendar/\\n-::~:~::~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~:~::~:~::-",
  "LOCATION:Room 4\\, 2nd floor",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:Budget review",
  "TRANSP:OPAQUE",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:This is an event reminder",
  "TRIGGER:-P0DT0H30M0S",
  "END:VALARM",
  "END:VEVENT",
);

test("a Google invitation with a TZID becomes the event at this phone's time", () => {
  const r = readInvite(GOOGLE_INVITE, LISBON);
  assert.equal(r.kind, "event");
  if (r.kind !== "event") return;
  const { item, alerts, repeatDropped } = r.invite;
  // 09:00 in New York (UTC-4) is 14:00 in Lisbon (UTC+1) on 20 October.
  assert.equal(item.type, "EVENT");
  assert.equal(item.title, "Budget review");
  assert.equal(item.startDay, day(2026, 10, 20));
  assert.equal(item.startMin, 14 * 60);
  assert.equal(item.endDay, day(2026, 10, 20));
  assert.equal(item.endMin, 15 * 60);
  assert.equal(item.allDay, false);
  assert.equal(item.location, "Room 4, 2nd floor");
  // The organiser's text is kept; Google's joining block (links) is left out.
  assert.equal(item.content, "<p>Agenda:</p><p>- budget, Q4</p><p>- hiring</p>");
  assert.deepEqual(alerts, [30]);
  assert.equal(item.freq, "NONE");
  assert.equal(repeatDropped, false);
  assert.equal(item.id, 0);
  assert.equal(r.others, 0);
});

test("an all-day invitation keeps its days (the end date is exclusive)", () => {
  const one = readInvite(ics("BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261024", "DTEND;VALUE=DATE:20261025", "SUMMARY:Offsite", "END:VEVENT"), LISBON);
  assert.equal(one.kind, "event");
  if (one.kind !== "event") return;
  assert.equal(one.invite.item.allDay, true);
  assert.equal(one.invite.item.startDay, day(2026, 10, 24));
  assert.equal(one.invite.item.endDay, day(2026, 10, 24));
  assert.equal(one.invite.item.startMin, null);
  assert.equal(one.invite.item.endMin, null);
  // Several days, and a bare date with no VALUE parameter.
  const three = readInvite(ics("BEGIN:VEVENT", "DTSTART:20261228", "DTEND:20261231", "SUMMARY:Holidays", "END:VEVENT"), LISBON);
  assert.equal(three.kind === "event" && three.invite.item.endDay, day(2026, 12, 30));
  // No end at all: one day.
  const noEnd = readInvite(ics("BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261101", "SUMMARY:x", "END:VEVENT"), LISBON);
  assert.equal(noEnd.kind === "event" && noEnd.invite.item.endDay, day(2026, 11, 1));
});

test("UTC times, floating times and unknown zones", () => {
  // 13:30Z on 15 Dec is 13:30 in Lisbon (winter, UTC+0); on 15 Jul it's 14:30 (UTC+1).
  assert.deepEqual(parseDateTime("20261215T133000Z", null, LISBON), { at: { day: day(2026, 12, 15), min: 13 * 60 + 30 }, allDay: false });
  assert.deepEqual(parseDateTime("20260715T133000Z", null, LISBON), { at: { day: day(2026, 7, 15), min: 14 * 60 + 30 }, allDay: false });
  // Late in UTC can be the next day here.
  assert.deepEqual(parseDateTime("20260715T233000Z", null, "Asia/Tokyo"), { at: { day: day(2026, 7, 16), min: 8 * 60 + 30 }, allDay: false });
  // Floating, and a Windows zone name Intl doesn't know: read as the phone's own time.
  assert.deepEqual(parseDateTime("20261020T090000", null, LISBON), { at: { day: day(2026, 10, 20), min: 540 }, allDay: false });
  assert.deepEqual(parseDateTime("20261020T090000", { TZID: "W. Europe Standard Time" }, LISBON), { at: { day: day(2026, 10, 20), min: 540 }, allDay: false });
  // Across a daylight-saving change: Berlin 25 Oct 2026 is after its change (UTC+1), New York's is later (UTC-4).
  assert.deepEqual(parseDateTime("20261026T090000", { TZID: "America/New_York" }, "Europe/Berlin"), { at: { day: day(2026, 10, 26), min: 14 * 60 }, allDay: false });
  assert.equal(parseDateTime("2026-10-20", null, LISBON), null);
  // A timed event ending at midnight stays on its day.
  const late = readInvite(ics("BEGIN:VEVENT", "DTSTART:20261031T220000Z", "DTEND:20261101T000000Z", "SUMMARY:Party", "END:VEVENT"), "UTC");
  assert.equal(late.kind === "event" && late.invite.item.endDay, day(2026, 10, 31));
  assert.equal(late.kind === "event" && late.invite.item.endMin, 24 * 60 - 1);
  // DURATION instead of DTEND.
  const dur = readInvite(ics("BEGIN:VEVENT", "DTSTART:20261031T090000Z", "DURATION:PT1H30M", "SUMMARY:x", "END:VEVENT"), "UTC");
  assert.equal(dur.kind === "event" && dur.invite.item.endMin, 10 * 60 + 30);
});

test("durations and text escapes", () => {
  assert.equal(parseDuration("-PT15M"), -15);
  assert.equal(parseDuration("PT1H30M"), 90);
  assert.equal(parseDuration("P1D"), 1440);
  assert.equal(parseDuration("P1W"), 10080);
  assert.equal(parseDuration("-P0DT0H30M0S"), -30);
  assert.equal(parseDuration("P3600S"), 60);
  assert.equal(parseDuration("P"), null);
  assert.equal(parseDuration("soon"), null);
  assert.equal(unescapeText("a\\, b\\; c\\nd\\\\n"), "a, b; c\nd\\n");
  assert.equal(cleanDescription("Hi\n\n-::~:~::~:~::-\nJoin: https://meet.google.com/x\n-::~:~::~:~::-"), "Hi");
});

test("simple repeat rules map onto the app's, others are dropped and reported", () => {
  assert.deepEqual(repeatOf("FREQ=DAILY;INTERVAL=2", LISBON), { freq: "DAILY", interval: 2, weekDays: 0, monthDays: "", months: 0, untilDay: null, count: null });
  // Monday = bit 0, Wednesday = bit 2.
  assert.equal(repeatOf("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;WKST=MO", LISBON)?.weekDays, 0b101);
  assert.equal(repeatOf("FREQ=MONTHLY;BYMONTHDAY=15,1,-1", LISBON)?.monthDays, "1,15,32");
  assert.deepEqual(repeatOf("FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25", LISBON)?.months, 1 << 11);
  assert.equal(repeatOf("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR", LISBON)?.weekDays, 0b11111);
  assert.equal(repeatOf("FREQ=WEEKLY;UNTIL=20261231T235959Z", LISBON)?.untilDay, day(2026, 12, 31));
  assert.equal(repeatOf("FREQ=MONTHLY;BYDAY=2TU", LISBON), null);
  assert.equal(repeatOf("FREQ=HOURLY", LISBON), null);
  assert.equal(repeatOf("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1", LISBON), null);

  const weekly = readInvite(ics(
    "BEGIN:VEVENT", "UID:a", "DTSTART;TZID=Europe/Lisbon:20261012T180000", "DTEND;TZID=Europe/Lisbon:20261012T190000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4", "EXDATE;TZID=Europe/Lisbon:20261015T180000", "SUMMARY:Gym", "END:VEVENT",
    // A changed occurrence of the same series isn't another event.
    "BEGIN:VEVENT", "UID:a", "RECURRENCE-ID;TZID=Europe/Lisbon:20261019T180000", "DTSTART;TZID=Europe/Lisbon:20261019T190000", "SUMMARY:Gym (late)", "END:VEVENT",
  ), LISBON);
  assert.equal(weekly.kind, "event");
  if (weekly.kind !== "event") return;
  assert.equal(weekly.others, 0);
  const it = weekly.invite.item;
  assert.equal(it.freq, "WEEKLY");
  assert.equal(it.weekDays, 0b1001);
  // Mon 12, Thu 15, Mon 19, Thu 22: COUNT counts the rule's days, the excluded 15th included (RFC 5545).
  assert.equal(it.untilDay, day(2026, 10, 22));
  assert.equal(it.excludedDays, String(day(2026, 10, 15)));

  const odd = readInvite(ics("BEGIN:VEVENT", "DTSTART:20261013T100000Z", "RRULE:FREQ=MONTHLY;BYDAY=2TU", "SUMMARY:Board", "END:VEVENT"), LISBON);
  assert.equal(odd.kind === "event" && odd.invite.repeatDropped, true);
  assert.equal(odd.kind === "event" && odd.invite.item.freq, "NONE");
});

test("a cancellation adds nothing", () => {
  const cancel = readInvite(ics("METHOD:CANCEL", "BEGIN:VEVENT", "DTSTART:20261020T090000Z", "SUMMARY:Budget review", "STATUS:CANCELLED", "END:VEVENT"), LISBON);
  assert.deepEqual(cancel, { kind: "cancelled", title: "Budget review", day: day(2026, 10, 20) });
  // A cancelled event without METHOD, too.
  assert.equal(readInvite(ics("BEGIN:VEVENT", "DTSTART:20261020T090000Z", "SUMMARY:x", "STATUS:CANCELLED", "END:VEVENT"), LISBON).kind, "cancelled");
  assert.deepEqual(readInvite(ics("METHOD:PUBLISH"), LISBON), { kind: "empty" });
  assert.deepEqual(readInvite("not a calendar", LISBON), { kind: "empty" });
});

test("folded lines, quoted parameters and a BOM are read", () => {
  const file = parseIcs("﻿" + ics(
    "BEGIN:VEVENT",
    'DTSTART;TZID="Europe/Lisbon":20261020T090000',
    "SUMMARY:A very long title that",
    "  goes on",
    "LOCATION;ALTREP=\"http://x.example/a:b\":Hall",
    "END:VEVENT",
  ), LISBON);
  assert.equal(file.events.length, 1);
  assert.equal(file.events[0].title, "A very long title that goes on");
  assert.equal(file.events[0].location, "Hall");
  assert.equal(file.events[0].start.min, 540);
  // A VEVENT with no start is skipped and counted.
  assert.equal(parseIcs(ics("BEGIN:VEVENT", "SUMMARY:x", "END:VEVENT"), LISBON).skipped, 1);
});
