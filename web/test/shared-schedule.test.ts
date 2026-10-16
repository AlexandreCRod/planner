// Runs the shared scheduling cases in ../../shared/schedule-cases.json, the same file the Android
// unit tests run (SharedScheduleCasesTest.kt), so both apps give the same answers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { epochOf, toTimestamp, ymd } from "../src/domain/dates.ts";
import { LAST_DAY_OF_MONTH, dayBit, occurrences as recurrenceDays } from "../src/domain/recurrence.ts";
import {
  CompletionIndex, type Occurrence, type TaskEntry,
  currentEntry, entriesFor, forCalendar, occurrencesIn, streak, tasksForDay, tasksOnDay, tickedDuring,
} from "../src/domain/schedule.ts";
import { type Completion, type Item, NO_DAY, newItem } from "../src/domain/types.ts";
import { routinesOnDay, withoutRoutines } from "../src/domain/routines.ts";

// Parsed JSON from the cases file.
type Json = any;

const file = JSON.parse(readFileSync(new URL("../../shared/schedule-cases.json", import.meta.url), "utf8"));
const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const day = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return epochOf(y, m, d);
};
const optDay = (s: string | null | undefined) => (s == null ? null : day(s));
const dateStr = (e: number) => {
  const { y, m, d } = ymd(e);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const minutes = (v: string | number | null | undefined) => {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (v: number | null) => (v === null ? null : `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`);
const normTime = (v: string | number | null | undefined) => hhmm(minutes(v));

function toItem(j: Json): Item {
  const weekDays = Array.isArray(j.weekDays)
    ? j.weekDays.reduce((mask: number, w: string) => mask | dayBit(WEEKDAYS.indexOf(w) + 1), 0)
    : (j.weekDays ?? 0);
  const months = Array.isArray(j.months) ? j.months.reduce((mask: number, m: number) => mask | (1 << (m - 1)), 0) : (j.months ?? 0);
  const monthDays = Array.isArray(j.monthDays) ? j.monthDays.join(",") : (j.monthDays ?? "");
  const excludedDays = Array.isArray(j.excludedDays) ? j.excludedDays.map(day).join(",") : (j.excludedDays ?? "");
  return newItem({
    id: j.id,
    type: j.type ?? "TASK",
    title: j.title ?? "",
    startDay: optDay(j.startDay),
    startMin: minutes(j.startMin),
    endDay: optDay(j.endDay),
    endMin: minutes(j.endMin),
    allDay: j.allDay ?? false,
    freq: j.freq ?? "NONE",
    interval: j.interval ?? 1,
    weekDays, monthDays, months,
    untilDay: optDay(j.untilDay),
    excludedDays,
    overduePolicy: j.overduePolicy ?? "SHOW_OVERDUE",
    priority: j.priority ?? 0,
    ...(j.routine !== undefined ? { routine: j.routine } : {}),
  });
}

function toCompletion(j: Json): Completion {
  let completedAt = 0;
  if (j.at) {
    const [d, t] = j.at.split("T");
    completedAt = toTimestamp(day(d), minutes(t)!);
  }
  return { itemId: j.itemId, day: j.day == null ? NO_DAY : day(j.day), completedAt };
}

// Normalized one-line forms, built the same way from actual results and from expectations.
const occLine = (id: number, d: string, startMin: string | null, endDay: string, endMin: string | null, completed: boolean, overdue: boolean) =>
  `id=${id} day=${d} start=${startMin} endDay=${endDay} endMin=${endMin} completed=${completed} overdue=${overdue}`;
const occActual = (o: Occurrence) =>
  occLine(o.item.id, dateStr(o.day), hhmm(o.startMin), dateStr(o.endDay), hhmm(o.endMin), o.completed, o.overdue ?? false);
const occExpected = (j: Json) =>
  occLine(j.id, j.day, normTime(j.startMin), j.endDay ?? j.day, normTime(j.endMin), j.completed ?? false, j.overdue ?? false);

const entryLine = (id: number, d: string | null, status: string, missed: number) => `id=${id} day=${d} status=${status} missed=${missed}`;
const entryActual = (e: TaskEntry) => entryLine(e.item.id, e.day === null ? null : dateStr(e.day), e.status, e.missed);
const entryExpected = (j: Json) => entryLine(j.id, j.day ?? null, j.status, j.missed ?? 0);

function run(c: Json) {
  const items: Item[] = (c.items ?? []).map(toItem);
  const completions: Completion[] = (c.done ?? []).map(toCompletion);
  const done = new CompletionIndex(completions);
  const target = () => {
    const id = c.itemId ?? items[0].id;
    const item = items.find((i) => i.id === id);
    assert.ok(item, `no item with id ${id}`);
    return item;
  };
  switch (c.fn) {
    case "days":
      assert.deepEqual(recurrenceDays(items[0], day(c.from), day(c.to)).map(dateStr), c.expect);
      return;
    case "occurrences":
      assert.deepEqual(occurrencesIn(items, done, day(c.from), day(c.to)).map(occActual), c.expect.map(occExpected));
      return;
    case "forCalendar":
      assert.deepEqual(forCalendar(items, done, day(c.from), day(c.to), day(c.today)).map(occActual), c.expect.map(occExpected));
      return;
    case "tasksForDay":
      assert.deepEqual(tasksForDay(items, done, day(c.today)).map(entryActual), c.expect.map(entryExpected));
      return;
    case "tasksOnDay":
      assert.deepEqual(tasksOnDay(items, done, day(c.day), day(c.today)).map(entryActual), c.expect.map(entryExpected));
      return;
    case "entriesFor":
      assert.deepEqual(entriesFor(target(), done, day(c.today)).map(entryActual), c.expect.map(entryExpected));
      return;
    case "currentEntry":
      assert.equal(entryActual(currentEntry(target(), done, day(c.today))), entryExpected(c.expect));
      return;
    case "tickedDuring":
      assert.deepEqual(tickedDuring(items, completions, day(c.day)).map(entryActual), c.expect.map(entryExpected));
      return;
    case "routinesOnDay":
      assert.deepEqual(routinesOnDay(items, done, day(c.day), day(c.today)).map(entryActual), c.expect.map(entryExpected));
      return;
    case "tasksForDayWithoutRoutines":
      assert.deepEqual(withoutRoutines(tasksForDay(items, done, day(c.today))).map(entryActual), c.expect.map(entryExpected));
      return;
    case "streak": {
      const s = streak(target(), done, day(c.today));
      assert.deepEqual({ current: s.current, best: s.best, total: s.total }, { current: c.expect.current, best: c.expect.best, total: c.expect.total });
      assert.ok(Math.abs(s.rate30 - c.expect.rate30) < 1e-4, `rate30 ${s.rate30} != ${c.expect.rate30}`);
      return;
    }
    default:
      assert.fail(`unknown fn ${c.fn}`);
  }
}

test("shared cases file loads", () => {
  assert.ok(file.cases.length > 0);
  assert.equal(LAST_DAY_OF_MONTH, 32);
  assert.equal(new Set(file.cases.map((c: Json) => c.name)).size, file.cases.length, "case names must be unique");
});

for (const c of file.cases) test(`shared: ${c.name}`, () => run(c));
