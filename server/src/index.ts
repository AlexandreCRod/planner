import { isBlobHash, parseSnapshot, parseSyncBody, sha256Hex, tokensMatch } from "./records.ts";
import { parseMapsLink } from "./places.ts";
import { parseWebUrl } from "./preview.ts";
import { resolvePlace } from "./resolve.ts";
import { type Env, MAX_BLOB_BYTES, PlannerStore } from "./store.ts";
import { previewOf } from "./web.ts";

export { PlannerStore };

/**
 * HTTP API in front of the Durable Object.
 *
 *   POST /api/sync[?force=1]         two-way sync: send local changes, receive the rest (any record kind
 *                                    with a well-formed name; the reply lists the Worker's features)
 *   GET  /api/status                 counts, sequence number, last push time
 *   PUT  /api/snapshot[?force=1]     replace the stored data of the kinds the snapshot carries
 *   GET  /api/snapshot               full data, same JSON shape as an app backup
 *   GET  /api/changes?since=N        records changed after sequence N (for other clients)
 *   GET  /api/history                daily safety copies kept by the server
 *   GET  /api/history/:id            one of those copies
 *   PUT  /api/blobs/:sha256          store an image file (body = its bytes)
 *   GET  /api/blobs/:sha256          fetch an image file
 *   GET  /api/preview?url=...        card for a web link, fetched only when asked (a long press on the link):
 *                                    { url, title, description, site, image }. http(s) only; localhost and
 *                                    private addresses are refused (400); 4 s timeout, 256 KB of page read,
 *                                    5 redirects (each host checked); "image" is a data URL of at most 150 KB
 *                                    or "" (the device never contacts the site). 502 when the page can't be read.
 *   GET  /api/resolve-place?url=...  the place behind a Google Maps short link (maps.app.goo.gl, goo.gl/maps,
 *                                    share.google): { url, name, address, area, lat, lng }, the fields of a
 *                                    picked place. Other hosts are refused (400); redirects (at most 5) are
 *                                    followed by hand through Google's own hosts only; 422 when no place is
 *                                    found where the link leads (share.google is best effort).
 *
 * Every request needs "Authorization: Bearer <API_TOKEN>".
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (!url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);

    if (!env.API_TOKEN) return json({ error: "Server is missing its API_TOKEN secret" }, 500);
    const auth = request.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!tokensMatch(token, env.API_TOKEN)) return json({ error: "Unauthorized" }, 401);

    // Single user: everything lives in one Durable Object instance. "v2" started with two-way
    // sync; the first instance ("default") still holds the old one-way mirror.
    const store = env.PLANNER.get(env.PLANNER.idFromName("v2"));
    const path = url.pathname.replace(/\/+$/, "");

    try {
      if (path === "/api/preview" && request.method === "GET") {
        const target = parseWebUrl(url.searchParams.get("url"));
        if (!target) return json({ error: "Only public http(s) addresses can be previewed" }, 400);
        let card = null;
        try { card = await previewOf(target); } catch { /* timed out or refused: reported below */ }
        return card ? json(card) : json({ error: "The page could not be read" }, 502);
      }
      if (path === "/api/resolve-place" && request.method === "GET") {
        const target = parseMapsLink(url.searchParams.get("url"));
        if (!target) return json({ error: "Only Google Maps short links can be resolved" }, 400);
        let place = null;
        try { place = await resolvePlace(target); } catch { /* timed out or refused: reported below */ }
        return place ? json(place) : json({ error: "No place found for that link" }, 422);
      }
      if (path === "/api/status" && request.method === "GET") {
        return json(await store.status());
      }
      if (path === "/api/snapshot" && request.method === "GET") {
        return json(await store.snapshot());
      }
      if (path === "/api/snapshot" && request.method === "PUT") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Body is not valid JSON" }, 400);
        }
        const snapshot = parseSnapshot(body);
        if (typeof snapshot === "string") return json({ error: snapshot }, 400);
        const result = await store.push(snapshot, url.searchParams.get("force") === "1", request.headers.get("X-Device"));
        return result.ok ? json(result) : json({ error: result.reason }, 409);
      }
      if (path === "/api/sync" && request.method === "POST") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Body is not valid JSON" }, 400);
        }
        const parsed = parseSyncBody(body);
        if (typeof parsed === "string") return json({ error: parsed }, parsed.startsWith("Too large") ? 413 : 400);
        const result = await store.sync(parsed.since, parsed.changes, url.searchParams.get("force") === "1", request.headers.get("X-Device"));
        return result.ok ? json(result) : json({ error: result.reason }, 409);
      }
      if (path === "/api/changes" && request.method === "GET") {
        const since = Math.max(0, Number(url.searchParams.get("since") ?? 0) || 0);
        const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit") ?? 1000) || 1000));
        return json(await store.changes(since, limit));
      }
      if (path === "/api/history" && request.method === "GET") {
        return json(await store.history());
      }
      const m = path.match(/^\/api\/history\/(\d+)$/);
      if (m && request.method === "GET") {
        const text = await store.historySnapshot(Number(m[1]));
        return text === null ? json({ error: "Not found" }, 404) : new Response(text, { headers: { "Content-Type": "application/json", ...cors() } });
      }
      const b = path.match(/^\/api\/blobs\/([^/]+)$/);
      if (b && request.method === "PUT") {
        if (!isBlobHash(b[1])) return json({ error: "Bad hash" }, 400);
        const mime = request.headers.get("Content-Type") ?? "";
        if (!mime.startsWith("image/")) return json({ error: "Only images can be stored" }, 415);
        const data = await request.arrayBuffer();
        if (data.byteLength === 0 || data.byteLength > MAX_BLOB_BYTES) return json({ error: "Image is empty or too large" }, 413);
        if ((await sha256Hex(data)) !== b[1]) return json({ error: "Hash does not match the bytes" }, 400);
        await store.putBlob(b[1], mime, data);
        return json({ ok: true });
      }
      if (b && request.method === "GET") {
        if (!isBlobHash(b[1])) return json({ error: "Bad hash" }, 400);
        const blob = await store.getBlob(b[1]);
        if (!blob) return json({ error: "Not found" }, 404);
        return new Response(blob.data, {
          headers: { "Content-Type": blob.mime, "Cache-Control": "private, max-age=31536000, immutable", ...cors() },
        });
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Device",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
