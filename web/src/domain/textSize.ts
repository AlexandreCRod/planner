// Text sizes in a note (the size menu: Normal, Title, Heading, Subheading, Small). Pure, so it's tested
// (test/textSize.test.ts); the editor (ui/shared/RichEditor.tsx) does the DOM side.

/**
 * A size picked with nothing selected holds the caret in an invisible mark (a zero-width space inside
 * the sized span), so the caret already has the size and what's typed next takes it, even on an
 * empty line (257). The mark goes as soon as there's text beside it, and is never saved.
 */
export const SIZE_MARK = "​";

/** The inline style for a size: a font size, bold for the big ones; none for Normal (null). */
export function sizeStyle(px: number | null): { fontSize?: string; fontWeight?: string } {
  if (!px) return {};
  return px > 16 ? { fontSize: `${px}px`, fontWeight: "bold" } : { fontSize: `${px}px` };
}

/**
 * Text [data] without its size marks once something else is typed beside them, and where a caret
 * [caret] characters into it ends up (null: no caret there). Unchanged when the text is only the mark
 * (the caret is still waiting in it) or has none.
 */
export function withoutMarks(data: string, caret: number | null): { data: string; caret: number | null } {
  if (!data.includes(SIZE_MARK) || data === SIZE_MARK.repeat(data.length)) return { data, caret };
  const out = data.split(SIZE_MARK).join("");
  if (caret === null) return { data: out, caret };
  const before = data.slice(0, caret).split(SIZE_MARK).length - 1;
  return { data: out, caret: caret - before };
}
