// HTML ↔ plain text helpers shared by previews and search.

/** Same encoding the Android editor uses: decode every entity, not just a few. */
export function stripHtml(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, "\n").replace(/<[^>]+>/g, "");
  if (typeof document !== "undefined") {
    const t = document.createElement("textarea");
    t.innerHTML = withBreaks;
    return t.value.replace(/ /g, " ");
  }
  return withBreaks
    .replace(/&lsqb;/g, "[").replace(/&rsqb;/g, "]").replace(/&period;/g, ".").replace(/&comma;/g, ",")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
}

export function preview(html: string, max = 120): string {
  return stripHtml(html).replace(/\s+/g, " ").trim().slice(0, max);
}

// ---------- Note lines (NoteText.kt) ----------

export type NoteLineKind = "TEXT" | "BULLET" | "NUMBER" | "CHECK";
/** One line of a note as a preview shows it; [level] is the list or checklist indent. */
export interface NoteLine { kind: NoteLineKind; text: string; level: number; number: number; checked: boolean }

const UNCHECKED = "\u2610", CHECKED = "\u2611";
/** Blank Braille cell, used for checklist indents. */
const INDENT_CHAR = "\u2800";
const invisible = (c: string) => /\s/.test(c) || c === "\u00a0" || c === INDENT_CHAR || (c >= "\u200b" && c <= "\u200d") || c === "\ufeff" || c === "\u2060";

function decode(s: string): string {
  if (typeof document !== "undefined") { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; }
  return s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
}

/** The note's lines in order, empty ones left out: the same reading as the Android NoteText.lines. */
export function noteLines(html: string): NoteLine[] {
  const out: NoteLine[] = [];
  const lists: { numbered: boolean; count: number }[] = [];
  let text = "", kind: NoteLineKind = "TEXT", number = 0, level = 0;
  const flush = () => {
    const raw = decode(text).replace(/\u00a0/g, " ");
    text = "";
    let i = 0, indentChars = 0;
    while (i < raw.length && (raw[i] === INDENT_CHAR || /\s/.test(raw[i]))) { if (raw[i] === INDENT_CHAR) indentChars++; i++; }
    const indent = Math.floor(indentChars / 3);
    let b = 0;
    while (b < raw.length && invisible(raw[b])) b++;
    const body = raw.slice(b);
    const box = body[0];
    const line: NoteLine = box === UNCHECKED || box === CHECKED
      ? { kind: "CHECK", text: body.slice(1).trim(), level: indent, number: 0, checked: box === CHECKED }
      : { kind, text: body.trim(), level: Math.max(level, indent), number: kind === "TEXT" ? 0 : number, checked: false };
    if (line.text || line.kind === "CHECK") out.push(line);
  };
  for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)[^>]*>|[^<]+/g)) {
    const tag = (m[2] ?? "").toLowerCase();
    if (!tag) { text += m[0]; continue; }
    const closing = m[1] === "/";
    if (tag === "ul" || tag === "ol") {
      flush();
      if (closing) lists.pop(); else lists.push({ numbered: tag === "ol", count: 0 });
      kind = "TEXT";
    } else if (tag === "li") {
      flush();
      if (!closing) {
        const l = lists[lists.length - 1] ?? { numbered: false, count: 0 };
        l.count++;
        kind = l.numbered ? "NUMBER" : "BULLET";
        number = l.count;
        level = Math.max(0, lists.length - 1);
      } else { kind = "TEXT"; level = 0; }
    } else if (/^(p|div|h[1-6])$/.test(tag)) {
      // A paragraph inside a list item is that item's text, not a new line.
      if (text.trim()) { flush(); if (!lists.length) { kind = "TEXT"; level = 0; } }
    } else if (tag === "br") flush();
  }
  flush();
  return out;
}

/**
 * A note's preview for the Notes page: one line per paragraph (empty ones left out), checklist lines as
 * "☐ " / "☑ ", list items as "• " / "1. ", indented two spaces a level; at most [maxLines] lines and
 * about [maxChars] characters, a line cut short ending in "…".
 */
export function notePreview(html: string, maxChars = 220, maxLines = 8): string {
  const out: string[] = [];
  let left = maxChars;
  for (const l of noteLines(html)) {
    if (out.length >= maxLines || left <= 0) break;
    const mark = l.kind === "CHECK" ? (l.checked ? CHECKED : UNCHECKED) + " " : l.kind === "BULLET" ? "• " : l.kind === "NUMBER" ? `${l.number}. ` : "";
    let line = "  ".repeat(Math.min(4, l.level)) + mark + l.text.replace(/\s+/g, " ");
    if (line.length > left) line = line.slice(0, Math.max(0, left - 1)).trimEnd() + "…";
    left -= line.length;
    out.push(line);
  }
  return out.join("\n");
}

// ---------- Descriptions (tasks and events): plain text in, simple HTML stored ----------

function decodeEntities(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&(#39|apos);/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&")
    .replace(/ /g, " ");
}

/**
 * A description's stored HTML as the plain text it's edited as: one line per paragraph, list items as
 * "• " or "1. " lines, checklist boxes kept as they are, formatting dropped. Plain text comes back as is.
 */
export function descriptionText(html: string): string {
  if (!/[<&]/.test(html)) return html;
  let out = "", afterBreak = false;
  const lists: { numbered: boolean; n: number }[] = [];
  const newLine = () => { if (out && !out.endsWith("\n")) out += "\n"; };
  for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)[^>]*>|[^<]+/g)) {
    const tag = (m[2] ?? "").toLowerCase();
    if (!tag) {
      const t = m[0].replace(/[\t\n\r ]+/g, " ");
      if (!t.trim() && (!out || out.endsWith("\n"))) continue; // layout whitespace between blocks
      out += decodeEntities(t);
      afterBreak = false;
      continue;
    }
    const closing = m[1] === "/";
    if (tag === "ul" || tag === "ol") {
      newLine();
      if (closing) lists.pop(); else lists.push({ numbered: tag === "ol", n: 0 });
    } else if (tag === "li") {
      newLine();
      if (!closing) {
        const l = lists[lists.length - 1];
        out += "  ".repeat(Math.max(0, lists.length - 1)) + (l?.numbered ? `${++l.n}. ` : "• ");
      }
    } else if (tag === "br") {
      out += "\n";
      afterBreak = true;
      continue;
    } else if (/^(p|div|h[1-6])$/.test(tag)) {
      // An empty paragraph (<p><br></p>) is one blank line; a paragraph inside a list item is that item.
      if (closing && !afterBreak && !lists.length) out += "\n";
      else if (!closing) newLine();
    }
    afterBreak = false;
  }
  return out.replace(/[ \n]+$/, "").replace(/^\n+/, "");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain description text as the HTML every app reads: a paragraph per line (an empty one for a blank line). */
export function plainToHtml(text: string): string {
  const t = text.replace(/\s+$/, "");
  if (!t.trim()) return "";
  return t.split("\n").map((l) => (l.trim() ? `<p>${escapeHtml(l)}</p>` : "<p><br></p>")).join("");
}
