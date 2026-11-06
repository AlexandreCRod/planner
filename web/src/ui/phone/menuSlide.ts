// Press-and-drag menus (361), for every DropdownMenu (chrome.tsx), the app's one menu.
//
// - A tap on a button with a menu opens it as before (its own onClick).
// - Holding that button (one hold time, LONG_PRESS, the finger kept within the touch slop) opens the menu at
//   once, with the pick-up pulse; the button marks itself with aria-haspopup="menu" (IconButton's [menu] and
//   the like), and nothing else is needed. Something with a hold of its own that opens a menu (useHold) must not
//   carry the mark: the hold would click it as well.
// - Whenever a menu opens while a finger (or the mouse button) is still down, as after any hold that opens
//   one (that button, a city, a picture, the to-dos button), that finger can slide over the options: the one
//   under it is lit, with a tick, and lifting on it picks it. Lifting anywhere else, or without having moved,
//   leaves the menu open to tap, as a tapped menu is.
// - A lift picks only on purpose (review C3): after resting on the option a moment, or coming onto it slowly.
// - In a page that scrolls (Settings, an item's page), the menu doesn't hold the page still: a finger that goes
//   on to scroll scrolls, picks nothing, and the menu closes.
// - A menu too long for the screen scrolls (its options, inside it), and while a finger slides through it, it
//   scrolls by itself near its top and bottom edges.
import { feel } from "./haptics.ts";
import { LONG_PRESS, TOUCH_SLOP } from "./press.ts";
import { SlideSession, dropsClick, menuEdgeSpeed } from "./slideSession.ts";
import { suspendOverscroll } from "./overscroll.ts";
import { claimSwipe } from "./gesture.ts";

/** The finger (or mouse button) down now, where it is. */
let down: { id: number; x: number; y: number } | null = null;
/** A hold on a menu button, waiting for LONG_PRESS. */
let hold: { id: number; x0: number; y0: number; timer: number } | null = null;
/** The slide through the open menu, and its menu. */
let slide: {
  id: number; s: SlideSession<HTMLElement>; menu: HTMLElement; close: () => void; free: boolean; scrim: HTMLElement | null;
  /** The finger has been on an option (a long menu may scroll from then on), where it is, and the scrolling frame. */
  entered: boolean; x: number; y: number; raf: number;
} | null = null;
/**
 * When a hold opened a menu, or its finger lifted (performance.now; 0: none): real clicks are dropped for a
 * moment after (the lift's click isn't a tap), until the next touch.
 */
let swallowAt = 0;

const optionAt = (menu: HTMLElement, x: number, y: number): HTMLElement | null => {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[role=menuitem]") ?? null;
  // A menu fading out (closed by Back mid-slide) offers nothing (review C6).
  return el && menu.contains(el) && !menu.classList.contains("out") && !(el as HTMLButtonElement).disabled ? el : null;
};

function light(el: HTMLElement | null, on: boolean) { el?.classList.toggle("slide-on", on); }

function endSlide() {
  if (!slide) return;
  light(slide.s.over, false);
  const free = slide.free;
  if (slide.scrim) slide.scrim.style.pointerEvents = "";
  cancelAnimationFrame(slide.raf);
  slide = null;
  if (!free) suspendOverscroll(false);
}

function cancelHold() {
  if (hold) clearTimeout(hold.timer);
  hold = null;
}

/**
 * Whether [el] sits in a page that scrolls up and down now (Settings, an item's page, a long Today). There a
 * menu opened by a hold doesn't hold the page still (review C3): a finger that goes on to scroll scrolls, and
 * the menu closes (the hold wasn't meant for it).
 */
function inScrollingPage(el: HTMLElement): boolean {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return true;
  }
  return false;
}

/**
 * A DropdownMenu has just opened ([menu] its box, [close] its own closing): a finger still down may slide into
 * it.
 */
