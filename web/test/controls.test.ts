import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { contrastOf, hexToOklch } from "../src/domain/shownColor.ts";

// 2.10.5, item 2 (368: a's behaviour, c's softer blue). The dark theme's controls are the accent's hue at set
// lightnesses (phone.css "2.10.5: controls"); for the Blue accent (#a8c7fa) they must come out as c's colours.
const css = readFileSync(new URL("../src/ui/phone/phone.css", import.meta.url), "utf8");
const part = css.slice(css.indexOf("2.10.5: controls"));
const darkBlock = part.slice(part.indexOf('html.phone[data-theme="dark"] {'), part.indexOf("}", part.indexOf('html.phone[data-theme="dark"] {')));

/** Resolves `oklch(from var(--p-acc-dark, …) L calc(c * k) h)` for an accent, to sRGB hex. */
function resolve(name: string, accent: string): string {
  const m = new RegExp(`${name}: oklch\\(from var\\(--p-acc-dark, #a8c7fa\\) ([\\d.]+) calc\\(c \\* ([\\d.]+)\\) h\\)`).exec(darkBlock);
  assert.ok(m, `${name} isn't drawn from the accent`);
  const [, c, h] = hexToOklch(accent);
  return oklchHex(+m[1], c * +m[2], h);
}
function oklchHex(L: number, C: number, H: number): string {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return "#" + rgb.map((x) => Math.round(Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)) * 255).toString(16).padStart(2, "0")).join("");
}
const near = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 6);
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test("with the Blue accent, the dark controls are c's softer blues", () => {
  const blue = "#a8c7fa";
  for (const [v, want] of [["--p-primary", "#9cb3dc"], ["--p-mark", "#8ea7d4"], ["--p-sec-container", "#151c2a"], ["--p-strong", "#2a3b5a"], ["--p-on-strong", "#e3e9f5"]] as const) {
    const got = resolve(v, blue);
    assert.ok(near(got, want), `${v}: ${got}, want about ${want}`);
  }
});

test("another accent keeps its own hue (the accent setting still works)", () => {
  const rose = "#ffb1c5";
  const tab = resolve("--p-primary", rose);
  assert.ok(Math.abs(hexToOklch(tab)[2] - hexToOklch(rose)[2]) < 6, tab);
  assert.ok(!near(tab, "#9cb3dc"));
});

test("text on the controls is readable: the main button 7:1 or more, the tab blue on black and on its wash", () => {
  const blue = "#a8c7fa";
  assert.ok(contrastOf(lum(resolve("--p-on-strong", blue)), lum(resolve("--p-strong", blue))) >= 7);
  assert.ok(contrastOf(lum(resolve("--p-primary", blue)), 0) >= 7);
  assert.ok(contrastOf(lum(resolve("--p-primary", blue)), lum(resolve("--p-sec-container", blue))) >= 7);
  // A tick or switch (a mark) stands out from black by 3:1 or more.
  assert.ok(contrastOf(lum(resolve("--p-mark", blue)), 0) >= 3);
});

test("ticks and switches use the light blue; the routines count and + are outlined, the tasks bar off-white", () => {
  assert.match(part, /\.p-switch\.on \{ border-color: var\(--p-mark\); background: var\(--p-mark\); \}/);
  assert.match(part, /input\[type=checkbox\]:checked, \.phone \.p-checkbox:checked \{ border-color: var\(--p-mark\)/);
  assert.match(part, /\.phone \.p-fab \{ background: var\(--bg\); color: var\(--text\); box-shadow: inset 0 0 0 1px var\(--p-ring\); \}/);
  assert.match(part, /\.p-routines-head > \.n[^{]*\{[^}]*box-shadow: inset 0 0 0 1px var\(--p-ring\); color: var\(--text\)/);
  assert.match(part, /\.p-taskbar \.active, \.phone \.today-list \.p-taskbar \.stop \{ background: var\(--text\); \}/);
});

test("the to-do count's badge keeps its priority colour", () => {
  const today = readFileSync(new URL("../src/ui/phone/PhoneToday.tsx", import.meta.url), "utf8");
  assert.match(today, /className="p-badge"[^>]*style=\{\{ background: priorityColor\(number\.level\) \}\}/);
});
