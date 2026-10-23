// Finding words in a note's text (the note's find bar, and a note opened from Search). Matching ignores
// case and accents ("cafe" finds "Café"), the same as typing in Search; the text keeps its own length,
// so a match's place is its place in the text.

/** One character folded for matching: lower case, accents off. Always one character long. */
function fold(c: string): string {
  const f = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return f.length === 1 ? f : c.toLowerCase().length === 1 ? c.toLowerCase() : c;
}
const foldAll = (s: string) => [...s].map(fold).join("");

/** Where [query] is in [text]: [start, end) pairs (in UTF-16 units of [text]), in order, never overlapping. */
export function findMatches(text: string, query: string): [number, number][] {
  const q = foldAll(query.trim());
  if (!q) return [];
  // Fold per UTF-16 unit, so places line up with the text's own.
  let t = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    t += code >= 0xd800 && code <= 0xdfff ? text[i] : fold(text[i]);
  }
  const out: [number, number][] = [];
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) out.push([i, i + q.length]);
  return out;
}

/** The match to go to from [current] by [step] (+1 next, -1 previous), going round; -1 when there are none. */
export function stepMatch(count: number, current: number, step: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return step > 0 ? 0 : count - 1;
  return (current + step + count) % count;
}
