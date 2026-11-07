import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 374: "Clear formatting" also turns formatting off for what's typed next, not only on the selection.
test("Clear formatting with only a caret makes what's typed next plain, outside every format around it", () => {
  const bar = readFileSync(new URL("../src/ui/phone/RichBar.tsx", import.meta.url), "utf8");
  assert.match(bar, /label="Clear formatting" onClick=\{\(\) => ed\(\)\?\.clearFormatting\(\)\}/);
  assert.doesNotMatch(bar, /exec\("removeFormat"\)/);
  const ed = readFileSync(new URL("../src/ui/shared/RichEditor.tsx", import.meta.url), "utf8");
  const formats = /const FORMATS = new Set\(\[([^\]]+)\]\)/.exec(ed)?.[1] ?? "";
  for (const tag of ["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "MARK", "SPAN", "FONT"]) assert.match(formats, new RegExp(`"${tag}"`), tag);
  assert.doesNotMatch(formats, /"A"/, "a link stays a link");
  const clear = ed.slice(ed.indexOf("const clearFormatting = () =>"), ed.indexOf("const clearFormatting = () =>") + 1400);
  assert.match(clear, /liftOut\(span, block, isFormatting\)/);
  assert.match(clear, /sel\.collapse\(span\.firstChild!, 1\)/);
});
