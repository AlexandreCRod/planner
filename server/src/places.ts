// Google Maps links as places: which addresses count, and the name and coordinates read from a link's
// final address. Pure, checked by test/places.test.ts; the redirect-following is in web.ts.

/** What the app gets back: the same fields as a picked place. */
export interface ResolvedPlace { url: string; name: string; address: string; area: string; lat: number; lng: number }

/** Short-link hosts the app sends here (anything else is refused). */
export function isShortMapsHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "maps.app.goo.gl" || h === "goo.gl" || h === "share.google";
}

/** Hosts a Google Maps link may pass through on the way (checked at every redirect). */
export function isGoogleHost(host: string): boolean {
  const h = host.toLowerCase();
  return isShortMapsHost(h) || /^(www\.|maps\.|consent\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(h);
}

/** [raw] as a Google Maps short link the app may ask about: an allowed host (goo.gl only under /maps), else null. */
export function parseMapsLink(raw: string | null | undefined): URL | null {
  if (!raw || raw.length > 2000) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || !isShortMapsHost(u.hostname)) return null;
  if (u.hostname.toLowerCase() === "goo.gl" && !/^\/maps(\/|$)/.test(u.pathname)) return null;
  return u;
}

const decode = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s.replace(/\+/g, " "); } };
const validPoint = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const isPair = (t: string) => /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(t);

/** The place's coordinates: !3d..!4d.. (the place itself), else @lat,lng (where the map is centred), else q= / query= / ll= as "lat,lng". */
export function coordsOf(u: URL): { lat: number; lng: number } | null {
  const pin = (u.pathname + u.search).match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (pin && validPoint(+pin[1], +pin[2])) return { lat: +pin[1], lng: +pin[2] };
  const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at && validPoint(+at[1], +at[2])) return { lat: +at[1], lng: +at[2] };
  for (const key of ["q", "query", "ll", "destination"]) {
    const m = (u.searchParams.get(key) ?? "").match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m && validPoint(+m[1], +m[2])) return { lat: +m[1], lng: +m[2] };
  }
  return null;
}

/** The place's text: /place/<name>/ in the path, else a q= / query= that isn't coordinates. */
export function nameOf(u: URL): string {
  const p = u.pathname.match(/\/place\/([^/]+)/);
  if (p) { const t = decode(p[1]).trim(); if (t && !isPair(t)) return t; }
  for (const key of ["q", "query", "destination"]) {
    const t = (u.searchParams.get(key) ?? "").trim();
    if (t && !isPair(t)) return t;
  }
  return "";
}

/** "Cafe Foo, 12 Main St, 12345 Town, Country": the first part is the name, the rest the address, and the town the area. */
export function splitName(full: string): { name: string; address: string; area: string } {
  const parts = full.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return { name: "", address: "", area: "" };
  const rest = parts.slice(1);
  // The last part is usually the country: the town is the one before it (without its postcode).
  const town = rest.length >= 2 ? rest[rest.length - 2] : rest[rest.length - 1];
  const area = (town ?? "").replace(/^[A-Za-z]{0,3}[- ]?\d[\d\s-]*\s+/, "").trim();
  return { name: parts[0], address: rest.join(", "), area };
}

/** The place a Google Maps address stands for, else null (no coordinates in it). */
export function placeFromUrl(finalUrl: string): ResolvedPlace | null {
  let u: URL;
  try { u = new URL(finalUrl); } catch { return null; }
  const c = coordsOf(u);
  if (!c) return null;
  const { name, address, area } = splitName(nameOf(u));
  return { url: finalUrl, name: name || "Map location", address, area, lat: c.lat, lng: c.lng };
}
