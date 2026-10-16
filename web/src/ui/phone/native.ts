// Phone-only helpers: haptics, the soft keyboard's height, and the Android back button.
import { App as CapApp } from "@capacitor/app";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Keyboard } from "@capacitor/keyboard";
import { useSyncExternalStore } from "react";
import { isNative } from "../../platform.ts";
import { startPressFeedback } from "./press.ts";
import { startPhoneTheme } from "./theme.ts";
import { startDeviceClock } from "./device.ts";
import { startOverscroll } from "./overscroll.ts";

// ---------- Haptics (no-ops in a browser) ----------
export const hapticLift = () => { if (isNative) void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {}); };
/** A wheel's row going by: the light selection tick (the plugin only ticks once a selection started). */
let selecting = false;
export const hapticTick = () => {
  if (!isNative) return;
  if (!selecting) { selecting = true; void Haptics.selectionStart().catch(() => {}); }
  void Haptics.selectionChanged().catch(() => {});
};
export const hapticLight = () => { if (isNative) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); };

// ---------- Keyboard ----------
// How much of the bottom of the page the keyboard covers, in CSS px. In the app, Capacitor's
// SystemBars pads the WebView by the keyboard's height as soon as it starts to come up, so the page
// itself shrinks and nothing is covered (the add panel rides the keyboard by animating that jump away,
// see AddPanel). In a phone browser only the visual viewport shrinks, which is measured here.
let viewportCover = 0;
let kb = 0;
const kbListeners = new Set<() => void>();
function update() {
  const next = viewportCover;
  if (next === kb) return;
  kb = next;
  kbListeners.forEach((l) => l());
}
export const keyboardHeight = () => kb;
export function onKeyboard(fn: () => void) { kbListeners.add(fn); return () => { kbListeners.delete(fn); }; }
export function useKeyboardHeight(): number {
  return useSyncExternalStore((l) => onKeyboard(l), keyboardHeight);
}

let started = false;
/** Starts the keyboard and back-button plumbing, press feedback and the accent palette (once). */
export function startPhonePlumbing() {
  if (started) return;
  started = true;
  startPhoneTheme();
  startPressFeedback();
  startOverscroll();
  startDeviceClock();
  const vv = window.visualViewport;
  if (vv) {
    const measure = () => { viewportCover = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)); update(); };
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
  }
  if (isNative) {
    void CapApp.addListener("backButton", () => onBack());
  }
}

// ---------- Back button ----------
// Open panels push a handler; the newest one gets the back press. With none, the app shell decides.
const backStack: (() => void)[] = [];
let shellBack: () => void = () => {};
export function pushBack(fn: () => void) {
  backStack.push(fn);
  return () => { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); };
}
export function setShellBack(fn: () => void) { shellBack = fn; }
function onBack() {
  const top = backStack[backStack.length - 1];
  if (top) top(); else shellBack();
}
export const minimizeApp = () => { if (isNative) void CapApp.minimizeApp().catch(() => {}); };
export const showKeyboard = () => { if (isNative) void Keyboard.show().catch(() => {}); };
export const hideKeyboard = () => { if (isNative) void Keyboard.hide().catch(() => {}); };

/**
 * Opens a link outside the app: in the app the WebView hands any address that isn't the app's own to
 * Android, which picks the app for it (Maps for a map link, the browser otherwise). Nothing is fetched here.
 */
export function openExternal(url: string) {
  if (isNative) location.href = url;
  else window.open(url, "_blank", "noopener");
}

/** Runs [fn] when the soft keyboard starts to go down (in the app only). */
export function onKeyboardHide(fn: () => void): () => void {
  if (!isNative) return () => {};
  const h = Keyboard.addListener("keyboardWillHide", fn);
  return () => { void h.then((x) => x.remove()); };
}
