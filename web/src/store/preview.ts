// Web link previews and Google Maps links as places, asked of the Worker only when someone long-presses a link (the page is never
// contacted from the device). Remembered for the session; null when there's nothing to show.
import type { LinkPreview } from "../domain/links.ts";
import type { Place } from "../domain/places.ts";
import { api, getToken } from "./sync.ts";

const seen = new Map<string, LinkPreview>();

/** The preview of [url], or null: offline, not signed in, an older Worker (404), or a page it can't read. */
export async function fetchPreview(url: string, signal?: AbortSignal): Promise<LinkPreview | null> {
  const known = seen.get(url);
  if (known) return known;
  if (!getToken()) return null;
  try {
    const r = (await api(`/api/preview?url=${encodeURIComponent(url)}`, { signal })) as Partial<LinkPreview> | null;
    if (!r || typeof r !== "object") return null;
    const p: LinkPreview = {
      url, title: typeof r.title === "string" ? r.title : "", description: typeof r.description === "string" ? r.description : "",
      site: typeof r.site === "string" ? r.site : "", image: typeof r.image === "string" && r.image.startsWith("data:image/") ? r.image : "",
    };
    seen.set(url, p);
    return p;
  } catch {
    return null;
  }
}

/**
 * The place a Google Maps short link stands for (GET /api/resolve-place), or null when it can't be
 * found: offline, not signed in, an older Worker (404), or a link with no place in it.
 */
export async function fetchPlaceOfLink(url: string, signal?: AbortSignal): Promise<Place | null> {
  if (!getToken()) return null;
  try {
    const r = (await api(`/api/resolve-place?url=${encodeURIComponent(url)}`, { signal })) as Partial<Place> | null;
    if (!r || typeof r.lat !== "number" || typeof r.lng !== "number" || typeof r.name !== "string" || !r.name.trim()) return null;
    return { name: r.name.trim(), address: typeof r.address === "string" ? r.address : "", area: typeof r.area === "string" ? r.area : "", lat: r.lat, lng: r.lng };
  } catch {
    return null;
  }
}
