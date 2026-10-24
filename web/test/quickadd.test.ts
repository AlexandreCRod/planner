import assert from "node:assert/strict";
import { test } from "node:test";
import { epochOf, offsetLabel, offsetText } from "../src/domain/dates.ts";
import { parseClockCommand, parseQuickAdd } from "../src/domain/quickadd.ts";
import { dayBit } from "../src/domain/recurrence.ts";

// Thursday 22 October 2026.
const thu = epochOf(2026, 10, 22);
const p = (s: string, cats: string[] = []) => parseQuickAdd(s, thu, cats);

test("date ranges: written out, run together, or with slashes", () => {
  for (const s of ["World's weightlifting 27 Oct till 8 Nov", "World's weightlifting 27oct-8nov", "World's weightlifting 27/10-8/11",
    "World's weightlifting from 27 October to 8 November", "World's weightlifting 27 Oct - 8 Nov", "World's weightlifting Oct 27 until Nov 8"]) {
    const r = p(s);
    assert.equal(r.title, "World's weightlifting", s);
    assert.equal(r.day, epochOf(2026, 10, 27), s);
    assert.equal(r.endDay, epochOf(2026, 11, 8), s);
  }
});

test("a range in one month, one over the new year, and one already over", () => {
  const a = p("Fest 27-30 Oct");
  assert.deepEqual([a.title, a.day, a.endDay], ["Fest", epochOf(2026, 10, 27), epochOf(2026, 10, 30)]);
  const b = p("Fest Oct 27-30");
  assert.deepEqual([b.day, b.endDay], [epochOf(2026, 10, 27), epochOf(2026, 10, 30)]);
  const c = p("Holiday 28 Dec - 3 Jan");
  assert.deepEqual([c.day, c.endDay], [epochOf(2026, 12, 28), epochOf(2027, 1, 3)]);
  // Started already and still going: this year's.
  const d = p("Exhibition 1 Oct - 31 Oct");
  assert.deepEqual([d.day, d.endDay], [epochOf(2026, 10, 1), epochOf(2026, 10, 31)]);
  // Over already: next year's.
  const e = p("Camp 1/8-15/8");
  assert.deepEqual([e.day, e.endDay], [epochOf(2027, 8, 1), epochOf(2027, 8, 15)]);
  // With years.
  const f = p("Course 1/2/27-3/2/27");
  assert.deepEqual([f.day, f.endDay], [epochOf(2027, 2, 1), epochOf(2027, 2, 3)]);
});

test("single dates in every form, the next time they come", () => {
  assert.equal(p("Dentist 27oct").day, epochOf(2026, 10, 27));
  assert.equal(p("Dentist 27 Oct").day, epochOf(2026, 10, 27));
  assert.equal(p("Dentist on 3rd Nov").day, epochOf(2026, 11, 3));
  assert.equal(p("Dentist Nov 3").day, epochOf(2026, 11, 3));
  assert.equal(p("Dentist 3/11").day, epochOf(2026, 11, 3));
  assert.equal(p("Dentist 1 Mar").day, epochOf(2027, 3, 1));
  assert.equal(p("Dentist 27oct").endDay, null);
  assert.equal(p("Dentist 31/2").title, "Dentist 31/2"); // no such day: left in the title
});

test("times: at 18:30, 18-20h, and a time with a range", () => {
  const a = p("Dinner at 18:30");
  assert.deepEqual([a.title, a.day, a.startMin, a.endMin], ["Dinner", thu, 18 * 60 + 30, 19 * 60 + 30]);
  const b = p("Swim 18-20h");
  assert.deepEqual([b.title, b.startMin, b.endMin], ["Swim", 18 * 60, 20 * 60]);
  const c = p("Conference 27oct-8nov 9:00-17:00");
  assert.deepEqual([c.title, c.day, c.endDay, c.startMin, c.endMin], ["Conference", epochOf(2026, 10, 27), epochOf(2026, 11, 8), 540, 1020]);
});

test("relative days and repeats", () => {
  assert.deepEqual([p("Call Ana tomorrow").title, p("Call Ana tomorrow").day], ["Call Ana", thu + 1]);
  assert.deepEqual([p("Lunch next fri").title, p("Lunch next fri").day], ["Lunch", thu + 1]);
  const r = p("Gym every mon");
  assert.deepEqual([r.title, r.freq, r.weekDays, r.day], ["Gym", "WEEKLY", dayBit(1), thu + 4]);
  const u = p("Gym every mon until 8 Nov");
  assert.deepEqual([u.title, u.freq, u.untilDay], ["Gym", "WEEKLY", epochOf(2026, 11, 8)]);
});

