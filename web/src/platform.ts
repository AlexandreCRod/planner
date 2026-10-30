// Where the app runs: a desktop browser (the PC app), a phone-width browser, or the Capacitor phone
// build. Every screen is the phone's; a wide browser window lays them out for its width (html.wide).
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useSyncExternalStore } from "react";

/** Running inside the Capacitor Android app. */
export const isNative = Capacitor.isNativePlatform();

// ---------- "Planner Test" (roadmap 129) ----------
// A second Android build (build type sandbox, app ID com.alex.planner.web.test) installed beside the real
// app: its own data, no sync, no updates, sample data, and a TEST chip in the top bar. The web files are
// the same, so the page asks Android which app it is, once, before the first render (main.tsx).
// In `npm run dev` only, localStorage devTestApp=1 makes the browser act as the test app, for checks.

let testApp = import.meta.env.DEV && typeof localStorage !== "undefined" && localStorage.getItem("devTestApp") === "1";
/** Running as "Planner Test": never syncs, never offers updates, starts on sample data. */
export const isTestApp = () => testApp;
/** Finds out whether this is the test app (its app ID ends in ".test"); call before the first render. */
export async function detectTestApp(): Promise<void> {
  if (!isNative) return;
  try { testApp = (await CapApp.getInfo()).id.endsWith(".test"); } catch { /* the real app, as before */ }
}

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
