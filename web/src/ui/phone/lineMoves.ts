// Moving a note's checkbox lines (ChecklistHandles) keeps the cursor in the line it was in, and can be undone
// with the note's Undo (review of 2.10.3, findings 1 and 10).
//
// - The cursor: a line is moved by taking its paragraph out of the text and putting it back elsewhere. The
//   browser's cursor (and any saved copy of it) would fall out of the line as it goes, to the gap between two
//   lines at its old place, so the next letters typed went into a neighbour. The cursor is noted as (which moved
//   line, how many characters in) before the move and put back there after it.
// - Undo: the move is the app's, not the browser's (its edit history never sees it), so the note keeps its own
//   short list of moves. The note's Undo takes the last move back first, while nothing else has changed since;
//   once the text is typed in (or the lines change any other way), the moves are forgotten and Undo is the
//   browser's again, as before. Redo puts an undone move back, until the next edit or browser undo.
//
// The rules are written over a minimal node shape, so the tests can run them without a browser.

/** As much of a DOM node as the rules need. */
export interface NodeLike {
  readonly nodeType: number;
  readonly childNodes: ArrayLike<NodeLike>;
  readonly parentNode: NodeLike | null;
  readonly textContent: string | null;
}
const TEXT = 3;

/** A point in the text: (line index among the moved lines, characters into it). */
export interface Spot { line: number; at: number }

const textLen = (n: NodeLike) => (n.textContent ?? "").length;

/** The characters of [line] before the point ([node], [offset]) inside it. */
function charsBefore(line: NodeLike, node: NodeLike, offset: number): number {
  let n = 0, found = false;
  const walk = (x: NodeLike): void => {
    if (found) return;
    if (x === node) {
      if (x.nodeType === TEXT) n += offset;
      else for (let i = 0; i < Math.min(offset, x.childNodes.length); i++) n += textLen(x.childNodes[i]);
      found = true;
      return;
    }
    if (x.nodeType === TEXT) { n += textLen(x); return; }
    for (let i = 0; i < x.childNodes.length && !found; i++) walk(x.childNodes[i]);
  };
  walk(line);
  return n;
}

/** Where the point ([node], [offset]) is among [lines], or null when it isn't in any of them. */
export function spotIn(lines: readonly NodeLike[], node: NodeLike | null, offset: number): Spot | null {
  for (let x = node; x; x = x.parentNode) {
    const i = lines.indexOf(x);
    if (i >= 0) return { line: i, at: charsBefore(x, node!, offset) };
  }
  return null;
}

/** The point [at] characters into [line]: in its text (the end of a text node before the start of the next). */
export function pointIn(line: NodeLike, at: number): [NodeLike, number] {
  let left = at, last: NodeLike | null = null;
  const walk = (x: NodeLike): [NodeLike, number] | null => {
    if (x.nodeType === TEXT) {
      last = x;
      if (left <= textLen(x)) return [x, left];
      left -= textLen(x);
      return null;
    }
    for (let i = 0; i < x.childNodes.length; i++) { const r = walk(x.childNodes[i]); if (r) return r; }
    return null;
  };
  const r = walk(line);
  if (r) return r;
  const l = last as NodeLike | null;
  return l ? [l, textLen(l)] : [line, 0];
}

/** One move: the editor's lines in order before and after it, and the lines that moved. */
interface Move<N> { before: N[]; after: N[]; moved: N[] }

/** A box whose children are lines (the editor), as much of it as moving them needs. */
export interface BoxLike<N> { readonly childNodes: ArrayLike<N>; insertBefore(n: N, ref: N | null): unknown }

const same = <N>(a: ArrayLike<N>, b: readonly N[]) => a.length === b.length && b.every((x, i) => a[i] === x);

/** Puts [moved] (in order) where they are in [order], given the box is as [order] but for them. */
function place<N>(box: BoxLike<N>, order: readonly N[], moved: readonly N[]) {
  const last = order.indexOf(moved[moved.length - 1]);
  const ref = order[last + 1] ?? null;
  for (const n of moved) box.insertBefore(n, ref);
}

/** The moves of one editor that Undo can take back, and those it took back that Redo can put again. */
export class MoveHistory<N> {
  private undos: Move<N>[] = [];
  private redos: Move<N>[] = [];