test("alarms and reminders before and after the start", () => {
  assert.deepEqual([p("Run 7am alarm 30m before").title, p("Run 7am alarm 30m before").alerts], ["Run", [[30, "ALARM"]]]);
  assert.deepEqual([p("Run 7am alarm 10m after").title, p("Run 7am alarm 10m after").alerts], ["Run", [[-10, "ALARM"]]]);
  assert.deepEqual(p("Meeting 3pm remind me 15 min after").alerts, [[-15, "REMINDER"]]);
  assert.deepEqual(p("Meeting 3pm alarm 5m before and 10m after").alerts, [[5, "ALARM"], [-10, "ALARM"]]);
  // A lead time after the start is never an alarm clock.
  assert.equal(parseClockCommand("alarm 10m after", new Date(2026, 9, 22, 8)), null);
});

test("category, priority and place", () => {
  const r = p("Report fri #work !1 @Office", ["Work", "Home"]);
  assert.deepEqual([r.title, r.category, r.priority, r.place, r.tags], ["Report", "Work", 4, "Office", []]);
  // An unknown name stays a tag.
  assert.deepEqual([p("Report #urgent", ["Work"]).category, p("Report #urgent", ["Work"]).tags], [null, ["urgent"]]);
  // Spaces in a category's name can be left out.
  assert.equal(p("Ship it #daYjob", ["Day job"]).category, "Day job");
  assert.deepEqual([1, 2, 3, 4].map((n) => p(`Task !${n}`).priority), [4, 3, 2, 1]);
  assert.equal(p("Shoes @Decathlon").place, "Decathlon");
  assert.equal(p("Shoes @Decathlon").title, "Shoes");
  assert.deepEqual([p('Coffee @"Café Luso" 10am').place, p('Coffee @"Café Luso" 10am').title], ["Café Luso", "Coffee"]);
  // An e-mail address isn't a place.
  assert.equal(p("Write to ana@example.com").place, null);
});

test("with an alarm typed, \"Remind me\" adds no extra notification at the start", () => {
  assert.deepEqual(p("Remind me to call mom 3pm alarm").alerts, [[0, "ALARM"]]);
  assert.equal(p("Remind me to call mom 3pm alarm").title, "Call mom");
  assert.deepEqual(p("Remind me to stretch 7am alarm 10m before").alerts, [[10, "ALARM"]]);
  assert.deepEqual(p("Call mom 3pm remind me !alarm").alerts, [[0, "ALARM"]]);
  // A reminder with its own lead time is still asked for.
  assert.deepEqual(p("Dentist 3pm remind 1h before !alarm").alerts, [[60, "REMINDER"], [0, "ALARM"]]);
  // No alarm: the reminder at the time stays.
  assert.deepEqual(p("Remind me to call mom 3pm").alerts, [[0, "REMINDER"]]);
});

test("a title starting with Remind me is cleaned too", () => {
  const r = p("Remind me to call mom tomorrow");
  assert.deepEqual([r.title, r.day, r.alerts], ["Call mom", thu + 1, [[0, "REMINDER"]]]);
  assert.equal(p("Remind me about the invoice").title, "The invoice");
  assert.equal(p("remind me to water plants").title, "water plants");
  assert.equal(p("Remind me to stretch 7am reminder 10 min before").title, "Stretch");
  // Elsewhere it's an ordinary reminder phrase.
  assert.deepEqual([p("Call mom remind me").title, p("Call mom remind me").alerts], ["Call mom", [[0, "REMINDER"]]]);
});

test("what was there before still reads the same", () => {
  const r = p("Dentist tue 3pm remind 1h before #health !alarm !high");
  assert.deepEqual([r.title, r.startMin, r.alerts, r.priority, r.tags], ["Dentist", 900, [[60, "REMINDER"], [0, "ALARM"]], 3, ["health"]]);
  assert.equal(p("Buy alarm clock").title, "Buy alarm clock");
  assert.equal(p("Meeting 9-17").startMin, 540);
});

test("lead times read both ways", () => {
  assert.equal(offsetLabel(30), "30 min before");
  assert.equal(offsetLabel(-10), "10 min after");
  assert.equal(offsetLabel(-60), "1 hour after");
  assert.equal(offsetText(-15), "15 minutes after");
  assert.equal(offsetText(0), "At the time");
  assert.equal(offsetText(1440), "1 day before");
});
