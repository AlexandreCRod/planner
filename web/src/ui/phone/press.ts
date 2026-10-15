// Material press feedback for the phone: a ripple that starts under the finger the moment it lands
// (like Compose's clickable), on anything tappable. One listener for the whole document, so no
// component has to opt in, and nothing re-renders: the ripple is a plain element added and removed here.
//
// Timing: outside a scrolling list the ripple shows on touch-down; inside one it waits a moment (50 ms,
// half of Compose's tap timeout: about the least that keeps a scroll from flashing the row it starts on),
// and a tap released before that still shows it at once. A finger moving past the touch slop, or the browser taking the touch for
// scrolling, cancels it.

/** What gets a ripple. Bottom-bar tabs don't (the native bar has none); text fields and checkboxes neither. */
const PRESSABLE = "button, a[href], [role=button], label.p-dayswitch, label.p-check-row, .task, .event, .note-preview, .note-card, .pick";
const SKIP = "input, textarea, select, [contenteditable=true], .p-bar, .pg";
/** Android's touch slop (8 dp), and the wait before a ripple inside a scrolling list. */
export const TOUCH_SLOP = 8;
const TAP_TIMEOUT = 50;
/** How long a ripple stays fully shown at least, then how long it fades. */
const MIN_SHOWN = 120;
const FADE = 150;

interface Press { host: HTMLElement; ripple: HTMLElement | null; x0: number; y0: number; id: number; shownAt: number; timer: number; }
let press: Press | null = null;

function scrollsVertically(el: HTMLElement): boolean {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return true;
  }
  return false;
}

function show(p: Press, x: number, y: number) {
  if (p.ripple) return;
  const host = p.host;
  if (getComputedStyle(host).position === "static") host.setAttribute("data-ripple-host", "");
  const r = host.getBoundingClientRect();
  const lx = x - r.left, ly = y - r.top;
  // Big enough to cover the farthest corner from the touch point.
  const d = 2 * Math.hypot(Math.max(lx, r.width - lx), Math.max(ly, r.height - ly));
  const el = document.createElement("span");
  el.className = "p-ripple";
  el.style.setProperty("--x", `${lx}px`);
  el.style.setProperty("--y", `${ly}px`);
  el.style.setProperty("--d", `${d}px`);
  host.appendChild(el);
  p.ripple = el;
  p.shownAt = performance.now();
}

function release(p: Press) {
  clearTimeout(p.timer);
  const el = p.ripple;
  if (!el) return;
  const wait = Math.max(0, MIN_SHOWN - (performance.now() - p.shownAt));
  window.setTimeout(() => {
    el.classList.add("out");
    window.setTimeout(() => el.remove(), FADE + 30);
  }, wait);
}

function cancel(p: Press) {
  clearTimeout(p.timer);
  p.ripple?.remove();
  p.ripple = null;
}

let started = false;
export function startPressFeedback() {
  if (started) return;
  started = true;
  document.addEventListener("pointerdown", (e) => {
    if (press) { release(press); press = null; }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Only in the phone layout (a browser window can be resized back to the PC one).
    if (!document.documentElement.classList.contains("phone")) return;
    const t = e.target as Element | null;
    if (!t) return;
    const host = t.closest<HTMLElement>(PRESSABLE);
    // A transparent picker input stretched over a label (the day switcher, a time chip) is the label's tap.
    const overlayInput = t instanceof HTMLInputElement && t.type !== "checkbox" && !!host?.matches("label, .pick");
    if (t.closest(SKIP) && !overlayInput) return;
    if (!host || (host as HTMLButtonElement).disabled) return;
    const p: Press = { host, ripple: null, x0: e.clientX, y0: e.clientY, id: e.pointerId, shownAt: 0, timer: 0 };
    press = p;
    if (e.pointerType !== "touch" || !scrollsVertically(host)) show(p, e.clientX, e.clientY);
    else p.timer = window.setTimeout(() => { if (press === p) show(p, p.x0, p.y0); }, TAP_TIMEOUT);
  }, { capture: true, passive: true });
  document.addEventListener("pointermove", (e) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    if (Math.abs(e.clientX - p.x0) > TOUCH_SLOP || Math.abs(e.clientY - p.y0) > TOUCH_SLOP) { cancel(p); press = null; }
  }, { capture: true, passive: true });
  document.addEventListener("pointerup", (e) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    show(p, p.x0, p.y0);
    release(p);
  }, { capture: true, passive: true });
  document.addEventListener("pointercancel", (e) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    cancel(p);
  }, { capture: true, passive: true });
}
