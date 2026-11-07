import assert from "node:assert/strict";
import { test } from "node:test";
import { MoveHistory, type NodeLike, pointIn, spotIn } from "../src/ui/phone/lineMoves.ts";

// Review of 2.10.3, findings 1 and 10: moving a note's checkbox line keeps the cursor in that line, and the note's
// Undo takes the move back. A small stand-in for the page's nodes (no browser here): text nodes and elements.
class N implements NodeLike {
  parentNode: N | null = null;
  childNodes: N[] = [];
  readonly nodeType: number;
  private data: string;
  constructor(nodeType: number, data = "") { this.nodeType = nodeType; this.data = data; }
  get textContent(): string { return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join(""); }
  insertBefore(n: N, ref: N | null) {
    if (n.parentNode) { const p = n.parentNode; p.childNodes.splice(p.childNodes.indexOf(n), 1); }
    const at = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, n);
    n.parentNode = this;
    return n;
  }
}
const text = (s: string) => new N(3, s);
const el = (...kids: N[]) => { const e = new N(1); for (const k of kids) e.insertBefore(k, null); return e; };
const names = (box: N) => box.childNodes.map((c) => c.textContent);

test("the cursor at the end of the moved line is found in it and put back at the end of the same line", () => {
  const milkText = text("☐ Milk");
  const lemons = el(text("☐ Lemons")), milk = el(milkText), spinach = el(text("☐ Spinach"));
  const box = el(lemons, spinach, milk);
  const spot = spotIn([milk], milkText, 6);
  assert.deepEqual(spot, { line: 0, at: 6 });
  box.insertBefore(milk, lemons); // dragged to the top
  assert.deepEqual(names(box), ["☐ Milk", "☐ Lemons", "☐ Spinach"]);
  const [node, offset] = pointIn([milk][spot!.line], spot!.at);
  assert.equal(node, milkText); // still in "Milk", not between two lines at its old place
  assert.equal(offset, 6);
});

test("a cursor inside styled text, or given as a place between a line's parts, keeps its place in the text", () => {
  const bold = text("lk");
  const line = el(text("☐ Mi"), el(bold), text(" 2"));
  assert.deepEqual(spotIn([line], bold, 1), { line: 0, at: 5 });
  assert.deepEqual(pointIn(line, 5), [bold, 1]);
  assert.deepEqual(spotIn([line], line, 2), { line: 0, at: 6 }); // after the first two parts
  // A line moved with the one under it: the second one's spot names it.
  const sub = text("⠀☐ Oat milk"), under = el(sub);
  assert.deepEqual(spotIn([line, under], sub, 3), { line: 1, at: 3 });
});

test("a cursor outside the moved lines isn't theirs; an empty line takes the cursor at its start", () => {
  const other = text("☐ Bread");
  el(other);
  assert.equal(spotIn([el(text("☐ Milk"))], other, 2), null);
  const empty = el(el());
  assert.deepEqual(pointIn(empty, 0), [empty, 0]);
  const past = text("abc");
  assert.deepEqual(pointIn(el(past), 9), [past, 3]); // never past the line's end
});

// Lines a, b, c, d; c is dragged to the top.
const four = () => { const [a, b, c, d] = ["a", "b", "c", "d"].map((x) => el(text(x))); return { a, b, c, d, box: el(a, b, c, d) }; };
const dragCToTop = (h: MoveHistory<N>, { a, c, box }: ReturnType<typeof four>) => {
  const before = [...box.childNodes];
  box.insertBefore(c, a);
  h.record(before, [...box.childNodes], [c]);
};

test("Undo takes the last line move back, and Redo puts it again", () => {
  const f = four(), h = new MoveHistory<N>();
  dragCToTop(h, f);
  assert.deepEqual(names(f.box), ["c", "a", "b", "d"]);
  assert.equal(h.undo(f.box), true);
  assert.deepEqual(names(f.box), ["a", "b", "c", "d"]);
  assert.equal(h.undo(f.box), false); // nothing more of its own: the browser's Undo then
  assert.equal(h.redo(f.box), true);
  assert.deepEqual(names(f.box), ["c", "a", "b", "d"]);
});

test("two moves are taken back last first; a block of lines goes back whole", () => {
  const f = four(), h = new MoveHistory<N>();
  dragCToTop(h, f); // c a b d
  const before = [...f.box.childNodes];
  f.box.insertBefore(f.a, null); f.box.insertBefore(f.b, null); // a and b (an item with its sub-item) to the end
  h.record(before, [...f.box.childNodes], [f.a, f.b]);
  assert.deepEqual(names(f.box), ["c", "d", "a", "b"]);
  h.undo(f.box);
  assert.deepEqual(names(f.box), ["c", "a", "b", "d"]);
  h.undo(f.box);
  assert.deepEqual(names(f.box), ["a", "b", "c", "d"]);
});

test("once the lines change another way, Undo leaves them alone (the browser's Undo then)", () => {
  const f = four(), h = new MoveHistory<N>();
  dragCToTop(h, f);
  f.box.insertBefore(el(text("new line")), null); // Enter typed at the end
  assert.equal(h.canUndo(f.box), false);
  assert.equal(h.undo(f.box), false);
  assert.deepEqual(names(f.box), ["c", "a", "b", "d", "new line"]);
});

test("typing forgets the moves; the browser's own Undo drops a move's Redo (it would come in the wrong order)", () => {
  const f = four(), h = new MoveHistory<N>();
  dragCToTop(h, f);
  h.forget();
  assert.equal(h.canUndo(f.box), false);
  const g = four();
  dragCToTop(h, g);
  h.undo(g.box);
  assert.equal(h.canRedo(g.box), true);
  h.browserUndid();
  assert.equal(h.canRedo(g.box), false);
});

test("a hold that doesn't move the line leaves nothing to undo", () => {
  const f = four(), h = new MoveHistory<N>();
  h.record([...f.box.childNodes], [...f.box.childNodes], [f.c]);
  assert.equal(h.canUndo(f.box), false);
});