  /** [moved] were just moved: the box's lines were [before], and now are [after]. */
  record(before: N[], after: N[], moved: N[]) {
    if (same(after, before)) return;
    this.undos.push({ before, after, moved });
    if (this.undos.length > 30) this.undos.shift();
    this.redos = [];
  }
  /** Whether Undo would take a move back: there's one, and the lines are still as it left them. */
  canUndo(box: BoxLike<N>): boolean { const m = this.undos.at(-1); return !!m && same(box.childNodes, m.after); }
  canRedo(box: BoxLike<N>): boolean { const m = this.redos.at(-1); return !!m && same(box.childNodes, m.before); }
  /** Takes the last move back; false (and the moves forgotten) when there's none, or the lines changed since. */
  undo(box: BoxLike<N>): boolean {
    if (!this.canUndo(box)) { this.undos = []; return false; }
    const m = this.undos.pop()!;
    place(box, m.before, m.moved);
    this.redos.push(m);
    return true;
  }
  redo(box: BoxLike<N>): boolean {
    if (!this.canRedo(box)) { this.redos = []; return false; }
    const m = this.redos.pop()!;
    place(box, m.after, m.moved);
    this.undos.push(m);
    return true;
  }
  /** The text was edited another way (typed in): the moves can't be taken back in the right order any more. */
  forget() { this.undos = []; this.redos = []; }
  /** The browser's own Undo ran: what it took back comes after the moves, so a move's Redo would come too early. */
  browserUndid() { this.redos = []; }
}

// ---- In the page ----

const histories = new WeakMap<HTMLElement, MoveHistory<ChildNode>>();
const listeners = new Set<() => void>();
const told = () => listeners.forEach((l) => l());
const historyOf = (root: HTMLElement) => {
  let h = histories.get(root);
  if (!h) { h = new MoveHistory<ChildNode>(); histories.set(root, h); }
  return h;
};

/** Told whenever what Undo or Redo would do for a line move may have changed. */
export function onLineMoves(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

/**
 * Runs [move], which moves [lines] within the editor, keeping the selection in those lines where it was in
 * their text (findings 1). The other end of a selection, outside them, is kept as it is.
 */
export function keepingCaret(lines: readonly HTMLElement[], move: () => void) {
  const sel = getSelection();
  const a = sel && sel.rangeCount ? spotIn(lines, sel.anchorNode, sel.anchorOffset) : null;
  const f = sel && sel.rangeCount ? spotIn(lines, sel.focusNode, sel.focusOffset) : null;
  const outside = sel && sel.rangeCount ? { a: [sel.anchorNode!, sel.anchorOffset] as const, f: [sel.focusNode!, sel.focusOffset] as const } : null;
  move();
  if (!sel || !outside || (!a && !f)) return;
  const [an, ao] = a ? pointIn(lines[a.line], a.at) as [Node, number] : outside.a;
  const [fn, fo] = f ? pointIn(lines[f.line], f.at) as [Node, number] : outside.f;
  try { sel.setBaseAndExtent(an, ao, fn, fo); } catch { /* a point gone from the page: leave it */ }
}

/** Moves [lines] (in order) before [ref] in [root] (null: to the end), keeping the cursor in them; Undo can take it back. */
export function moveLines(root: HTMLElement, lines: HTMLElement[], ref: ChildNode | null) {
  const before = [...root.childNodes];
  keepingCaret(lines, () => { for (const l of lines) root.insertBefore(l, ref); });
  historyOf(root).record(before, [...root.childNodes], lines);
  told();
}

const linesIn = (root: HTMLElement, moved: () => boolean) => {
  // The lines that will move are found from the history itself, so the cursor follows them: all the
  // editor's lines are watched for it (only the moved ones change place).
  const all = [...root.children] as HTMLElement[];
  let ok = false;
  keepingCaret(all, () => { ok = moved(); });
  told();
  return ok;
};

export const canUndoLineMove = (root: HTMLElement | null) => !!root && !!histories.get(root)?.canUndo(root);
export const canRedoLineMove = (root: HTMLElement | null) => !!root && !!histories.get(root)?.canRedo(root);
/** The note's Undo: takes the last line move back (true), or does nothing (false: the browser's Undo then). */
export function undoLineMove(root: HTMLElement): boolean { const h = histories.get(root); return !!h && linesIn(root, () => h.undo(root)); }
export function redoLineMove(root: HTMLElement): boolean { const h = histories.get(root); return !!h && linesIn(root, () => h.redo(root)); }
export function forgetLineMoves(root: HTMLElement) { const h = histories.get(root); if (h) { h.forget(); told(); } }
export function browserUndid(root: HTMLElement) { const h = histories.get(root); if (h) { h.browserUndid(); told(); } }
