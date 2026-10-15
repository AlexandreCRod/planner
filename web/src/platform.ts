// Where the app runs: a desktop browser (the PC app), a phone-width browser, or the Capacitor phone
// build. Everything phone-specific is switched on from here, so the PC layout never changes.
import { Capacitor } from "@capacitor/core";
import { useSyncExternalStore } from "react";

/** Running inside the Capacitor Android app. */
export const isNative = Capacitor.isNativePlatform();

const narrow = typeof matchMedia === "function" ? matchMedia("(max-width: 600px)") : null;

/** Phone layout: the native app, or a browser window about as narrow as a phone. */
export const isPhone = () => isNative || !!narrow?.matches;

export function usePhone(): boolean {
  return useSyncExternalStore((l) => { narrow?.addEventListener("change", l); return () => narrow?.removeEventListener("change", l); }, isPhone);
}

// ---------- Server address ----------
// The PC app is served by the Worker itself, so it calls relative /api/... paths. The phone app is
// loaded from its own files (https://localhost), so it needs the server's full address.

/** Debug default: the emulator's alias for the computer running `wrangler dev`. */
export const DEFAULT_SERVER = (import.meta.env.VITE_DEFAULT_SERVER as string | undefined) ?? "http://10.0.2.2:8787";

export const getServer = () => (isNative ? (localStorage.getItem("serverUrl") || DEFAULT_SERVER) : "");
export function setServer(url: string) {
  localStorage.setItem("serverUrl", url.trim().replace(/\/+$/, ""));
}

/** Full URL for an API path: unchanged (relative) on the PC, prefixed with the server on the phone. */
export const apiUrl = (path: string) => getServer() + path;

/** Shown to the server as the device that synced last. */
export const deviceName = () => (isNative ? "Phone (web app)" : "PC browser");
