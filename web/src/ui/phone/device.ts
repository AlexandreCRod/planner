// The phone app's door to the small "Device" plugin (android/.../device/DevicePlugin.kt): the phone's
// 24-hour setting, place search with Android's own geocoder, and a place shown in the maps app.
// In a browser none of it exists: times follow the in-app choice, places come from OpenStreetMap.
import { App as CapApp } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import { setDeviceClock24, use24h } from "../../domain/dates.ts";
import { isNative } from "../../platform.ts";
import { changed } from "../../store/store.ts";

export interface Place { name: string; lat: number; lng: number }

interface DevicePlugin {
  clock(): Promise<{ is24: boolean }>;
  geocode(o: { query: string; max?: number }): Promise<{ places: Place[] }>;
  openMap(o: { name: string; lat?: number | null; lng?: number | null }): Promise<void>;
}

const plugin = isNative ? registerPlugin<DevicePlugin>("Device") : null;

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
