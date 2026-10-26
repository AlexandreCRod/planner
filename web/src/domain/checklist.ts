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

/** Copied text without its checklist boxes: "☐ Milk" → "Milk"; an indented line keeps its indent, as spaces. */
export function withoutBoxes(text: string): string {
  return text.split("\n").map((l) => {
    const d = checklistDepth(l);
    return d < 0 ? l : " ".repeat(d) + l.slice(checklistLead(l));
  }).join("\n");
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

/** Whether checklist line [text] is ticked (false for an open box and for a line that isn't one). */
export function checklistTicked(text: string): boolean {
  const d = checklistDepth(text);
  return d >= 0 && text[d] === "☑";
}

/**
 * The top-level items of the run [run] (a line and the lines indented under it), in order. Lines
 * before the first top-level one (a run that starts indented) are items of their own, never ticked.
 */
function runItems(texts: string[], run: [number, number]): { s: number; e: number; done: boolean }[] {
  let base = Infinity;
  for (let i = run[0]; i <= run[1]; i++) base = Math.min(base, checklistDepth(texts[i]));
  const out: { s: number; e: number; done: boolean }[] = [];
  for (let i = run[0]; i <= run[1]; i++) {
    const top = checklistDepth(texts[i]) === base;
    const prev = out[out.length - 1];
    if (top || !prev) out.push({ s: i, e: i, done: top && checklistTicked(texts[i]) });
    else prev.e = i;
  }
  return out;
}

/** The items at the end of the run that are all ticked: where the "Completed" section starts. */
function doneTail(items: { s: number; e: number; done: boolean }[]): number {
  let k = items.length;
  while (k > 0 && items[k - 1].done) k--;
  return k;
}

/**
 * The "N completed" sections to show: for each checklist (run of checklist lines) the ticked items at
 * its very end, as the lines [first, last] and how many items there are. Ticked items elsewhere in a
 * list (an older note, or sub-items under an open line) stay among the lines.
 */
export function completedSections(texts: string[]): { first: number; last: number; count: number }[] {
  const out: { first: number; last: number; count: number }[] = [];
  for (let i = 0; i < texts.length; i++) {
    const run = checklistRun(texts, i);
    if (!run) continue;
    i = run[1];
    const items = runItems(texts, run);
    const k = doneTail(items);
    if (k < items.length) out.push({ first: items[k].s, last: run[1], count: items.length - k });
  }
  return out;
}

/** An item's words, without its indent and box: how a line remembers its neighbour. */
const labelOf = (text: string) => text.slice(Math.max(0, checklistLead(text))).trim();

/**
 * What item [i], just ticked, remembers so that unticking puts it back: the words of the open item
 * above it ("" when it was the first open one). Null when line [i] isn't an item of a checklist.
 */
export function tickAnchor(texts: string[], i: number): string | null {
  const run = checklistRun(texts, i);
  if (!run) return null;
  const items = runItems(texts, run);
  const at = items.findIndex((it) => it.s === i);
  if (at < 0) return null;
  for (let k = at - 1; k >= 0; k--) if (!items[k].done) return labelOf(texts[items[k].s]);
  return "";
}

/**
 * Where among [items] (before the completed ones, which start at [k]) an unticked item goes back to:
 * just after the open item it remembered ([anchor]); if that one was ticked too, where it would go
 * back to; at the top for "". Null when its neighbour is gone (deleted or reworded).
 */
function placeBack(texts: string[], items: { s: number }[], k: number, anchor: string | null, anchorOf: (line: number) => string | null): number | null {
  const seen = new Set<string>();
  for (let a = anchor; a !== null && !seen.has(a);) {
    if (a === "") return 0;
    seen.add(a);
    const label = a;
    const open = items.findIndex((it, n) => n < k && labelOf(texts[it.s]) === label);
    if (open >= 0) return open + 1;
    const done = items.findIndex((it, n) => n >= k && labelOf(texts[it.s]) === label);
    if (done < 0) return null;
    a = anchorOf(items[done].s);
  }
  return null;
}

/**
 * Where the lines go after line [i] was just ticked or unticked (texts already show the new box), as
 * the order of the old line indexes, or null when nothing moves. A ticked item (with its sub-items)
 * goes to the end of its checklist; an unticked one, if it was in the completed section, goes back to
 * where it was (see tickAnchor; [anchorOf] gives a line's remembered neighbour), else to the end of
 * the open items, just above the completed ones. Sub-items never move on their own: they follow their parent.
 */
export function tickMoveOrder(texts: string[], i: number, anchorOf: (line: number) => string | null = () => null): number[] | null {
  const run = checklistRun(texts, i);
  if (!run) return null;
  const items = runItems(texts, run);
  const at = items.findIndex((it) => it.s === i);
  if (at < 0) return null; // a sub-item
  const { s, e, done } = items[at];
  const all = texts.map((_, k) => k);
  const block = all.slice(s, e + 1);
  const rest = [...all.slice(0, s), ...all.slice(e + 1)];
  let to: number; // where the block lands in [rest]
  if (done) {
    if (e === run[1]) return null;
    to = run[1] + 1 - block.length;
  } else {
    // It was ticked before: in the tail if the items after it were all ticked too.
    const wasTail = doneTail(items.map((it, k) => (k === at ? { ...it, done: true } : it))) <= at;
    if (!wasTail) return null;
    const without = items.filter((_, k) => k !== at);
    const k = doneTail(without);
    const back = placeBack(texts, without, k, anchorOf(s), anchorOf);
    const place = back === null ? k : Math.min(back, k);
    if (place === at) return null; // already there
    to = place < without.length ? without[place].s - (without[place].s > s ? block.length : 0) : run[1] + 1 - block.length;
  }
  return [...rest.slice(0, to), ...block, ...rest.slice(to)];
}
