// Web links in text (notes, descriptions): where they are, and the address to open for each. Nothing is
// stored for them; the text stays as typed. Pure, checked by test/links.test.ts.

/** A web link found in a text: its place in the text, the text as written, and the address to open. */
export interface WebLink { start: number; end: number; text: string; url: string }

const CANDIDATE = /(?:https?:\/\/|www\.)[^\s⠀ <>"`]+/gi;
const TRAILING = /[.,;:!?'’”"\]}]$/;

/** [raw] without the punctuation a sentence puts after a link (a closing bracket stays when the link opened one). */
function trimEnd(raw: string): string {
  let s = raw;
  for (;;) {
    if (TRAILING.test(s)) { s = s.slice(0, -1); continue; }
    if (s.endsWith(")") && (s.match(/\(/g)?.length ?? 0) < (s.match(/\)/g)?.length ?? 0)) { s = s.slice(0, -1); continue; }
    return s;
  }
}

/** The web links in [text], in order. "www." links open as https. */
export function findLinks(text: string): WebLink[] {
  const out: WebLink[] = [];
  for (const m of text.matchAll(CANDIDATE)) {
    const t = trimEnd(m[0]);
    const url = t.replace(/^www\./i, "https://www.");
    // It has to be an address the browser can read, with a dotted host.
    try { if (!new URL(url).hostname.includes(".")) continue; } catch { continue; }
    out.push({ start: m.index!, end: m.index! + t.length, text: t, url });
  }
  return out;
}

/** The link that [pos] (a caret position, either edge counted) is in, if any. */
export function linkAt(text: string, pos: number): WebLink | null {
  return findLinks(text).find((l) => pos >= l.start && pos <= l.end) ?? null;
}

/** The address as a short line: no scheme, no "www.", no trailing slash. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/** What the Worker knows of a web page (GET /api/preview); [image] is a small data URL or "". */
export interface LinkPreview { url: string; title: string; description: string; site: string; image: string }
