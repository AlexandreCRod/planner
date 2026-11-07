import assert from "node:assert/strict";
import { test } from "node:test";

// Review of 2.10.4, finding 1: a toggle touched in the back gesture's edge strip waits, then its click is sent
// again. When the finger was on the toggle's icon (an <svg>, which has no click()), the toggle never flipped.
// Here the guard runs as in the app, on a small stand-in page: a window that gets the touch and click events,
// and a switch button holding an icon.

class Window extends EventTarget { setTimeout = (fn: () => void, ms: number) => setTimeout(fn, ms); }
const win = new Window();
Object.assign(globalThis, { window: win, innerWidth: 411, document: { body: {} } });
(globalThis as { MouseEvent?: unknown }).MouseEvent ??= class extends Event {};

/** A stand-in element: a bubbling click reaches its parents' handlers, like the page's own. */
class El {
  parentElement: El | null = null;
  isConnected = true;
  onclick: (() => void) | null = null;
  toggle: boolean;
  constructor(toggle: boolean) { this.toggle = toggle; }
  matches() { return this.toggle; }
  getBoundingClientRect() { return { height: 24 }; }
  querySelectorAll() { return []; }
  dispatchEvent(e: Event) {
    for (let el: El | null = this; el; el = e.bubbles ? el.parentElement : null) el.onclick?.();
    return true;
  }
}

/** A switch with an icon in it; the icon, like an <svg>, has no click() of its own. */
function page() {
  const sw = new El(true);
  const icon = new El(false);
  icon.parentElement = sw;
  let on = false;
  sw.onclick = () => { on = !on; };
  return { icon, isOn: () => on };
}

const at = (e: Event, props: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
  return e;
};
/** A finger down and up at [x] on [target], then the browser's click: true when that click went through at once. */
function tap(x: number, target: El): boolean {
  const touch = { pointerType: "touch", isPrimary: true, clientX: x, clientY: 600 };
  const clock = performance.now(); // the back press is timed on the same clock
  win.dispatchEvent(at(new Event("pointerdown"), { ...touch, timeStamp: clock }));
  win.dispatchEvent(at(new Event("pointerup"), { ...touch, timeStamp: clock + 80 }));
  const click = at(new Event("click", { cancelable: true }), { target, timeStamp: clock + 85 });
  win.dispatchEvent(click);
  return !click.defaultPrevented;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { startTapGuard, noteBack, EDGE_WAIT } = await import("../src/ui/phone/tapGuard.ts");
startTapGuard();

test("a tap on a switch's icon in the edge strip flips the switch a moment later", async () => {
  const p = page();
  assert.equal(tap(405, p.icon), false, "the click is held back for the back gesture");
  assert.equal(p.isOn(), false);
  await wait(EDGE_WAIT + 60);
  assert.equal(p.isOn(), true);
});

test("the same tap with a back press during the wait doesn't flip it", async () => {
  const p = page();
  tap(405, p.icon);
  noteBack();
  await wait(EDGE_WAIT + 60);
  assert.equal(p.isOn(), false);
});

test("a tap on the icon away from the edge goes through at once", () => {
  const p = page();
  assert.equal(tap(200, p.icon), true);
});
