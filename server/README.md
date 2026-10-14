# Planner sync server (Cloudflare Worker + Durable Object)

The hub that keeps the phone and the PC app in sync, and the host of the PC app itself.

```
Phone (own copy) ──POST /api/sync──▶ Worker ──RPC──▶ Durable Object "v2" (SQLite)
PC app (own copy) ─POST /api/sync──▶   │
Browser ───────── GET / ───────────────┴─▶ static files from ../web/dist
```

- **Worker** (`src/index.ts`): checks the password (API token) and routes `/api/*` to the Durable Object. Every other path serves the PC app.
- **Durable Object** (`src/store.ts`): one instance with its own SQLite database. Every record has a sequence number that rises on each change; deletions are kept as markers.
- **Two-way sync** (`POST /api/sync`):
  1. A device sends `{since, changes}`: what changed on its side since the sequence number it last saw.
  2. The server applies each change, unless another device changed the same record in the meantime and wins the conflict. Rules, in `src/records.ts`: an edit beats a delete, between edits from the phone and the PC the phone wins, between two edits of an item from the same device the later one wins, and otherwise the syncing device wins.
  3. The reply carries everything the device is missing.
  4. The Durable Object handles one request at a time, so nothing can slip in between.
- **Safety:** a sync that would delete everything, or more than half of 20+ items, is refused unless forced. One compressed full copy is kept per day for 14 days.

## Deploy (one time)

You need a free Cloudflare account and [Node.js](https://nodejs.org) 22 or newer.

```bash
cd server
npm install
npm install-scripts approve esbuild workerd   # npm 11+ only: lets wrangler fetch its local runtime
npx wrangler login                      # opens the browser to sign in to Cloudflare
npx wrangler secret put API_TOKEN       # paste a long random string; this is your password
(cd ../web && npm install && npm run build)   # the PC app the Worker serves
npx wrangler deploy                     # prints https://planner-sync.<you>.workers.dev
```

To generate a good token, run `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`.

Then open **Settings → Cloud sync** in the app. Turn it on, paste the URL and the token, and tap **Save**, then **Test**. After that, the app syncs about 30 seconds after any change, and every 6 hours as a fallback.

## Develop

```bash
npm test            # unit tests for the record/diff helpers
npm run typecheck
echo API_TOKEN=dev-token > .dev.vars && npm run dev   # local server on http://localhost:8787
npm run e2e         # in a second terminal: 11 end-to-end checks against the local server
```

Don't point `npm run e2e` at your real deployment: it overwrites the stored data.

## API

All requests need the header `Authorization: Bearer <API_TOKEN>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/sync` | Two-way sync: body `{since, changes: [{kind, id, data|null}]}`, reply `{seq, applied, conflicts, changes}`. Add `?force=1` to bypass the deletion guard. |
| GET | `/api/status` | Record counts, current sequence number, time of the last push |
| PUT | `/api/snapshot` | Upload the full snapshot (same JSON as an app backup). Add `?force=1` to bypass the deletion guard. |
| GET | `/api/snapshot` | Download the full snapshot |
| GET | `/api/changes?since=N&limit=1000` | Records changed after sequence N; deleted records have `data: null` |
| GET | `/api/history` | List of the server's daily safety copies |
| GET | `/api/history/:id` | Download one safety copy |

## Cost and limits

Durable Objects with SQLite storage are included in the Workers free plan: 100,000 requests per day and 5 GB of storage. A personal planner uses a tiny fraction of that.
