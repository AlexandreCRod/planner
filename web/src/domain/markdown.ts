// Finding places in the training plan's documents (Markdown written by the plan session). A link can
// point at a fixed anchor (<a id="card-gym-a"></a> on its own line, before a heading) or at a heading's
// own slug, as GitHub makes them (#gym-loads-s1-to-s9). Both resolve here; the page renders the text.

/** A heading's GitHub-style id: lower case, punctuation dropped (letters, digits, "-" and "_" kept), spaces as "-". */
export function slugOf(heading: string): string {
  return heading
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ANCHOR = /^\s*<a\s+id="([^"]+)"\s*>\s*<\/a>\s*$/i;

interface Line { text: string; level: number; heading: string }

function linesOf(md: string): Line[] {
  let fence = false;
  return md.split(/\r?\n/).map((text) => {
    if (/^\s*(```|~~~)/.test(text)) fence = !fence;
    const h = fence ? null : HEADING.exec(text);
    return { text, level: h ? h[1].length : 0, heading: h ? h[2] : "" };
  });
}

/**
 * Every id a link can point at, each with the line it starts on: explicit anchors (the line itself) and
 * heading slugs, numbered like GitHub's when a heading repeats ("notes", "notes-1"...).
 */
export function anchorsIn(md: string): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Map<string, number>();
  linesOf(md).forEach((l, i) => {
    const a = ANCHOR.exec(l.text);
    if (a) { if (!out.has(a[1])) out.set(a[1], i); return; }
    if (!l.level) return;
    const base = slugOf(l.heading);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = n ? `${base}-${n}` : base;
    if (!out.has(id)) out.set(id, i);
  });
  return out;
}

/**
 * The part of a document an anchor names, as Markdown: from the heading at (or just after) the anchor
 * down to the next heading of the same or a higher level. Null when the anchor isn't there.
 */
export function sectionAt(md: string, anchor: string): string | null {
  const start = anchorsIn(md).get(anchor);
  if (start === undefined) return null;
  const lines = linesOf(md);
  let h = start;
  while (h < lines.length && !lines[h].level) h++;
  if (h >= lines.length) return lines.slice(start).map((l) => l.text).join("\n").trim();
  const level = lines[h].level;
  let end = h + 1;
  while (end < lines.length && !(lines[end].level && lines[end].level <= level)) end++;
  // An anchor line just before the next heading belongs to that one.
  while (end > h + 1 && (ANCHOR.test(lines[end - 1].text) || !lines[end - 1].text.trim())) end--;
  return lines.slice(h, end).map((l) => l.text).join("\n").trim();
}

/** A link's target inside the plan's documents: "Workout-Days.md#card-gym-a", "#key-rules", "Race-Day.md". */
export function parseDocLink(href: string): { file: string | null; anchor: string | null } | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // http:, mailto:...: not a document link
  const [path, hash] = href.split("#", 2);
  const file = path ? decodeURIComponent(path.replace(/^\.\//, "")) : null;
  if (file && !/\.md$/i.test(file)) return null;
  return { file, anchor: hash ? decodeURIComponent(hash) : null };
}

// ---------- Reading a document into blocks ----------
// The documents use a small part of Markdown: headings, paragraphs, nested lists, bold, italic, links,
// rules, <details> with a <summary>, and the odd table or code. They're turned into plain data here and
// drawn by the page as React elements, never as HTML, so nothing in a file can run in the app.

export type Inline =
  | { t: "text"; text: string }
  | { t: "strong" | "em"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "link"; href: string; children: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "heading"; level: number; id: string; children: Inline[] }
  | { t: "para"; children: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "quote"; blocks: Block[] }
  | { t: "code"; text: string }
  | { t: "hr" }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "details"; summary: Inline[]; blocks: Block[] }
  /** An explicit anchor (<a id="..."></a>): a place a link can jump to. */
  | { t: "anchor"; id: string };

const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const TAG_LINE = /^\s*<\/?[a-z][^>]*>\s*$/i;

/** Turns a document (or a section of one) into blocks. Heading ids match [anchorsIn]'s. */
export function parseMarkdown(md: string): Block[] {
  return blocksOf(md.split(/\r?\n/), new Map());
}

/** Whether [line] starts a block of its own (so it ends a paragraph). */
function startsBlock(line: string): boolean {
  return HEADING.test(line) || FENCE.test(line) || RULE.test(line) || ANCHOR.test(line) || /^\s*>/.test(line) ||
    /^\s*<\/?(details|summary)\b/i.test(line) || ITEM.test(line);
}

function blocksOf(lines: string[], seen: Map<string, number>): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (FENCE.test(line)) {
      const fence = FENCE.exec(line)![1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      i++;
      out.push({ t: "code", text: body.join("\n") });
      continue;
    }
    const a = ANCHOR.exec(line);
    if (a) { out.push({ t: "anchor", id: a[1] }); i++; continue; }
    if (/^\s*<details\b/i.test(line)) {
      // To the matching </details>, nested ones counted.
      let depth = 0;
      const body: string[] = [];
      for (; i < lines.length; i++) {
        depth += (lines[i].match(/<details\b/gi) ?? []).length;
        depth -= (lines[i].match(/<\/details>/gi) ?? []).length;
        body.push(lines[i]);
        if (depth <= 0) { i++; break; }
      }
      const text = body.join("\n").replace(/^\s*<details[^>]*>/i, "").replace(/<\/details>\s*$/i, "");
      const sm = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(text);
      out.push({
        t: "details", summary: inlines(sm ? sm[1].trim() : "Details"),
        blocks: blocksOf((sm ? text.replace(sm[0], "") : text).split("\n"), seen),
      });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const base = slugOf(h[2]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.push({ t: "heading", level: h[1].length, id: n ? `${base}-${n}` : base, children: inlines(h[2]) });
      i++;
      continue;
    }
    if (RULE.test(line)) { out.push({ t: "hr" }); i++; continue; }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", blocks: blocksOf(body, seen) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => inlines(c.trim()));
      const head = cells(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push({ t: "table", head, rows });
      continue;
    }
    if (ITEM.test(line) && ITEM.exec(line)![1].length <= 3) {
      i = listAt(lines, i, out, seen);
      continue;
    }
    if (TAG_LINE.test(line)) { i++; continue; } // stray HTML (a closing tag...): nothing to show
    const body = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) body.push(lines[i++]);
    out.push({ t: "para", children: inlines(body.join("\n")) });
  }
  return out;
}

const indentOf = (l: string) => /^\s*/.exec(l.replace(/\t/g, "    "))![0].length;

/** A list starting at line [start]: its items, each parsed as blocks of its own (nested lists included). */
function listAt(lines: string[], start: number, out: Block[], seen: Map<string, number>): number {
  const first = ITEM.exec(lines[start])!;
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: Block[][] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
    const inner = base + m[2].length + 1;
    const body = [m[3]];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        // A blank line: the item goes on only if what follows is indented under it.
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && indentOf(lines[j]) > base) { while (i < j) { body.push(""); i++; } continue; }
        break;
      }
      const ind = indentOf(l);
      if (ind <= base && (ITEM.test(l) || startsBlock(l))) break;
      if (ind <= base && body[body.length - 1] === "") break;
      body.push(l.replace(/\t/g, "    ").slice(Math.min(ind, inner)));
      i++;
    }
    items.push(blocksOf(body, seen));
    // Blank lines between items of the same list keep it going.
    let j = i;
    while (j < lines.length && !lines[j].trim()) j++;
    const next = j < lines.length ? ITEM.exec(lines[j]) : null;
    if (next && next[1].length === base && /\d/.test(next[2]) === ordered) i = j;
    else break;
  }
  out.push({ t: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items });
  return i;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") {
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** [text](href): where it ends, or null. Brackets and parentheses inside are balanced (Wikipedia links). */
function linkAt(s: string, i: number): { text: string; href: string; end: number } | null {
  let depth = 0, j = i;
  for (; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === "[") depth++;
    else if (s[j] === "]" && --depth === 0) break;
  }
  if (j >= s.length || s[j + 1] !== "(") return null;
  let k = j + 2;
  depth = 1;
  for (; k < s.length; k++) {
    if (s[k] === "(") depth++;
    else if (s[k] === ")" && --depth === 0) break;
  }
  if (k >= s.length) return null;
  const href = s.slice(j + 2, k).trim().replace(/\s+"[^"]*"$/, "").replace(/^<(.*)>$/, "$1");
  return { text: s.slice(i + 1, j), href, end: k + 1 };
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Where the emphasis opened at [from] by [d] ("*", "**", "_", "__") closes, or -1. */
function closeOf(s: string, from: number, d: string): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === "`") { const e = s.indexOf("`", j + 1); if (e > 0) { j = e; continue; } }
    if (s[j] === "[") { const l = linkAt(s, j); if (l) { j = l.end - 1; continue; } }
    if (!s.startsWith(d, j) || j === from || /\s/.test(s[j - 1])) continue;
    if (d.length === 1 && s[j + 1] === d) { j++; continue; } // part of a double: not this one
    if (d[0] === "_" && isWordChar(s[j + d.length])) continue;
    return j;
  }
  return -1;
}

/** One paragraph's text into inline pieces: bold, italic, code, links, line breaks. */
export function inlines(src: string): Inline[] {
  const s = src.replace(/( {2,}|\\)\n/g, "<br>").replace(/\s*\n\s*/g, " ");
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ t: "text", text: decode(text) }); text = ""; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && /[\\`*_{}[\]()#+\-.!|<>~]/.test(s[i + 1] ?? "")) { text += s[i + 1]; i += 2; continue; }
    if (c === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i) { flush(); out.push({ t: "code", text: s.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (c === "[") {
      const l = linkAt(s, i);
      if (l) { flush(); out.push({ t: "link", href: l.href, children: inlines(l.text) }); i = l.end; continue; }
    }
    if (c === "<") {
      const rest = s.slice(i);
      const auto = /^<(https?:\/\/[^>\s]+)>/i.exec(rest);
      if (auto) { flush(); out.push({ t: "link", href: auto[1], children: [{ t: "text", text: auto[1] }] }); i += auto[0].length; continue; }
      const br = /^<br\s*\/?>/i.exec(rest);
      if (br) { flush(); out.push({ t: "br" }); i += br[0].length; continue; }
      const tag = /^<\/?[a-z][^>]*>/i.exec(rest);
      if (tag) { i += tag[0].length; continue; } // other inline HTML: its text stays, the tag goes
    }
    if (c === "*" || c === "_") {
      const d = s[i + 1] === c ? c + c : c;
      const opens = !/\s/.test(s[i + d.length] ?? " ") && (c === "*" || !isWordChar(s[i - 1]));
      const end = opens ? closeOf(s, i + d.length, d) : -1;
      if (end > 0) {
        flush();
        out.push({ t: d.length === 2 ? "strong" : "em", children: inlines(s.slice(i + d.length, end)) });
        i = end + d.length;
        continue;
      }
      text += d; i += d.length; continue;
    }
    if (c === "h" && (i === 0 || /[\s(]/.test(s[i - 1]))) {
      const url = /^https?:\/\/[^\s<>]+/i.exec(s.slice(i));
      if (url) {
        const u = url[0].replace(/[.,;:!?)]+$/, "");
        flush(); out.push({ t: "link", href: u, children: [{ t: "text", text: u }] }); i += u.length; continue;
      }
    }
    text += c; i++;
  }
  flush();
  return out;
}

/** An inline run as plain text (a heading's words, a link's label). */
export function plainOf(xs: Inline[]): string {
  return xs.map((x) => (x.t === "text" || x.t === "code" ? x.text : x.t === "br" ? " " : plainOf(x.children))).join("");
}
