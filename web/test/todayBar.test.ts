import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { todayBarButtons } from "../src/ui/phone/todayBar.ts";

// Review of 2.10.2, finding 2: with the "Tasks button: On" look, Today's bar held the arrows, the title's slot,
// Today and four 48 px icons away from today, so Settings went off a 390 px screen. Every icon is flex: none,
// so the bar's width is the sum of its parts: 4 px edges each side, the arrows 2 x 44, the title's slot
// (--day-slot), Today 40, and 48 for each icon (the bar's own, then Search and Settings).
const css = readFileSync(new URL("../src/ui/phone/phone.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const slotRule = (selector: string) => {
  const at = css.indexOf(`${selector} { --day-slot:`);
  const m = at < 0 ? null : css.slice(at).match(/^[^{]*\{\s*--day-slot:\s*clamp\((\d+)px,\s*calc\(100vw - (\d+)px\),\s*(\d+)px\)/);
  if (!m) return null;
  return (vw: number) => Math.min(+m[3], Math.max(+m[1], vw - +m[2]));
};
const plain = slotRule("html.phone")!;
const withTasks = slotRule(".phone .p-appbar.has-tasks") ?? plain;
const barWidth = (vw: number, isToday: boolean, tasks: boolean) => {
  const own = todayBarButtons(isToday, tasks);
  return 8 + 88 + (tasks ? withTasks : plain)(vw) + own.reduce((n, b) => n + (b === "today" ? 40 : 48), 0) + 2 * 48;
};

test("Today's bar fits at 360 and 390 px, with and without the Tasks button, on today and on other days", () => {
  for (const vw of [360, 390, 412]) for (const tasks of [false, true]) for (const isToday of [true, false])
    assert.ok(barWidth(vw, isToday, tasks) <= vw, `${vw} px, Tasks button ${tasks ? "on" : "off"}, ${isToday ? "today" : "another day"}: ${barWidth(vw, isToday, tasks)} px`);
});

test("the arrows stay still from day to day: the title's slot doesn't depend on the day", () => {
  assert.equal(barWidth(390, true, true) - 48, barWidth(390, false, true) - 40);
});

test("the Tasks button shows on today only; Today shows away from today; the to-dos always", () => {
  assert.deepEqual(todayBarButtons(true, true), ["tasks", "todos"]);
  assert.deepEqual(todayBarButtons(false, true), ["today", "todos"]);
  assert.deepEqual(todayBarButtons(true, false), ["todos"]);
  assert.deepEqual(todayBarButtons(false, false), ["today", "todos"]);
});
