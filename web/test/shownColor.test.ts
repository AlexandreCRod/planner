import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { SHOWN_C_MAX, SHOWN_L, contrastOf, hexToOklch, shownColor, tuneForBlack } from "../src/domain/shownColor.ts";
import { cssColor } from "../src/domain/types.ts";

// 2.10.5, item 1 (332b B): the user's colours tuned for black.
// The palette to pick from (m3.tsx PALETTE, read from the source: a .tsx can't be imported here).
const m3 = readFileSync(new URL("../src/ui/phone/m3.tsx", import.meta.url), "utf8");
const palette = [...m3.slice(m3.indexOf("export const PALETTE")).split("]")[0].matchAll(/0x([0-9a-f]{8})/g)].map((m) => cssColor(parseInt(m[1], 16) | 0));
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test("every palette colour reads as text on black (7:1 or more) once tuned", () => {
  for (const hex of palette) {
    const t = tuneForBlack(hex);
    assert.ok(contrastOf(t.luminance, 0) >= 7, `${hex} → ${t.css}: ${contrastOf(t.luminance, 0).toFixed(2)}:1`);
  }
});

test("the stored palette itself doesn't all pass, so the tuning is what lifts it", () => {
  // The deep indigo and purple are under 7:1 as stored: the check above would fail without the tuning.
  assert.ok(palette.some((h) => contrastOf(lum(h), 0) < 7));
});

test("tuned colours share one lightness (yellows a little lighter) and none passes the chroma cap", () => {
  for (const hex of palette) {
    const t = tuneForBlack(hex);
    if (t.wide) continue;   // a P3 colour has no sRGB hex to read back
    const [L, C, H] = hexToOklch(t.css);
    const yellow = H > 65 && H < 125;
    assert.ok(Math.abs(L - SHOWN_L) < 0.02 || (yellow && L > SHOWN_L && L <= SHOWN_L + 0.11), `${hex} → ${t.css}: L ${L.toFixed(3)}`);
    assert.ok(C <= SHOWN_C_MAX + 0.01, `${hex} → ${t.css}: C ${C.toFixed(3)}`);
  }
});

test("Work's dark indigo and Home's green come out equally light, unlike as stored", () => {
  const work = tuneForBlack("#5c6bc0"), home = tuneForBlack("#66bb6a");
  assert.ok(Math.abs(lum("#5c6bc0") - lum("#66bb6a")) > 0.2);
  // Equal OKLab lightness: luminance within a narrow band (blue reads a little darker by luminance).
  assert.ok(contrastOf(work.luminance, home.luminance) < 1.2, `${work.css} vs ${home.css}`);
});

test("colours that reach past sRGB are written in Display P3; greys stay grey", () => {
  assert.match(tuneForBlack("#1e88e5").css, /^color\(display-p3 [\d.]+ [\d.]+ [\d.]+\)$/);
  const grey = tuneForBlack("#757575");
  assert.equal(grey.wide, false);
  const [, C] = hexToOklch(grey.css);
  assert.ok(C < 0.01, grey.css);
});

test("the page gets light-dark(stored, tuned); anything else passes through", () => {
  assert.equal(shownColor("#42a5f5"), `light-dark(#42a5f5, ${tuneForBlack("#42a5f5").css})`);
  assert.equal(shownColor("var(--danger)"), "var(--danger)");
});

test("the widgets get the stored colour, the page the shown one", () => {
  const w = readFileSync(new URL("../src/alarms/widgets.ts", import.meta.url), "utf8");
  assert.match(w, /color: \(i\) => s\.rawColorOf\(i\)/);
});

test("flags and training kinds take B's values on the dark theme, all marks 3:1 or more on black", () => {
  const css = readFileSync(new URL("../src/ui/phone/phone.css", import.meta.url), "utf8");
  const tr = readFileSync(new URL("../src/ui/phone/training.css", import.meta.url), "utf8");
  const dark = css.slice(css.indexOf("2.10.5: the user's colours tuned for black"));
  for (const v of ["--prio-1: #57aafa", "--prio-2: #e9c02b", "--prio-3: #fb9335", "--prio-4: #fb6863"]) assert.ok(dark.includes(v), v);
  for (const v of ["--k-run: #3acab7", "--k-gym: #e9a033"]) assert.ok(tr.includes(v), v);
  for (const h of ["#57aafa", "#e9c02b", "#fb9335", "#fb6863", "#3acab7", "#e9a033", "#39c1f3", "#b49bf5", "#8bb1f7"]) assert.ok(contrastOf(lum(h), 0) >= 7, h);
});

test("the calendar's wash is a look: Soft by default, Rich B's 26 %", async () => {
  const { LOOKS } = await import("../src/ui/phone/looks.ts");
  assert.equal(LOOKS.calendarColour.pick, "soft");
  const css = readFileSync(new URL("../src/ui/phone/phone.css", import.meta.url), "utf8");
  assert.match(css, /html\.phone\.cal-rich\[data-theme="dark"\] \{ --cal-wash: 26%/);
  assert.match(css, /\.phone \.pg-block \{ background: color-mix\(in srgb, var\(--c\) var\(--cal-wash\)/);
});
