import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { rowPick, toggleAlarms } from "../src/domain/clockList.ts";

// Review of 2.10.2, finding 4: picking alarms left gaps in an open bundle.
const alarm = (id: number, h: number, m: number, series?: number) => ({ id, hour: h, minute: m, days: 31, enabled: true, ...(series != null ? { series } : {}) });

test("a row of a series picks the whole series (it's turned on, off or deleted only as a whole)", () => {
  const series = [alarm(1, 6, 0, 9), alarm(2, 6, 10, 9), alarm(3, 6, 20, 9)];
  const sel = toggleAlarms(new Set(), rowPick(series[1], series).map((a) => a.id));
  assert.deepEqual([...sel].sort(), [1, 2, 3]);
  // A second tap on any row takes the whole series off again.
  assert.deepEqual([...toggleAlarms(sel, rowPick(series[2], series).map((a) => a.id))], []);
});

test("a row of a plain bundle picks just that alarm", () => {
  const bundle = [alarm(1, 7, 0), alarm(2, 7, 10)];
  assert.deepEqual(rowPick(bundle[1], bundle).map((a) => a.id), [2]);
});

test("while selecting, a card's switches, Skip, start time, Delete all and held digits don't act: the tap picks", () => {
  const css = readFileSync(new URL("../src/ui/phone/phone.css", import.meta.url), "utf8");
  const rule = css.match(/\.pa-scroll\.selecting \.pa-card :is\(([^)]*)\)\s*\{\s*pointer-events:\s*none/);
  assert.ok(rule, "no inert rule while selecting");
  for (const c of [".p-switch", ".pa-skipbtn", ".pa-rowskip", ".pa-bundle-start", ".tw-part", ".pa-bundle-foot"]) assert.ok(rule[1].split(/,\s*/).includes(c), c);
  // A row picked on its own shows the card's outline.
  assert.match(css, /\.pa-bundle-row\.sel\s*\{[^}]*outline:/);
});
