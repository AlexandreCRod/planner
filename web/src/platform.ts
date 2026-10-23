// Where the app runs: a desktop browser (the PC app), a phone-width browser, or the Capacitor phone
// build. Every screen is the phone's; a wide browser window lays them out for its width (html.wide).
import { Capacitor } from "@capacitor/core";
import { useSyncExternalStore } from "react";

/** Running inside the Capacitor Android app. */
export const isNative = Capacitor.isNativePlatform();

/** The PC's wide layout starts here; a window snapped to half the screen keeps the phone's. */
export const WIDE_MIN = 900;
const wideQuery = !isNative && typeof matchMedia === "function" ? matchMedia(`(min-width: ${WIDE_MIN}px)`) : null;

/** A browser window wide enough for the side rail and side-by-side panes (never the phone build). */
export const isWide = () => !!wideQuery?.matches;

export function useWide(): boolean {
  return useSyncExternalStore((l) => { wideQuery?.addEventListener("change", l); return () => wideQuery?.removeEventListener("change", l); }, isWide);
}

// ---------- Server address ----------
// The PC app is served by the Worker itself, so it calls relative /api/... paths. The phone app is
// loaded from its own files (https://localhost), so it needs the server's full address.

/** Pre-filled server address. Empty unless set at build time, e.g. VITE_DEFAULT_SERVER=http://10.0.2.2:8787
 *  (the emulator's alias for the computer running `wrangler dev`). */
export const DEFAULT_SERVER = (import.meta.env.VITE_DEFAULT_SERVER as string | undefined) ?? "";

export const getServer = () => (isNative ? (localStorage.getItem("serverUrl") || DEFAULT_SERVER) : "");
export function setServer(url: string) {
  let u = url.trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
  localStorage.setItem("serverUrl", u);
}

/** Full URL for an API path: unchanged (relative) on the PC, prefixed with the server on the phone. */
export const apiUrl = (path: string) => getServer() + path;

/** Shown to the server as the device that synced last. */
export const deviceName = () => (isNative ? "Phone (web app)" : "PC browser");
