import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 373: a tap on the Calendar's month name drops down a small month; a day picked there is where the calendar goes.
test("the Calendar's month name opens the month drop-down, and a day picked there moves the calendar", () => {
  const cal = readFileSync(new URL("../src/ui/phone/PhoneCalendar.tsx", import.meta.url), "utf8");
  assert.match(cal, /className="p-calmonth"[\s\S]{0,200}?aria-expanded=\{monthOpen\}[\s\S]{0,200}?onClick=\{\(\) => setMonthOpen\(!monthOpen\)\}/);
  assert.match(cal, /<MonthDropdown value=\{anchor\}[\s\S]{0,200}?onPick=\{\(d\) => \{ setAnchor\(d\);/);
  const pick = readFileSync(new URL("../src/ui/phone/pickers.tsx", import.meta.url), "utf8");
  const drop = pick.slice(pick.indexOf("export function MonthDropdown"), pick.indexOf("function weekLabels"));
  assert.match(drop, /pushBack\(onClose\)/, "back and Esc close it");
  assert.match(drop, /p-menu-scrim" onClick=\{onClose\}/, "a tap outside closes it");
  assert.match(drop, /useSwipePager/, "it swipes to other months");
  assert.match(drop, /<YearList/, "and changes year");
});

// Review of 2.10.4, finding 5: a tap on the bottom bar with the drop-down open left it open behind the next page,
// where it took that page's next back press.
test("leaving the Calendar closes the month drop-down", async () => {
  const { calendarLeft, onCalendarLeft } = await import("../src/ui/phone/calendarTop.ts");
  let closed = 0;
  const stop = onCalendarLeft(() => { closed++; });
  calendarLeft();
  assert.equal(closed, 1);
  stop();
  calendarLeft();
  assert.equal(closed, 1, "once closed, it no longer listens");
  const pick = readFileSync(new URL("../src/ui/phone/pickers.tsx", import.meta.url), "utf8");
  const drop = pick.slice(pick.indexOf("export function MonthDropdown"), pick.indexOf("function weekLabels"));
  assert.match(drop, /onCalendarLeft\(onClose\)/);
  const app = readFileSync(new URL("../src/ui/phone/PhoneApp.tsx", import.meta.url), "utf8");
  assert.match(app, /if \(moved && TABS\[tabRef\.current\]\?\.key === "calendar"\) calendarLeft\(\);/);
});
