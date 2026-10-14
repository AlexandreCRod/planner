// HTML ↔ plain text helpers shared by previews, search and [[wiki links]].

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

const WIKI = /\[\[([^\[\]|]+)(?:\|[^\]]*)?]]/g;

/** Titles referenced as [[Title]] in a note. */
export function wikiTitles(html: string): string[] {
  const out = new Set<string>();
  for (const m of stripHtml(html).matchAll(WIKI)) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out];
}

export function preview(html: string, max = 120): string {
  return stripHtml(html).replace(/\s+/g, " ").trim().slice(0, max);
}
