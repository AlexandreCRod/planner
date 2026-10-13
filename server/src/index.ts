import { parseSnapshot, tokensMatch } from "./records.ts";
import { type Env, PlannerStore } from "./store.ts";

export { PlannerStore };

/**
 * HTTP API in front of the Durable Object.
 *
 *   GET  /api/status                 counts, sequence number, last push time
 *   PUT  /api/snapshot[?force=1]     replace the stored data with the app's full snapshot
 *   GET  /api/snapshot               full data, same JSON shape as an app backup
 *   GET  /api/changes?since=N        records changed after sequence N (for other clients)
 *   GET  /api/history                daily safety copies kept by the server
 *   GET  /api/history/:id            one of those copies
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

    // Single user: everything lives in one Durable Object instance.
    const store = env.PLANNER.get(env.PLANNER.idFromName("default"));
    const path = url.pathname.replace(/\/+$/, "");

    try {
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
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Device",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
