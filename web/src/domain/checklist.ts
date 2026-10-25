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

/** How long a checklist line's lead is (its indent, the box and the space after it), or -1 when it isn't one. */
export function checklistLead(text: string): number {
  const d = checklistDepth(text);
  if (d < 0) return -1;
  const i = d + 1;
  return text[i] === " " || text[i] === " " ? i + 1 : i;
}

/**
 * Backspace with the caret [caret] characters into line [text]: true when it takes the line's box away
 * (with its indent), leaving the text as a plain line. The next Backspace then joins it to the line above.
 */
export function backspaceTakesBox(text: string, caret: number): boolean {
  const lead = checklistLead(text);
  return lead >= 0 && caret <= lead;
}

/**
 * Enter with the caret [caret] characters into checklist line [text]: where the line splits, the text
 * from there going onto the new (unticked) box below. Never inside the lead (a caret before the box
 * splits after it), and past the blanks right after the caret (they stay behind, out of sight, so the
 * moved text starts right after its box). Null when nothing follows the caret but blanks: the new box
 * starts empty.
 */
export function enterSplitsAt(text: string, caret: number): number | null {
  const lead = checklistLead(text);
  if (lead < 0) return null;
  let at = Math.max(caret, lead);
  while (at < text.length && /\s/.test(text[at])) at++;
  return at < text.length ? at : null;
}