export function menuOpened(menu: HTMLElement, close: () => void) {
  if (!down) return;
  endSlide();
  const free = inScrollingPage(menu);
  // The menu's scrim (fixed over the whole screen, for a tap outside) lets the finger that opened the menu
  // through until it lifts: the Android WebView picks what a moving finger scrolls by what's under it as it
  // starts to move, and the scrim, fixed to the screen, scrolls nothing, so a finger that rested on a Settings
  // choice past the hold and then moved left the page still (2.10.2's checks). With the page under it, it scrolls.
  const scrim = menu.previousElementSibling instanceof HTMLElement && menu.previousElementSibling.classList.contains("p-menu-scrim") ? menu.previousElementSibling : null;
  if (scrim) scrim.style.pointerEvents = "none";
  slide = { id: down.id, s: new SlideSession<HTMLElement>(down.x, down.y, performance.now()), menu, close, free, scrim, entered: false, x: down.x, y: down.y, raf: 0 };
  if (!free) suspendOverscroll(true); // the page's rubber-band edge stays still under the sliding finger
  claimSwipe(down.id); // and the swipes under the menu (the month, the day, the tabs) leave this finger alone
  swallowAt = performance.now();
}

let started = false;
export function startMenuSlide() {
  if (started) return;
  started = true;
  const opt = { capture: true, passive: true } as const;
  document.addEventListener("pointerdown", (e) => {
    swallowAt = 0;
    // A slide whose lift never came (a lost pointerup) ends here, so the page scrolls again (review C6).
    endSlide();
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY };
    cancelHold();
    const btn = e.target instanceof Element ? e.target.closest<HTMLElement>("[aria-haspopup=menu]") : null;
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    const h = { id: e.pointerId, x0: e.clientX, y0: e.clientY, timer: 0 };
    h.timer = window.setTimeout(() => {
      if (hold !== h || !btn.isConnected) return;
      hold = null;
      feel("pickup");
      swallowAt = performance.now();
      btn.click(); // its own onClick opens the menu; the menu then sees the finger still down (menuOpened)
    }, LONG_PRESS);
    hold = h;
  }, opt);
  document.addEventListener("pointermove", (e) => {
    if (down && e.pointerId === down.id) { down.x = e.clientX; down.y = e.clientY; }
    if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x0, e.clientY - hold.y0) > TOUCH_SLOP) cancelHold();
    if (!slide || e.pointerId !== slide.id) return;
    if (!slide.menu.isConnected) { endSlide(); return; }
    slide.x = e.clientX; slide.y = e.clientY;
    over(e.timeStamp);
    if (slide.s.over) slide.entered = true;
    if (!slide.raf) edgeScroll();
  }, opt);
  /** The option under the finger now lit (after a move, or the menu scrolling under a still finger). */
  const over = (t: number) => {
    if (!slide) return;
    const was = slide.s.over;
    if (slide.s.move(slide.x, slide.y, optionAt(slide.menu, slide.x, slide.y), t)) {
      light(was, false);
      light(slide.s.over, true);
      if (slide.s.over) feel("tick");
    }
  };
  /** A long menu scrolls while the sliding finger is near its top or bottom (2.10.2's leftover). */
  const edgeScroll = () => {
    const sl = slide;
    if (!sl) return;
    sl.raf = 0;
    const m = sl.menu;
    if (!m.isConnected) return;
    const v = menuEdgeSpeed(sl.x, sl.y, m.getBoundingClientRect(), m.scrollTop, m.scrollHeight - m.clientHeight, sl.entered);
    if (!v) return;
    m.scrollTop += v;
    over(performance.now());
    sl.raf = requestAnimationFrame(edgeScroll);
  };
  const up = (e: PointerEvent) => {
    if (down && e.pointerId === down.id) down = null;
    if (hold && e.pointerId === hold.id) cancelHold();
    if (!slide || e.pointerId !== slide.id) return;
    if (swallowAt) swallowAt = performance.now(); // the lift's click, if any, comes now
    const cur = slide;
    const pick = e.type === "pointerup" && cur.menu.isConnected ? cur.s.up(e.timeStamp) : null;
    endSlide();
    // The browser took the finger for a scroll (only where the page scrolls): the menu wasn't wanted.
    if (e.type === "pointercancel" && cur.free) { cur.close(); return; }
    pick?.click(); // a made-up click (not dropped): the option does what a tap on it does
  };
  document.addEventListener("pointerup", up, opt);
  document.addEventListener("pointercancel", up, opt);
  // While sliding through a menu the page under it doesn't scroll, unless it's a page that scrolls (free).
  document.addEventListener("touchmove", (e) => { if (slide && !slide.free && e.cancelable) e.preventDefault(); }, { capture: true, passive: false });
  document.addEventListener("click", (e) => {
    if (e.isTrusted && dropsClick(swallowAt, performance.now())) { e.stopPropagation(); e.preventDefault(); swallowAt = 0; }
  }, { capture: true });
}
