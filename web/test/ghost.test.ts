import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { GHOST_FALLBACK_MS, leaveGhost } from "../src/ui/phone/ghost.ts";

// Review of 2.10.2, finding 7: the still copy of the page being left went on a fixed 260 ms from the commit, so on
// a slow first frame the tab page showed through the new page's slide-in. It now waits for that slide-in's end.
type Listener = (e: { target: unknown }) => void;
class El {
  classList: Set<string> & { contains: (c: string) => boolean };
  children: El[] = [];
  parentElement: El | null = null;
  scrollTop = 0; scrollLeft = 0; inert = false;
  listeners = new Map<string, Set<Listener>>();
  constructor(...cls: string[]) {
    const s = new Set(cls) as Set<string> & { contains: (c: string) => boolean };
    s.contains = (c) => s.has(c);
    this.classList = s;
  }
  get isConnected(): boolean { return this.parentElement !== null; }
  appendChild(c: El) { c.parentElement = this; this.children.push(c); return c; }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null; } }
  cloneNode() { return new El(...this.classList); }
  setAttribute() {}
  querySelectorAll() { return [] as El[]; }
  addEventListener(t: string, f: Listener) { if (!this.listeners.has(t)) this.listeners.set(t, new Set()); this.listeners.get(t)!.add(f); }
  removeEventListener(t: string, f: Listener) { this.listeners.get(t)?.delete(f); }
  fire(t: string, target: unknown = this) { [...(this.listeners.get(t) ?? [])].forEach((f) => f({ target })); }
}
const ghosts = (root: El) => root.children.filter((c) => c.classList.contains("p-ghost"));
const tick = () => new Promise<void>((r) => queueMicrotask(r));

/** Settings open, then a folder replaces it: the old page leaves a copy, the new one is put in. */
function replace(root: El, old: El) {
  leaveGhost(old as unknown as HTMLElement);
  old.remove();
  return root.appendChild(new El("p-overlay"));
}

test("the copy stays past 300 ms until the new page's slide-in ends, then goes", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const root = new El(), settings = root.appendChild(new El("p-overlay"));
    const next = replace(root, settings);
    await tick();
    mock.timers.tick(300);
    assert.equal(ghosts(root).length, 1, "gone before the slide-in ended");
    next.fire("animationend", new El());   // a child's own animation doesn't count
    assert.equal(ghosts(root).length, 1);
    next.fire("animationend");
    assert.equal(ghosts(root).length, 0);
  } finally { mock.timers.reset(); }
});

test("with no animationend at all, the safety timeout takes it down", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const root = new El(), settings = root.appendChild(new El("p-overlay"));
    replace(root, settings);
    await tick();
    mock.timers.tick(GHOST_FALLBACK_MS - 1);
    assert.equal(ghosts(root).length, 1);
    mock.timers.tick(1);
    assert.equal(ghosts(root).length, 0);
  } finally { mock.timers.reset(); }
});

test("closing to a tab removes the copy at once, and any older copy still waiting", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const root = new El(), settings = root.appendChild(new El("p-overlay"));
    const folder = replace(root, settings);   // Settings → a folder: one copy waiting
    await tick();
    leaveGhost(folder as unknown as HTMLElement);   // then straight back to a tab
    folder.remove();
    await tick();
    assert.equal(ghosts(root).length, 0);
  } finally { mock.timers.reset(); }
});

test("still in the page (React's dev double mount): the copy goes at once", async () => {
  const root = new El(), page = root.appendChild(new El("p-overlay"));
  leaveGhost(page as unknown as HTMLElement);
  await tick();
  assert.equal(ghosts(root).length, 0);
});
