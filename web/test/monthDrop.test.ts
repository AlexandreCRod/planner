import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 373: a tap on the Calendar's month name drops down a small month; a day picked there is where the calendar goes.
test("the Calendar's month name opens the month drop-down, and a day picked there moves the calendar", () => {
  const cal = readFileSync(new URL("../src/ui/phone/PhoneCalendar.tsx", import.meta.url), "utf8");
  assert.match(cal, /className="p-calmonth"[^>]*aria-expanded=\{monthOpen\}[^>]*onClick=\{\(\) => setMonthOpen\(!monthOpen\)\}/);
  assert.match(cal, /<MonthDropdown value=\{anchor\}[^>]*onPick=\{\(d\) => \{ setAnchor\(d\);/);
  const pick = readFileSync(new URL("../src/ui/phone/pickers.tsx", import.meta.url), "utf8");
  const drop = pick.slice(pick.indexOf("export function MonthDropdown"), pick.indexOf("function weekLabels"));
  assert.match(drop, /pushBack\(onClose\)/, "back and Esc close it");
  assert.match(drop, /p-menu-scrim" onClick=\{onClose\}/, "a tap outside closes it");
  assert.match(drop, /useSwipePager/, "it swipes to other months");
  assert.match(drop, /<YearList/, "and changes year");
});
