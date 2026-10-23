// The phone app's door to the small "Device" plugin (android/.../device/DevicePlugin.kt): the phone's
// 24-hour setting, a place shown in Google Maps or the chooser of navigation apps for directions, the
// touch feel's pulses (played through haptics.ts, never directly), and saving a note's picture or video.
// Place suggestions come from Photon (domain/places.ts) everywhere. In a browser the plugin doesn't
// exist: times follow the in-app choice, maps open as web pages, a saved picture is a download.
import { App as CapApp } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import { setDeviceClock24, use24h } from "../../domain/dates.ts";
import { isNative } from "../../platform.ts";
import { pieces } from "../../domain/media.ts";
import { changed } from "../../store/store.ts";
import { type Place, photonUrl, placesFromPhoton } from "../../domain/places.ts";

export type { Place };

interface DevicePlugin {
  clock(): Promise<{ is24: boolean }>;
  openMap(o: { name: string; lat?: number | null; lng?: number | null }): Promise<void>;
  openGoogleMaps(o: { url: string }): Promise<void>;
  directions(o: { name: string; address: string; lat: number | null | undefined; lng: number | null | undefined }): Promise<void>;
  feel(o: { kind: string }): Promise<void>;
  selectionRect(o: { left: number; top: number; right: number; bottom: number } | { clear: true }): Promise<void>;
  saveMediaStart(o: { name: string; mime: string }): Promise<{ id: string }>;
  saveMediaPiece(o: { id: string; data: string }): Promise<void>;
  saveMediaEnd(o: { id: string; cancel?: boolean }): Promise<void>;
}

const plugin = isNative ? registerPlugin<DevicePlugin>("Device") : null;

/** Whether the phone can play the touch feel (the app; never a browser). */
export const canFeel = plugin !== null;
/** One pulse of the touch feel, unspaced: use feel() in haptics.ts, which spaces them. */
export function playFeel(kind: string) {
  if (plugin) void plugin.feel({ kind }).catch(() => {});
}

/** Tells the app where the page's text selection is (its toolbar goes right above it); null: none. */
export function setSelectionRect(r: { left: number; top: number; right: number; bottom: number } | null) {
  if (plugin) void plugin.selectionRect(r ?? { clear: true }).catch(() => {});
}

/** A piece of a file as base64. */
async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Saves a file to the phone: in the app, to the gallery (Pictures/Planner or Movies/Planner), sent to
 * Android in pieces; in a browser, as a download. Throws with a message to show when it can't.
 */
export async function saveToPhone(blob: Blob, name: string, mime: string): Promise<void> {
  if (!plugin) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return;
  }
  const { id } = await plugin.saveMediaStart({ name, mime });
  try {
    for (const [a, b] of pieces(blob.size)) await plugin.saveMediaPiece({ id, data: await base64Of(blob.slice(a, b)) });
  } catch (e) {
    await plugin.saveMediaEnd({ id, cancel: true }).catch(() => {});
    throw e;
  }
  await plugin.saveMediaEnd({ id });
}

/** Reads the phone's clock format; every page is drawn again if it changed. */
async function readClock() {
  if (!plugin) return;
  try {
    const { is24 } = await plugin.clock();
    const before = use24h();
    setDeviceClock24(is24);
    if (before !== is24) changed(true);
  } catch { /* an older build without the plugin: the in-app choice stays */ }
}

let started = false;
/** Follows the phone's 24-hour setting: read now, and again whenever the app comes back. */
export function startDeviceClock() {
  if (started || !plugin) return;
  started = true;
  void readClock();
  void CapApp.addListener("resume", () => void readClock());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void readClock(); });
}

/** Where the phone is, roughly, when the person has already let this app know (never asked for here). */
async function knownPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    if (!navigator.geolocation || !navigator.permissions) return null;
    const st = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (st.state !== "granted") return null;
    return await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: 3000 }));
  } catch { return null; }
}

/**
 * Places matching [query] from Photon (komoot's OpenStreetMap search), in the app and in a browser alike.
 * Places near the person come first: near where the phone is when that's already allowed, otherwise
 * near the places of their own recent items ([near]). Only the typed text and a rounded point are sent.
 */
export async function searchPlaces(query: string, near: { lat: number; lng: number } | null, signal?: AbortSignal, max = 6): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const bias = (await knownPosition()) ?? near;
    const r = await fetch(photonUrl(q, bias, max), { headers: { Accept: "application/json" }, referrerPolicy: "no-referrer", signal });
    if (!r.ok) return [];
    return placesFromPhoton(await r.json());
  } catch {
    return [];
  }
}

/** Opens the place in Google Maps (the app when it's there, else the website): [query] is what to find. */
export function openInGoogleMaps(query: string) {
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  if (plugin) { void plugin.openGoogleMaps({ url }).catch(() => window.open(url, "_blank", "noopener")); return; }
  window.open(url, "_blank", "noopener");
}

/**
 * Directions to a place: in the app, Android's chooser of the installed navigation apps (Google Maps,
 * Waze...); in a browser, Google Maps' directions page.
 */
export function openDirections(to: { name: string; address: string; lat: number | null | undefined; lng: number | null | undefined }) {
  const point = to.lat != null && to.lng != null;
  const dest = point ? `${to.lat},${to.lng}` : (to.address || to.name);
  if (!dest.trim()) return;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
  if (plugin) { void plugin.directions({ name: to.name, address: to.address, lat: point ? to.lat : null, lng: point ? to.lng : null }).catch(() => window.open(web, "_blank", "noopener")); return; }
  window.open(web, "_blank", "noopener");
}
