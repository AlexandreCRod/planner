import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = (f: string) => readFileSync(new URL(`../src/ui/phone/${f}`, import.meta.url), "utf8");

// 383: the page is called "Clocks" (the tab and the page title), not "Clock"; "alarm clock" words stay.
test("the tab and the page are called Clocks", () => {
  assert.match(src("PhoneApp.tsx"), /\{ key: "alarms", label: "Clocks" \}/);
  assert.match(src("PhoneAlarms.tsx"), /<TopAppBar title="Clocks"/);
  assert.doesNotMatch(src("PhoneAlarms.tsx"), /title="Clock"/);
});

// 383 (and 336): on the Clocks page itself the tab keeps the ring and time while a timer or stopwatch runs.
test("the Clocks tab's ring and time don't depend on which page is shown", () => {
  const tab = src("ClockTab.tsx");
  const hook = tab.slice(tab.indexOf("export function useClockTab"), tab.indexOf("export function ClockTabMenu"));
  assert.match(hook, /export function useClockTab\(\)/);
  assert.doesNotMatch(hook, /shown/);
});
