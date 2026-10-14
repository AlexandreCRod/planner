import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf, weekday } from "../src/domain/dates.ts";
import { tagIdFor, newId } from "../src/domain/ids.ts";
import { parseQuickAdd } from "../src/domain/quickadd.ts";
import { LAST_DAY_OF_MONTH, dayBit, occurrences, occursOn } from "../src/domain/recurrence.ts";
import { CompletionIndex, currentEntry, entriesFor, streak } from "../src/domain/schedule.ts";
import { newItem } from "../src/domain/types.ts";
import { wikiTitles } from "../src/domain/text.ts";

// Same cases as the Android ScheduleTest, so both apps agree.
const mon = epochOf(2026, 10, 12);
const task = (start: number, extra = {}) => newItem({ type: "TASK", id: 1, title: "t", startDay: start, ...extra });

test("Monday is weekday 1", () => assert.equal(weekday(mon), 1));

test("weekly subset of days", () => {
  const it = task(mon, { freq: "WEEKLY", weekDays: dayBit(1) | dayBit(4) });
  assert.deepEqual(occurrences(it, mon, mon + 13).map(weekday), [1, 4, 1, 4]);
});

test("every other week", () => {
  const it = task(mon, { freq: "WEEKLY", interval: 2 });
  assert.ok(occursOn(it, mon + 14));
  assert.ok(!occursOn(it, mon + 7));
});

test("monthly last day and skipped 31st", () => {
  const start = epochOf(2026, 1, 1);
  const last = task(start, { freq: "MONTHLY", monthDays: String(LAST_DAY_OF_MONTH) });
  assert.ok(occursOn(last, epochOf(2026, 2, 28)));
  const d31 = task(start, { freq: "MONTHLY", monthDays: "31" });
  assert.equal(occurrences(d31, start, epochOf(2026, 12, 31)).length, 7);
});

test("yearly chosen months", () => {
  const start = epochOf(2026, 1, 15);
  const it = task(start, { freq: "YEARLY", months: 1 | (1 << 6), monthDays: "15" });
  assert.deepEqual(occurrences(it, start, epochOf(2027, 12, 31)), [epochOf(2026, 1, 15), epochOf(2026, 7, 15), epochOf(2027, 1, 15), epochOf(2027, 7, 15)]);
});

test("overdue policies and streaks", () => {
  const none = new CompletionIndex([]);
  const e = entriesFor(task(mon, { freq: "DAILY" }), none, mon + 3);
  assert.equal(e[0].status, "OVERDUE");
  assert.equal(e[0].missed, 3);
  assert.equal(entriesFor(task(mon, { overduePolicy: "CARRY_OVER" }), none, mon + 3)[0].status, "CARRIED");
  const done = new CompletionIndex([0, 2, 3, 4].map((i) => ({ itemId: 1, day: mon + i, completedAt: 0 })));
  const s = streak(task(mon, { freq: "DAILY" }), done, mon + 5);
  assert.deepEqual([s.current, s.best], [3, 3]);
});

test("ticking a future task shows it done", () => {
  const oneOff = task(mon + 1);
  assert.equal(currentEntry(oneOff, new CompletionIndex([]), mon).status, "UPCOMING");
  assert.equal(currentEntry(oneOff, new CompletionIndex([{ itemId: 1, day: mon + 1, completedAt: 0 }]), mon).status, "DONE");
});

test("quick add with reminder, alarm and priority", () => {
  const r = parseQuickAdd("Dentist tue 3pm remind 1h before #health !alarm !high", mon);
  assert.equal(r.title, "Dentist");
  assert.equal(r.day, mon + 1);
  assert.equal(r.startMin, 900);
  assert.equal(r.endMin, 960);
  assert.deepEqual(r.alerts, [[60, "REMINDER"], [0, "ALARM"]]);
  assert.equal(r.priority, 3);
  assert.deepEqual(r.tags, ["health"]);
  const w = parseQuickAdd("Gym every mon, wed and fri 18:30", mon);
  assert.equal(w.title, "Gym");
  assert.equal(w.weekDays, dayBit(1) | dayBit(3) | dayBit(5));
  assert.equal(w.startMin, 18 * 60 + 30);
  const d = parseQuickAdd("Pay rent 1/11 every month", mon);
  assert.deepEqual([d.title, d.day, d.freq], ["Pay rent", epochOf(2026, 11, 1), "MONTHLY"]);
});

test("ids match the Android app", () => {
  assert.equal(tagIdFor("health"), 2767149324806608);
  assert.equal(tagIdFor("Health "), tagIdFor("health"));
  const id = newId();
  assert.ok(id > 2 ** 40 && id < 2 ** 53 && Number.isSafeInteger(id));
});

test("wiki links in Android editor HTML", () => {
  assert.deepEqual(wikiTitles("<p>see &lsqb;&lsqb;Stretch&rsqb;&rsqb; then&period;</p>"), ["Stretch"]);
});

test("time format follows the setting", async () => {
  const { formatTime } = await import("../src/domain/dates.ts");
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null };
  store.set("clockFormat", "24");
  assert.equal(formatTime(15 * 60 + 30), "15:30");
  store.set("clockFormat", "12");
  assert.equal(formatTime(15 * 60 + 30), "3:30 PM");
  assert.equal(formatTime(9 * 60), "9 AM");
  delete (globalThis as { localStorage?: unknown }).localStorage;
});
