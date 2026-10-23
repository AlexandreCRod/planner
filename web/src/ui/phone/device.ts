// The phone app's door to the small "Device" plugin (android/.../device/DevicePlugin.kt): the phone's
// 24-hour setting, place search with Android's own geocoder, a place shown in the maps app, and the
// touch feel's pulses (played through haptics.ts, never directly), and saving a note's picture or video.
// In a browser none of it exists: times follow the in-app choice, places come from OpenStreetMap, and a
// saved picture or video is an ordinary download.
import { App as CapApp } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import { setDeviceClock24, use24h } from "../../domain/dates.ts";
import { isNative } from "../../platform.ts";
import { pieces } from "../../domain/media.ts";
import { changed } from "../../store/store.ts";

export interface Place { name: string; lat: number; lng: number }

interface DevicePlugin {
  clock(): Promise<{ is24: boolean }>;
  geocode(o: { query: string; max?: number }): Promise<{ places: Place[] }>;
  openMap(o: { name: string; lat?: number | null; lng?: number | null }): Promise<void>;
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

/** Places matching [query]: Android's geocoder in the app, OpenStreetMap's search in a browser. */
export async function searchPlaces(query: string, max = 5): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  if (plugin) {
    try { return (await plugin.geocode({ query: q, max })).places; } catch { return []; }
  }
  return searchNominatim(q, max);
}

/** OpenStreetMap's place search (the PC and browsers). */
export async function searchNominatim(q: string, max = 5): Promise<Place[]> {
  try {
    // Nominatim matches whole words only, so a half-typed last word is searched as typed and without it.
    const url = (text: string) => `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${max}&q=${encodeURIComponent(text)}`;
    const get = async (text: string) => {
      const r = await fetch(url(text), { headers: { Accept: "application/json" }, referrerPolicy: "strict-origin-when-cross-origin" });
      if (!r.ok) return [];
      const list = (await r.json()) as { display_name: string; lat: string; lon: string }[];
      return list.map((p) => ({ name: p.display_name, lat: Number(p.lat), lng: Number(p.lon) }));
    };
    let found = await get(q);
    const head = q.replace(/\s+\S*$/, "");
    if (!found.length && head && head !== q) found = await get(head);
    return found;
  } catch {
    return [];
  }
}

/**
 * Shows a place in the maps app (Google Maps or whichever the phone uses) without starting directions;
 * in a browser, Google Maps' search page in a new tab.
 */
export function openPlace(name: string, lat: number | null | undefined, lng: number | null | undefined) {
  const point = lat != null && lng != null;
  if (plugin) { void plugin.openMap({ name, lat: point ? lat : null, lng: point ? lng : null }).catch(() => {}); return; }
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point ? `${lat},${lng}` : name)}`, "_blank", "noopener");
}
