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
import { feel } from "./haptics.ts";
import { LONG_PRESS, TOUCH_SLOP } from "./press.ts";
import { SlideSession } from "./slideSession.ts";
import { suspendOverscroll } from "./overscroll.ts";
import { claimSwipe } from "./gesture.ts";

/** The finger (or mouse button) down now, where it is. */
let down: { id: number; x: number; y: number } | null = null;
/** A hold on a menu button, waiting for LONG_PRESS. */
let hold: { id: number; x0: number; y0: number; timer: number } | null = null;
/** The slide through the open menu, and its menu. */
let slide: { id: number; s: SlideSession<HTMLElement>; menu: HTMLElement } | null = null;
/** Real clicks are dropped from a hold that opened a menu until the next touch (the lift's click isn't a tap). */
let swallowing = false;

const optionAt = (menu: HTMLElement, x: number, y: number): HTMLElement | null => {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[role=menuitem]") ?? null;
  return el && menu.contains(el) && !(el as HTMLButtonElement).disabled ? el : null;
};

function light(el: HTMLElement | null, on: boolean) { el?.classList.toggle("slide-on", on); }

function endSlide() {
  if (!slide) return;
  light(slide.s.over, false);
  slide = null;
  suspendOverscroll(false);
}

function cancelHold() {
  if (hold) clearTimeout(hold.timer);
  hold = null;
}

/** A DropdownMenu has just opened ([menu] its box): a finger still down may slide into it. */
export function menuOpened(menu: HTMLElement) {
  if (!down) return;
  endSlide();
  slide = { id: down.id, s: new SlideSession<HTMLElement>(down.x, down.y), menu };
  suspendOverscroll(true); // the page's rubber-band edge stays still under the sliding finger
  claimSwipe(down.id); // and the swipes under the menu (the month, the day, the tabs) leave this finger alone
  swallowing = true;
}

let started = false;
export function startMenuSlide() {
  if (started) return;
  started = true;
  const opt = { capture: true, passive: true } as const;
  document.addEventListener("pointerdown", (e) => {
    swallowing = false;
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
      swallowing = true;
      btn.click(); // its own onClick opens the menu; the menu then sees the finger still down (menuOpened)
    }, LONG_PRESS);
    hold = h;
  }, opt);
  document.addEventListener("pointermove", (e) => {
    if (down && e.pointerId === down.id) { down.x = e.clientX; down.y = e.clientY; }
    if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x0, e.clientY - hold.y0) > TOUCH_SLOP) cancelHold();
    if (!slide || e.pointerId !== slide.id) return;
    if (!slide.menu.isConnected) { endSlide(); return; }
    const was = slide.s.over;
    if (slide.s.move(e.clientX, e.clientY, optionAt(slide.menu, e.clientX, e.clientY))) {
      light(was, false);
      light(slide.s.over, true);
      if (slide.s.over) feel("tick");
    }
  }, opt);
  const up = (e: PointerEvent) => {
    if (down && e.pointerId === down.id) down = null;
    if (hold && e.pointerId === hold.id) cancelHold();
    if (!slide || e.pointerId !== slide.id) return;
    const pick = e.type === "pointerup" && slide.menu.isConnected ? slide.s.up() : null;
    endSlide();
    pick?.click(); // a made-up click (not dropped): the option does what a tap on it does
  };
  document.addEventListener("pointerup", up, opt);
  document.addEventListener("pointercancel", up, opt);
  // While sliding through a menu the page under it doesn't scroll.
  document.addEventListener("touchmove", (e) => { if (slide && e.cancelable) e.preventDefault(); }, { capture: true, passive: false });
  document.addEventListener("click", (e) => {
    if (swallowing && e.isTrusted) { e.stopPropagation(); e.preventDefault(); swallowing = false; }
  }, { capture: true });
}
