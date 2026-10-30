// App updates (phone build only): when the app opens, and when it's brought back from the background,
// at most every 6 hours, it asks GitHub for the project's latest release (one plain GET, no token, nothing about this phone or its data is sent).
// A newer version than the installed one is offered in a popup (UpdateHost.tsx); "Later" hides it
// until a still newer release appears. The download and Android's installer are in UpdatePlugin.kt.
import { App as CapApp } from "@capacitor/app";
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNewerVersion, updateCheckDue } from "../../domain/version.ts";
import { isNative, isTestApp } from "../../platform.ts";

const LATEST_URL = "https://api.github.com/repos/AlexandreCRod/planner/releases/latest";
const CHECKED_KEY = "updateCheckedAt";
const DISMISSED_KEY = "updateDismissed";
/** Debug builds only: pretend to be this version, to try the popup (ignored in release builds). */
const DEBUG_VERSION_KEY = "debugInstalledVersion";

interface UpdatesPlugin {
  appVersion(): Promise<{ versionName: string; versionCode: number; debug: boolean }>;
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  download(o: { url: string }): Promise<{ size: number }>;
  install(): Promise<void>;
  addListener(event: "progress", fn: (p: { received: number; total: number }) => void): Promise<PluginListenerHandle>;
}

const plugin = isNative ? registerPlugin<UpdatesPlugin>("Updates") : null;

export interface Release { tag: string; name: string; body: string; apkUrl: string | null; apkSize: number }
export interface Offer { release: Release; installed: string }

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

// ---------- The offer shown by UpdateHost ----------
let offer: Offer | null = null;
const listeners = new Set<() => void>();
export const currentOffer = () => offer;
export function subscribeOffer(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function setOffer(o: Offer | null) { offer = o; listeners.forEach((l) => l()); }

/** The version this build is, as Android knows it (null outside the phone build). */
let installedCache: string | null = null;
export async function installedVersion(): Promise<string | null> {
  if (!plugin) return null;
  if (installedCache) return installedCache;
  try {
    const v = await plugin.appVersion();
    const fake = v.debug ? get(DEBUG_VERSION_KEY) : null;
    installedCache = fake || v.versionName;
    return installedCache;
  } catch { return null; }
}

/** GitHub's latest release, or null when it can't be read. */
async function fetchLatest(): Promise<Release | null> {
  try {
    const r = await fetch(LATEST_URL, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const j = await r.json() as { tag_name?: string; name?: string; body?: string; assets?: { name?: string; browser_download_url?: string; size?: number }[] };
    if (typeof j.tag_name !== "string") return null;
    const apk = (j.assets ?? []).find((a) => typeof a.name === "string" && a.name.toLowerCase().endsWith(".apk") && typeof a.browser_download_url === "string");
    return { tag: j.tag_name, name: j.name || `Planner ${j.tag_name.replace(/^v/i, "")}`, body: j.body ?? "", apkUrl: apk?.browser_download_url ?? null, apkSize: apk?.size ?? 0 };
  } catch { return null; }
}

export type CheckResult = "newer" | "current" | "failed";

/**
 * Checks GitHub for a newer release. When the app opens ([manual] false) it runs at most every 6 hours
 * and a release dismissed with "Later" isn't offered again; from Settings it always runs.
 */
export async function checkForUpdate(manual: boolean): Promise<CheckResult> {
  // "Planner Test" (129) is never offered the real app's releases: it's installed by hand.
  if (!plugin || isTestApp()) return "failed";
  if (!manual && !updateCheckDue(Number(get(CHECKED_KEY) ?? 0), Date.now())) return "current";
  set(CHECKED_KEY, String(Date.now()));
  const installed = await installedVersion();
  const release = await fetchLatest();
  if (!installed || !release) return "failed";
  if (!isNewerVersion(release.tag, installed)) return "current";
  const dismissed = get(DISMISSED_KEY);
  if (!manual && dismissed && !isNewerVersion(release.tag, dismissed)) return "newer";
  setOffer({ release, installed });
  return "newer";
}

/**
 * Checks on a fresh start and again whenever the app comes back from the background (Capacitor's
 * resume, or the page becoming visible), each time only if the last check is 6 hours old. Returns the
 * function that stops listening.
 */
export function watchForUpdates(delayMs = 2500): () => void {
  if (!plugin || isTestApp()) return () => {};
  let timer = 0;
  const soon = () => { clearTimeout(timer); timer = window.setTimeout(() => void checkForUpdate(false), delayMs); };
  soon();
  const onVisible = () => { if (document.visibilityState === "visible") soon(); };
  document.addEventListener("visibilitychange", onVisible);
  const h = CapApp.addListener("resume", soon);
  return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); void h.then((x) => x.remove()); };
}

/** "Later": hidden until a newer release than this one appears. */
export function dismissOffer() {
  if (offer) set(DISMISSED_KEY, offer.release.tag);
  setOffer(null);
}
export const closeOffer = () => setOffer(null);

// ---------- Installing ----------
export const canInstall = async () => { try { return (await plugin!.canInstall()).allowed; } catch { return false; } };

/** Opens "Install unknown apps" for this app; resolves once the person is back in the app. */
export async function askInstallPermission(): Promise<boolean> {
  if (!plugin) return false;
  const back = new Promise<void>((resolve) => {
    let handle: PluginListenerHandle | null = null;
    void CapApp.addListener("resume", () => { void handle?.remove(); resolve(); }).then((h) => { handle = h; });
  });
  try { await plugin.openInstallSettings(); } catch { return false; }
  await back;
  return canInstall();
}

/** Downloads the release's .apk, reporting progress as a fraction (or null when the size is unknown). */
export async function downloadUpdate(url: string, onProgress: (f: number | null) => void): Promise<void> {
  if (!plugin) throw new Error("not available");
  const h = await plugin.addListener("progress", ({ received, total }) => onProgress(total > 0 ? Math.min(1, received / total) : null));
  try { await plugin.download({ url }); } finally { void h.remove(); }
}

export const openInstaller = () => plugin!.install();
