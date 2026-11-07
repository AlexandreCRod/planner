import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Review of 2.10.3, finding 5: a menu that scrolls up and down (overflow-y: auto) turns its sideways overflow
// into scrolling too, so a long calendar or stopwatch name made the whole menu pan sideways under a slide.
// The menu clips sideways, and a long name ends in "…" (its row is one line, white-space: nowrap).
const css = readFileSync(new URL("../src/ui/phone/phone.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Every declaration given to exactly [selector], across the sheet, as a map. */
const decls = (selector: string) => {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(",").some((s) => s.trim() === selector)) continue;
    for (const d of m[2].split(";")) { const [k, ...v] = d.split(":"); if (k.trim() && v.length) out.set(k.trim(), v.join(":").trim()); }
  }
  return out;
};

test("a menu scrolls up and down but never sideways", () => {
  const menu = decls(".phone .p-menu");
  assert.equal(menu.get("overflow-y"), "auto");
  assert.equal(menu.get("overflow-x"), "hidden");
});

test("a long name in a menu row ends in an ellipsis instead of running past the menu", () => {
  assert.equal(decls(".phone .p-menu button").get("white-space"), "nowrap");
  const name = decls(".phone .p-menu button .grow");
  assert.equal(name.get("text-overflow"), "ellipsis");
  assert.equal(name.get("overflow"), "hidden");
});
