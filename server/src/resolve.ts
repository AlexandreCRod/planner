// Google Maps short links to a place (GET /api/resolve-place): the redirects are followed by hand through
// Google's own hosts only, and the final address is read by places.ts.
import { type ResolvedPlace, isGoogleHost, placeFromUrl } from "./places.ts";
import { fetchFollowing, readCapped } from "./web.ts";

const allowedGoogle = (u: URL) => (u.protocol === "https:" || u.protocol === "http:") && isGoogleHost(u.hostname);

/** The place a Google Maps short link leads to, or null. Only Google's own hosts are followed. */
export async function resolvePlace(target: URL): Promise<ResolvedPlace | null> {
  let url = target;
  // A consent page in front (EU) names where it was going in continue=.
  for (let round = 0; round < 2; round++) {
    const got = await fetchFollowing(url, allowedGoogle, "text/html,*/*;q=0.5");
    if (!got) return null;
    const direct = placeFromUrl(got.url.href);
    if (direct) return { ...direct, url: target.href };
    const next = got.url.hostname.startsWith("consent.") ? got.url.searchParams.get("continue") : null;
    if (next) {
      try { const n = new URL(next); if (!allowedGoogle(n)) return null; url = n; continue; } catch { return null; }
    }
    // A page that carries the map's address in its own HTML (share.google, some Maps shells).
    const { bytes } = await readCapped(got.res, 131_072);
    const html = new TextDecoder().decode(bytes);
    for (const m of html.matchAll(/https?:\\?\/\\?\/(?:www\.)?google\.[a-z.]+\\?\/maps\\?\/[^"'<>\s\\]+/g)) {
      const place = placeFromUrl(m[0].replace(/\\u0026|&amp;/g, "&").replace(/\\\//g, "/"));
      if (place) return { ...place, url: target.href };
    }
    return null;
  }
  return null;
}
