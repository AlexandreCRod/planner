// Checklist lines in a note's text, as the Android editor writes them: a paragraph starting with
// "☐ " or "☑ ", indented by Braille blanks (U+2800). Reordering by dragging (the phone's note editor)
// moves a line together with the lines indented under it, within its run of checklist lines. Pure,
// on the lines' texts, so it's tested (test/checklist.test.ts) and the editor only moves paragraphs.

/** How deep a checklist line is (its Braille blanks), or -1 when it isn't one. */
export function checklistDepth(text: string): number {
  let i = 0;
  while (text[i] === "⠀") i++;
  return text[i] === "☐" || text[i] === "☑" ? i : -1;
}

/** The run of adjoining checklist lines around line [i]: [first, last] (inclusive), or null. */
export function checklistRun(texts: string[], i: number): [number, number] | null {
  if (checklistDepth(texts[i] ?? "") < 0) return null;
  let a = i, b = i;
  while (a > 0 && checklistDepth(texts[a - 1]) >= 0) a--;
  while (b < texts.length - 1 && checklistDepth(texts[b + 1]) >= 0) b++;
  return [a, b];
}

/** Line [i] and the lines indented under it: [first, last]. */
export function checklistBlock(texts: string[], i: number): [number, number] {
  const d = checklistDepth(texts[i]);
  let b = i;
  while (b < texts.length - 1 && checklistDepth(texts[b + 1]) > d) b++;
  return [i, b];
}

/**
 * Where the block starting at line [from] can go, as the indexes of the lines it may land before
 * (in the list without the block): the starts of the other blocks at its depth or shallower in its
 * run, and the run's end.
 */
export function checklistSlots(texts: string[], from: number): number[] {
  const run = checklistRun(texts, from);
  if (!run) return [];
  const [s, e] = checklistBlock(texts, from);
  const n = e - s + 1;
  const d = checklistDepth(texts[from]);
  const out: number[] = [];
  for (let i = run[0]; i <= run[1] + 1; i++) {
    if (i > s && i <= e) continue;
    const startsBlock = i > run[1] || checklistDepth(texts[i]) <= d;
    if (startsBlock) out.push(i > e ? i - n : i);
  }
  return [...new Set(out)];
}

/** The lines with the block at [from] moved to land before line [to] of the list without it. */
export function moveChecklistBlock<T>(lines: T[], texts: string[], from: number, to: number): T[] {
  const [s, e] = checklistBlock(texts, from);
  const block = lines.slice(s, e + 1);
  const rest = [...lines.slice(0, s), ...lines.slice(e + 1)];
  return [...rest.slice(0, to), ...block, ...rest.slice(to)];
}
