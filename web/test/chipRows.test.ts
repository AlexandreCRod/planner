import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// A page's content only pans up and down (300), so the app can have sideways swipes. A row that scrolls
// sideways has to let its children pan too: the browser goes by what's under the finger, here a chip.
const css = ["phone", "training"].map((f) => readFileSync(new URL(`../src/ui/phone/${f}.css`, import.meta.url), "utf8")).join("\n");
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selectors: m[1].split(",").map((s) => s.trim()), body: m[2], at: m.index }));

const sideways = rules.filter((r) => /touch-action:[^;]*pan-x/.test(r.body) && /overflow-x:\s*(auto|scroll)/.test(r.body))
  .flatMap((r) => r.selectors);

test("the rows that scroll sideways are found", () => {
  for (const row of [".phone .p-chiprow", ".phone .p-rchips", ".phone .pa-filter"]) assert.ok(sideways.includes(row), row);
});

test("what's inside a sideways row can pan sideways, and that wins over the page's rule", () => {
  const page = rules.find((r) => r.selectors.includes(".phone .p-page *") && /touch-action:\s*pan-y/.test(r.body));
  assert.ok(page, "the page's pan-y rule");
  for (const row of sideways) {
    const kids = rules.find((r) => r.selectors.includes(`${row} *`) && /touch-action:[^;]*pan-x/.test(r.body));
    assert.ok(kids, `${row} * lets its children pan sideways`);
    assert.ok(kids.at > page.at, `${row} * comes after the page's rule`);
  }
});
