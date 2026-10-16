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

// ---------- Long-press labels ----------
// Holding an icon-only button shows its name (its aria-label) in a small tooltip by it, as Android does,
// for a second and a half; the button itself then does nothing. One handler for the whole phone layout.

const LONG_PRESS = 450;
const TIP_SHOWN = 1500;
interface Hold { host: HTMLElement; x0: number; y0: number; id: number; timer: number }
let hold: Hold | null = null;
let tip: HTMLElement | null = null;
let tipTimer = 0;

/** A button showing only an icon, with a name to show. */
function iconButton(t: Element): HTMLElement | null {
  const b = t.closest<HTMLElement>("button, [role=button]");
  if (!b || (b as HTMLButtonElement).disabled || b.closest(".p-bar")) return null;
  const label = b.getAttribute("aria-label")?.trim();
  return label && !(b.textContent ?? "").trim() ? b : null;
}

function showTip(host: HTMLElement) {
  hideTip();
  const el = document.createElement("div");
  el.className = "p-tooltip";
  el.setAttribute("role", "tooltip");
  el.textContent = host.getAttribute("aria-label") ?? "";
  document.body.appendChild(el);
  const r = host.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sat")) || 0;
  let top = r.top - h - 8;
  if (top < sat + 8) top = r.bottom + 8;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  tip = el;
  tipTimer = window.setTimeout(hideTip, TIP_SHOWN);
}

function hideTip() {
  clearTimeout(tipTimer);
  const el = tip;
  tip = null;
  if (!el) return;
  el.classList.add("out");
  window.setTimeout(() => el.remove(), 200);
}

/** The click a long press ends in is dropped, so the button doesn't also act. */
function swallowClick() {
  const stop = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); };
  window.addEventListener("click", stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 800);
}

function startHold(e: PointerEvent, t: Element) {
  if (hold) { clearTimeout(hold.timer); hold = null; }
  const host = iconButton(t);
  if (!host) return;
  const h: Hold = { host, x0: e.clientX, y0: e.clientY, id: e.pointerId, timer: 0 };
  h.timer = window.setTimeout(() => {
    if (hold !== h) return;
    hold = null;
    if (press) { cancel(press); press = null; }
    swallowClick();
    showTip(host);
  }, LONG_PRESS);
  hold = h;
}

function endHold(e: PointerEvent, moved: boolean) {
  const h = hold;
  if (!h || e.pointerId !== h.id) return;
  if (moved && Math.abs(e.clientX - h.x0) <= TOUCH_SLOP && Math.abs(e.clientY - h.y0) <= TOUCH_SLOP) return;
  clearTimeout(h.timer);
  hold = null;
}

let started = false;
export function startPressFeedback() {
  if (started) return;
  started = true;
  document.addEventListener("pointermove", (e) => endHold(e, true), { capture: true, passive: true });
  document.addEventListener("pointerup", (e) => endHold(e, false), { capture: true, passive: true });
  document.addEventListener("pointercancel", (e) => endHold(e, false), { capture: true, passive: true });
  // No long-press menu (or text selection) on an icon button: its label shows instead.
  document.addEventListener("contextmenu", (e) => {
    if (document.documentElement.classList.contains("phone") && e.target instanceof Element && iconButton(e.target)) e.preventDefault();
  }, { capture: true });
  document.addEventListener("pointerdown", (e) => {
    if (tip) hideTip();
    if (document.documentElement.classList.contains("phone") && e.target instanceof Element && (e.pointerType !== "mouse" || e.button === 0)) startHold(e, e.target);
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
