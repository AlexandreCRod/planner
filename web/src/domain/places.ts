// Places for tasks and events: suggestions from Photon (komoot's OpenStreetMap search, made for
// search-as-you-type and good at shop and place names), how a place is shown, and how the list of
// suggestions changes as more is typed. Pure, checked by test/places.test.ts.
import type { Item } from "./types.ts";

/** A suggestion: its name, the address under it, a short area to tell it apart, and its coordinates. */
export interface Place { name: string; address: string; area: string; lat: number; lng: number }

export const PHOTON_URL = "https://photon.komoot.io/api/";

/**
 * Photon's search address for [q]. With [near] (rounded to about a kilometre, so no exact position is
 * ever sent), places close to it come first.
 */
export function photonUrl(q: string, near: { lat: number; lng: number } | null, limit = 6): string {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (near) {
    params.set("lat", near.lat.toFixed(2));
    params.set("lon", near.lng.toFixed(2));
  }
  return `${PHOTON_URL}?${params}`;
}

interface PhotonProps {
  name?: string; street?: string; housenumber?: string; postcode?: string; city?: string; district?: string;
  locality?: string; county?: string; state?: string; country?: string; osm_key?: string; osm_value?: string;
}
interface PhotonFeature { geometry?: { coordinates?: [number, number] }; properties?: PhotonProps }

const uniq = (parts: (string | undefined)[]) => {
  const out: string[] = [];
  for (const p of parts) { const t = p?.trim(); if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t); }
  return out;
};

/** Photon's answer as places: named first by the place's own name, else its street. Doubles go. */
export function placesFromPhoton(json: unknown): Place[] {
  const features = (json as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const c = f.geometry?.coordinates, p = f.properties ?? {};
    if (!c || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    const streetLine = uniq([p.street, p.housenumber]).join(" ");
    const name = p.name?.trim() || streetLine || p.city || p.county || p.state || "";
    if (!name) continue;
    const town = p.city ?? p.county;
    const address = uniq([streetLine !== name ? streetLine : undefined, p.district ?? p.locality, p.postcode ? `${p.postcode} ${town ?? ""}` : town, p.country])
      .filter((x) => x.toLowerCase() !== name.toLowerCase()).join(", ");
    const area = uniq([p.district, p.locality, town, p.state, p.country]).find((x) => x.toLowerCase() !== name.toLowerCase()) ?? "";
    const key = `${name.toLowerCase()}|${c[1].toFixed(4)}|${c[0].toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, address, area, lat: c[1], lng: c[0] });
  }
  return out;
}

export const placeKey = (p: Place) => `${p.name}|${p.lat.toFixed(5)}|${p.lng.toFixed(5)}`;

/**
 * The suggestions to show once [next] has come in while [shown] is on screen: those still found keep
 * their places, newly found ones come after them, and ones no longer found go. So a result never jumps
 * about under the finger as more is typed.
 */
export function stableMerge(shown: Place[], next: Place[], max = 6): Place[] {
  const nextKeys = new Map(next.map((p) => [placeKey(p), p]));
  const kept = shown.filter((p) => nextKeys.has(placeKey(p))).map((p) => nextKeys.get(placeKey(p))!);
  const keptKeys = new Set(kept.map(placeKey));
  return [...kept, ...next.filter((p) => !keptKeys.has(placeKey(p)))].slice(0, max);
}

/**
 * Where to look first when no position is known: the middle of the places of the user's latest items
 * that have coordinates (the median, so one trip far away doesn't move it). Null when there are none.
 */
export function usualArea(items: readonly Item[], take = 12): { lat: number; lng: number } | null {
  const pts = items.filter((i) => i.lat != null && i.lng != null && Number.isFinite(i.lat) && Number.isFinite(i.lng))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, take);
  if (!pts.length) return null;
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return { lat: median(pts.map((i) => i.lat!)), lng: median(pts.map((i) => i.lng!)) };
}

/**
 * How an item's place reads: the name or the user's own label as the main line, and under it a small
 * grey line to tell places apart: the place's own name when the label is different, and its area
 * ("Decathlon · Alfragide"). An item from before places had names shows its text alone.
 */
export function placeLines(item: Pick<Item, "location" | "placeName" | "area" | "address">): { main: string; sub: string } {
  const main = (item.location ?? "").trim();
  if (!main) return { main: "", sub: "" };
  const name = item.placeName?.trim();
  const sub = uniq([name && name.toLowerCase() !== main.toLowerCase() ? name : undefined, item.area]).join(" · ");
  return { main, sub };
}

/** What Google Maps is asked to find for the item's place: its name and address, else its coordinates, else its text. */
export function mapsQuery(item: Pick<Item, "location" | "placeName" | "address" | "lat" | "lng">): string {
  const name = (item.placeName || item.location || "").trim();
  if (item.address?.trim()) return uniq([name, item.address]).join(", ");
  if (item.lat != null && item.lng != null) return `${item.lat},${item.lng}`;
  return name;
}

/** The fields a picked suggestion sets on an item (its name is the label until the user changes it). */
export function placeFields(p: Place): Pick<Item, "location" | "placeName" | "address" | "area" | "lat" | "lng"> {
  return { location: p.name, placeName: p.name, address: p.address, area: p.area, lat: p.lat, lng: p.lng };
}

/** An item with no place at all. */
export const NO_PLACE: Pick<Item, "location" | "placeName" | "address" | "area" | "lat" | "lng"> =
  { location: "", placeName: "", address: "", area: "", lat: null, lng: null };
