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
// With the Tasks button look the bar is drawn tighter (arrows 40, icons 44): read from phone.css.
const tight = /\.p-appbar\.has-tasks \.p-dayrow > \.p-icon\.title-icon \{ width: 40px; \}/.test(css)
  && /\.p-appbar\.has-tasks > :is\(\.p-icon:not\(\.p-today-btn\), \.p-menu-anchor[^)]*\) \{ width: 44px; \}/.test(css);
const barWidth = (vw: number, isToday: boolean, tasks: boolean) => {
  const own = todayBarButtons(isToday, tasks);
  const arrow = tasks && tight ? 40 : 44, icon = tasks && tight ? 44 : 48;
  return 8 + 2 * arrow + (tasks ? withTasks : plain)(vw) + own.reduce((n, b) => n + (b === "today" ? 40 : icon), 0) + 2 * icon;
};

test("Today's bar fits at 360 and 390 px, with and without the Tasks button, on today and on other days", () => {
  for (const vw of [360, 390, 412]) for (const tasks of [false, true]) for (const isToday of [true, false])
    assert.ok(barWidth(vw, isToday, tasks) <= vw, `${vw} px, Tasks button ${tasks ? "on" : "off"}, ${isToday ? "today" : "another day"}: ${barWidth(vw, isToday, tasks)} px`);
});

// The arrows stay still from day to day (341) only if nothing that places them depends on the day. The bar's
// one difference between today and another day is the Today button (.p-today-btn): a rule that reaches the
// arrows, the title's slot or the row through it (":has(.p-today-btn)", or ".p-today-btn ~ ..." / "+ ...") and
// changes a size or place would move them. (Review of 2.10.3, finding 9: the old check compared barWidth with
// itself, which can't differ by day, so it passed whatever the CSS did.)
const LAYOUT = /(^|;)\s*(--day-slot|width|min-width|max-width|flex[\w-]*|margin[\w-]*|padding[\w-]*|order|justify-content|gap|position|left|right|inset|transform)\s*:/;
/** The rules whose selector depends on the day and which change a size or a place. */
const dayDependent = (sheet: string) => [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, sel, body]) => /:has\([^)]*p-today-btn|\.p-today-btn[^,{]*[~+]/.test(sel) && LAYOUT.test(body.trim()))
  .map(([, sel]) => sel.trim());
/** Where the arrows sit from the bar's start (px): the ‹'s left, the ›'s left, given the sheet's slot and arrows. */
const arrows = (vw: number, tasks: boolean) => {
  const arrow = tasks && tight ? 40 : 44, slot = (tasks ? withTasks : plain)(vw);
  return [4, 4 + arrow + slot];
};

test("the arrows stay still from day to day: nothing that places them depends on the day", () => {
  assert.deepEqual(dayDependent(css), []);
  // The row of arrows and title comes first in the bar, so it starts at the edge whatever follows it.
  assert.match(css, /\.phone \.p-dayrow \{ flex: none;/);
  for (const vw of [360, 390, 412]) for (const tasks of [false, true]) {
    const [l, r] = arrows(vw, tasks);
    assert.ok(l >= 0 && r > l + 40, `${vw} px: the arrows at ${l} and ${r}`);
  }
});

test("the day check sees a rule that would move the arrows on days away from today", () => {
  assert.deepEqual(dayDependent(".phone .p-appbar:has(.p-today-btn) { --day-slot: 60px; }"), [".phone .p-appbar:has(.p-today-btn)"]);
  assert.deepEqual(dayDependent(".phone .p-today-btn ~ .p-dayrow > .p-icon { width: 40px; }"), [".phone .p-today-btn ~ .p-dayrow > .p-icon"]);
  // The Today button's own size is the same on every day it shows: not a move.
  assert.deepEqual(dayDependent(".phone .p-icon.p-today-btn { width: 40px; }"), []);
  assert.deepEqual(dayDependent(".phone .p-appbar:has(.p-today-btn) { color: red; }"), []);
});

test("the Tasks button (when on) shows on every day; Today shows away from today; the to-dos always", () => {
  assert.deepEqual(todayBarButtons(true, true), ["tasks", "todos"]);
  assert.deepEqual(todayBarButtons(false, true), ["today", "tasks", "todos"]);
  assert.deepEqual(todayBarButtons(true, false), ["todos"]);
  assert.deepEqual(todayBarButtons(false, false), ["today", "todos"]);
});
