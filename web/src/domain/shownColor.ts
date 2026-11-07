// The user's own colours as drawn (2.10.5, 332b B "tuned for black"): a category's colour, as stored, is the
// colour picked from the palette. On the dark theme it's drawn at one shared lightness, so no category jumps
// out or fades away on black, and a little more saturated, up to a cap, so none glows. Where the screen can
// show more than sRGB (the phone draws in Display P3 since 363a), the colour may reach past sRGB, written as
// color(display-p3 …); a screen that can't is mapped back by the browser. The light theme keeps the stored
// colour. The two are handed to CSS as light-dark(stored, tuned), so the page's theme picks one.

/** The shared lightness of category colours on black (OKLab L; 332b B: every category at 0.72). */
export const SHOWN_L = 0.72;
/** No colour gets more chroma than this (OKLCH), so nothing glows on black. */
export const SHOWN_C_MAX = 0.19;
/** How much richer a colour is drawn than stored, before the cap and the screen's gamut. */
const BOOST = 1.3;
/** Kept this far inside the gamut's edge (B's values sit about 95 % of the way to sRGB's edge). */
const EDGE = 0.95;

type V3 = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** "#rrggbb" → OKLCH [L, C, H in degrees]. */
export function hexToOklch(hex: string): V3 {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

/** OKLCH → linear sRGB and linear Display P3 (either may fall outside 0..1). */
function oklchToLinear(L: number, C: number, H: number): { srgb: V3; p3: V3 } {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const srgb: V3 = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const X = 0.4123907993 * srgb[0] + 0.3575843394 * srgb[1] + 0.1804807884 * srgb[2];
  const Y = 0.2126390059 * srgb[0] + 0.7151686788 * srgb[1] + 0.0721923054 * srgb[2];
  const Z = 0.0193308187 * srgb[0] + 0.1191947798 * srgb[1] + 0.9505321522 * srgb[2];
  const p3: V3 = [
    2.4934969119 * X - 0.9313836179 * Y - 0.4027107845 * Z,
    -0.8294889696 * X + 1.7626640603 * Y + 0.0236246858 * Z,
    0.0358458302 * X - 0.0761723893 * Y + 0.956884524 * Z,
  ];
  return { srgb, p3 };
}

const inGamut = (v: V3) => v.every((x) => x >= -1e-6 && x <= 1 + 1e-6);

/** The most chroma a colour of lightness [L] and hue [H] can have in [space]. */
function maxChroma(L: number, H: number, space: "srgb" | "p3"): number {
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear(L, mid, H)[space])) lo = mid; else hi = mid;
  }
  return lo;
}

const hex2 = (x: number) => Math.round(Math.min(1, Math.max(0, fromLinear(x))) * 255).toString(16).padStart(2, "0");
const p3n = (x: number) => +Math.min(1, Math.max(0, fromLinear(x))).toFixed(4);

/** A tuned colour: what CSS gets, and its relative luminance (WCAG), for contrast. */
export interface Tuned { css: string; luminance: number; wide: boolean }

/**
 * Yellows go muddy (olive) at the shared lightness, so they're drawn lighter, as B's yellow flag is (0.82): a
 * smooth lift centred on yellow (hue 95), none outside 65–125.
 */
export function yellowLift(H: number): number {
  const d = Math.abs(((H - 95 + 540) % 360) - 180);
  return d >= 30 ? 0 : 0.1 * (0.5 + 0.5 * Math.cos((d / 30) * Math.PI));
}

/** [hex] ("#rrggbb") as drawn on black: lightness [base] (yellows lifted), chroma boosted up to the cap and the screen's gamut. */
export function tuneForBlack(hex: string, base = SHOWN_L): Tuned {
  const [, C, H] = hexToOklch(hex);
  // A grey has no hue to lift.
  const L = base + (C > 0.04 ? yellowLift(H) : 0);
  const want = Math.min(SHOWN_C_MAX, C * BOOST);
  const srgbMax = maxChroma(L, H, "srgb");
  const c = Math.min(want, maxChroma(L, H, "p3") * EDGE);
  const { srgb } = oklchToLinear(L, Math.min(c, srgbMax), H);
  const luminance = 0.2126 * Math.max(0, srgb[0]) + 0.7152 * Math.max(0, srgb[1]) + 0.0722 * Math.max(0, srgb[2]);
  if (c <= srgbMax) return { css: `#${srgb.map(hex2).join("")}`, luminance, wide: false };
  // Past sRGB: written in Display P3 (luminance from the wide colour itself).
  const w = oklchToLinear(L, c, H);
  const Y = 0.2126390059 * w.srgb[0] + 0.7151686788 * w.srgb[1] + 0.0721923054 * w.srgb[2];
  return { css: `color(display-p3 ${w.p3.map(p3n).join(" ")})`, luminance: Y, wide: true };
}

const cache = new Map<string, string>();

/**
 * A user colour as CSS: the stored colour on the light theme, the tuned one on the dark theme (light-dark(), which
 * follows the page's color-scheme). Anything that isn't a plain "#rrggbb" (a var(), "transparent") is passed through.
 */
export function shownColor(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  let out = cache.get(hex);
  if (!out) { out = `light-dark(${hex}, ${tuneForBlack(hex.toLowerCase()).css})`; cache.set(hex, out); }
  return out;
}

/** WCAG contrast of two relative luminances. */
export const contrastOf = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
