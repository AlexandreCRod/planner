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
