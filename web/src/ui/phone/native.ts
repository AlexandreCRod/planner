// Phone-only helpers: haptics, the soft keyboard's height, and the Android back button.
import { App as CapApp } from "@capacitor/app";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Keyboard } from "@capacitor/keyboard";
import { useSyncExternalStore } from "react";
import { isNative } from "../../platform.ts";

// ---------- Haptics (no-ops in a browser) ----------
export const hapticLift = () => { if (isNative) void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {}); };
export const hapticTick = () => { if (isNative) void Haptics.selectionChanged().catch(() => {}); };
export const hapticLight = () => { if (isNative) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); };

// ---------- Keyboard ----------
// How much of the bottom of the page the keyboard covers, in CSS px. In the app the WebView keeps its
// size (the plugin reports the height as the keyboard starts to move); in a phone browser the visual
// viewport shrinks instead.
let pluginHeight = 0;
let viewportCover = 0;
let kb = 0;
const kbListeners = new Set<() => void>();
function update() {
  const next = Math.max(pluginHeight, viewportCover);
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
/** Starts the keyboard and back-button plumbing (once). */
export function startPhonePlumbing() {
  if (started) return;
  started = true;
  const vv = window.visualViewport;
  if (vv) {
    const measure = () => { viewportCover = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)); update(); };
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
  }
  if (isNative) {
    void Keyboard.addListener("keyboardWillShow", (info) => { pluginHeight = info.keyboardHeight; update(); });
    void Keyboard.addListener("keyboardWillHide", () => { pluginHeight = 0; update(); });
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
