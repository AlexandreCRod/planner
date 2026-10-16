import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVERY_DAY, WEEKDAYS, buildMirror, bundle, cityZones, formatDuration, lapLengths, nextRing, repeatText, timerLeft,
  untilText, usesFahrenheit, weatherSymbol, zoneDayLabel, zoneOffsetLabel,
} from "../src/domain/alarms.ts";
import { epochOf } from "../src/domain/dates.ts";
import { parseClockCommand, parseQuickAdd } from "../src/domain/quickadd.ts";
import { type Reminder, newItem } from "../src/domain/types.ts";

// Same cases as the native app's alarm tests (ClockAlarmsTest, ClockToolsTest, BundleTest).

const thuMorning = new Date(2026, 9, 15, 8, 0); // a Thursday
const clock = (h: number, m: number, days = 0) => ({ id: h * 60 + m, hour: h, minute: m, days });
const hm = (d: Date) => [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

test("a one-off alarm rings today or tomorrow", () => {
  assert.deepEqual(hm(nextRing(clock(9, 30), thuMorning)), [10, 15, 9, 30]);
  assert.deepEqual(hm(nextRing(clock(7, 0), thuMorning)), [10, 16, 7, 0]);
});

test("a repeating alarm skips to the next chosen day", () => {
  assert.deepEqual(hm(nextRing(clock(7, 0, WEEKDAYS), thuMorning)), [10, 16, 7, 0]); // Friday
  assert.deepEqual(hm(nextRing(clock(7, 0, WEEKDAYS), new Date(2026, 9, 16, 20, 0))), [10, 19, 7, 0]); // Monday
});

test("alarms within 29 minutes share a bundle", () => {
  const names = (g: { hour: number; minute: number }[][]) => g.map((x) => x.map((a) => `${a.hour}:${a.minute}`));
  assert.deepEqual(names(bundle([clock(7, 0), clock(6, 30), clock(6, 50), clock(6, 40), clock(9, 0), clock(9, 30)])),
    [["6:30", "6:40", "6:50", "7:0"], ["9:0"], ["9:30"]]);
  assert.deepEqual(names(bundle([clock(6, 0), clock(6, 29), clock(6, 58)])), [["6:0", "6:29", "6:58"]]);
  assert.deepEqual(names(bundle([clock(6, 0), clock(6, 30)])), [["6:0"], ["6:30"]]);
});

test("repeat lines and the time until the next alarm", () => {
  const rel = (d: Date) => (d.getDate() === 15 ? "Today" : "Tomorrow");
  assert.equal(repeatText(clock(7, 0), thuMorning, rel), "Once · Tomorrow");
  assert.equal(repeatText(clock(7, 0, EVERY_DAY), thuMorning, rel), "Every day");
  assert.equal(repeatText(clock(7, 0, WEEKDAYS), thuMorning, rel), "Weekdays");
  assert.equal(repeatText(clock(7, 0, 0b0010101), thuMorning, rel), "Mon Wed Fri");
  assert.equal(untilText(new Date(2026, 9, 15, 8, 30), thuMorning), "31 min");
  assert.equal(untilText(new Date(2026, 9, 15, 15, 12), thuMorning), "7 h 13 min");
});

test("timer and stopwatch arithmetic", () => {
  assert.equal(formatDuration(5_400), "0:05");
  assert.equal(formatDuration(245_000), "4:05");
  assert.equal(formatDuration(3_723_000), "1:02:03");
  assert.equal(formatDuration(1_270, true), "0:01.27");
  assert.equal(formatDuration(-50), "0:00");
  assert.equal(timerLeft({ endAt: 10_000, remainingMs: 99 }, 4_000), 6_000);
  assert.equal(timerLeft({ endAt: null, remainingMs: 99 }, 4_000), 99);
  assert.deepEqual(lapLengths([1_500, 5_000]), [1_500, 3_500]);
});

test("world clock offsets and days", () => {
  const winter = Date.parse("2026-01-15T12:00:00Z");
  assert.equal(zoneOffsetLabel("Europe/London", winter, "Europe/Lisbon"), "Same time");
  assert.equal(zoneOffsetLabel("Europe/Paris", winter, "Europe/Lisbon"), "+1 h");
  assert.equal(zoneOffsetLabel("America/New_York", winter, "Europe/Lisbon"), "−5 h");
  assert.equal(zoneOffsetLabel("Asia/Kolkata", winter, "Europe/Lisbon"), "+5 h 30 min");
  assert.equal(zoneDayLabel("Asia/Tokyo", Date.parse("2026-01-15T22:00:00Z"), "Europe/Lisbon"), "Tomorrow");
  assert.equal(zoneDayLabel("Europe/Paris", winter, "Europe/Lisbon"), null);
  assert.deepEqual(cityZones(["UTC", "Europe/Paris", "America/New_York", "Etc/GMT+1"]), ["America/New_York", "Europe/Paris"]);
});

test("weather symbols and units", () => {
  assert.equal(weatherSymbol(0, true).icon, "oWbSunny");
  assert.equal(weatherSymbol(0, false).icon, "oNightsStay");
  assert.equal(weatherSymbol(63, true).label, "Rain");
  assert.equal(weatherSymbol(73, true).label, "Snow");
  assert.equal(weatherSymbol(95, true).label, "Thunderstorm");
  assert.ok(usesFahrenheit("en-US"));
  assert.ok(!usesFahrenheit("en-GB"));
  assert.ok(!usesFahrenheit("fr"));
  assert.ok(!usesFahrenheit("pt-PT"));
});

test("the engine gets only live tasks and events with reminders, slimmed down", () => {
  const ev = newItem({ type: "EVENT", id: 1, title: "Dentist", content: "<p>secret notes</p>", startDay: 100, startMin: 900, location: "Somewhere" });
  const gone = newItem({ type: "TASK", id: 2, title: "Old", startDay: 100, deletedAt: 5 });
  const plain = newItem({ type: "TASK", id: 3, title: "No alerts", startDay: 100 });
  const note = newItem({ type: "NOTE", id: 4, title: "Note" });
  const r = (id: number, itemId: number): Reminder => ({ id, itemId, offsetMin: 15, type: "ALARM", soundUri: null });
  const reminders = new Map([[1, [r(10, 1)]], [2, [r(20, 2)]], [4, [r(40, 4)]]]);
  const settings = { defaultTaskTime: 540, defaultAlarmSound: null, defaultAlarmSoundName: "Bell", snoozeMinutes: 10, upcomingAlarms: true, quietHoursEnabled: false, quietStart: 1320, quietEnd: 420 };
  const m = buildMirror([ev, gone, plain, note], reminders, [{ itemId: 1, day: 100, completedAt: 1 }, { itemId: 3, day: 100, completedAt: 1 }], settings, "24", "dmy", "#00796B");
  assert.deepEqual(m.items.map((i) => i.id), [1]);
  assert.deepEqual(m.reminders.map((x) => x.id), [10]);
  assert.deepEqual(m.completions, [{ itemId: 1, day: 100 }]);
  // Nothing but scheduling fields leaves the page.
  assert.equal("content" in m.items[0], false);
  assert.equal("location" in m.items[0], false);
  assert.equal("defaultAlarmSoundName" in m.settings, false);
  assert.equal(m.settings.clockFormat, 1);
  assert.equal(m.settings.dateFormat, 1);
  assert.equal(m.settings.accent, 1);
});

// ---------- Quick add: timers and alarm clocks ----------

const sat = new Date(2026, 9, 17, 10, 0);
const timer = (s: string) => parseClockCommand(s, sat);

test("timers from the add line", () => {
  assert.deepEqual(timer("timer 10 min"), { kind: "timer", durationMs: 600_000, label: "" });
  assert.deepEqual(timer("pasta timer 12m"), { kind: "timer", durationMs: 720_000, label: "pasta" });
  assert.deepEqual(timer("set a timer for 1h 30m"), { kind: "timer", durationMs: 5_400_000, label: "" });
  assert.deepEqual(timer("Timer 1h30 bread"), { kind: "timer", durationMs: 5_400_000, label: "bread" });
  assert.deepEqual(timer("timer 5:00 tea"), { kind: "timer", durationMs: 300_000, label: "tea" });
  assert.deepEqual(timer("tea 4 min timer"), { kind: "timer", durationMs: 240_000, label: "tea" });
  assert.deepEqual(timer("timer 90 sec"), { kind: "timer", durationMs: 90_000, label: "" });
  assert.deepEqual(timer("timer 2 hours and 10 minutes"), { kind: "timer", durationMs: 7_800_000, label: "" });
  // No length: an ordinary item.
  assert.equal(timer("Kitchen timer batteries"), null);
  assert.equal(timer("Buy egg timer"), null);
});

test("alarm clocks from the add line", () => {
  assert.deepEqual(timer("alarm 6:30"), { kind: "alarm", hour: 6, minute: 30, days: 0, label: "" });
  assert.deepEqual(timer("alarm 7am weekdays gym"), { kind: "alarm", hour: 7, minute: 0, days: WEEKDAYS, label: "gym" });
  assert.deepEqual(timer("Set an alarm for 6:45 mon wed fri"), { kind: "alarm", hour: 6, minute: 45, days: 0b0010101, label: "" });
  assert.deepEqual(timer("wake me up at 7"), { kind: "alarm", hour: 7, minute: 0, days: 0, label: "" });
  assert.deepEqual(timer("alarm 22:15 every day Pills"), { kind: "alarm", hour: 22, minute: 15, days: EVERY_DAY, label: "Pills" });
  assert.deepEqual(timer("alarm tomorrow 5:45pm"), { kind: "alarm", hour: 17, minute: 45, days: 0, label: "" });
  assert.deepEqual(timer("alarm in 20 min"), { kind: "alarm", hour: 10, minute: 20, days: 0, label: "" });
  assert.deepEqual(timer("wake me in 8 hours"), { kind: "alarm", hour: 18, minute: 0, days: 0, label: "" });
  // Item alarms and titles keep their old meaning.
  assert.equal(timer("Dentist tue 3pm !alarm"), null);
  assert.equal(timer("Dentist tue 3pm alarm"), null);
  assert.equal(timer("alarm 10 min before meeting 3pm"), null);
  assert.equal(timer("Buy alarm clock"), null);
  assert.equal(timer("alarm"), null);
});

test("the item quick-add line reads alarms as before", () => {
  const mon = epochOf(2026, 10, 12);
  const r = parseQuickAdd("Dentist tue 3pm !alarm", mon);
  assert.equal(r.title, "Dentist");
  assert.deepEqual(r.alerts, [[0, "ALARM"]]);
  assert.equal(parseQuickAdd("Buy alarm clock", mon).title, "Buy alarm clock");
  assert.equal(parseQuickAdd("Kitchen timer batteries", mon).title, "Kitchen timer batteries");
});
