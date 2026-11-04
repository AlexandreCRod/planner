import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 346: progress.css styled ".pg-head", the calendar's day header's class too, so once Progress had been opened
// the Week/3-day/Day header was squeezed to 56 px and the training marks under the day numbers were cut off.
// Progress's own top-level rules must not style a class the calendar's sheet (phone.css) already styles.
const read = (f: string) => readFileSync(new URL(`../src/ui/phone/${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Classes a sheet styles at the top level: rules that start ".phone .x" (not ".phone .y .x"). */
const topClasses = (css: string) => new Set([...css.matchAll(/(?:^|[},])\s*\.phone \.([a-z][\w-]*)(?=[\s.:{,[])/gm)].map((m) => m[1]));

test("Progress's sheet doesn't restyle the calendar's classes (346)", () => {
  const calendar = topClasses(read("phone.css"));
  const clash = [...topClasses(read("progress.css"))].filter((c) => calendar.has(c));
  assert.deepEqual(clash, []);
});

test("the check sees a clash when there is one", () => {
  const a = topClasses(".phone .pg-head { display: flex; }");
  const b = topClasses(".phone .pg-head { height: 56px; }\n.phone .pg-chart .pg-grid { stroke: red; }");
  assert.deepEqual([...b].filter((c) => a.has(c)), ["pg-head"]);
  assert.equal(b.has("pg-grid"), false);
});
