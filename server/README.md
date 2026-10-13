# Planner sync server (Cloudflare Worker + Durable Object)

An optional cloud copy of your Planner data that runs on your own Cloudflare account.

## How it works

```
Phone (Room DB, main copy) ──PUT /api/snapshot──▶ Worker (auth + routing) ──RPC──▶ Durable Object "default"
                           ◀──GET /api/snapshot──                                    └─ built-in SQLite
```

- **Worker** (`src/index.ts`): a small program that Cloudflare runs on demand in its data centers. It checks the API token and forwards each request to the Durable Object.
- **Durable Object** (`src/store.ts`): a single named instance (`"default"`) with its own private SQLite database. All requests reach the same instance one at a time, so there are no race conditions.
  - Every record is stored as a row with a sequence number that increases on each change.
  - Deleted records are kept as markers ("tombstones"), so a future PC app can ask for "everything that changed since #N".
- **Safety:**
  - The server refuses a push that would delete everything, or more than half of 20+ items. That is what an accidental push from a freshly installed, empty app would look like.
  - It keeps one compressed full copy per day for 14 days.
  - Restoring on the phone first saves the current data as `before-restore.json`.

## Deploy (one time)

You need a free Cloudflare account and [Node.js](https://nodejs.org) 22 or newer.

```bash
cd server
npm install
npx wrangler login                      # opens the browser to sign in to Cloudflare
npx wrangler secret put API_TOKEN       # paste a long random string; this is your password
npx wrangler deploy                     # prints https://planner-sync.<you>.workers.dev
```

To generate a good token, run `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`.

Then open **Settings → Cloud sync** in the app. Turn it on, paste the URL and the token, and tap **Save**, then **Test**. After that, the app syncs about 30 seconds after any change, and every 6 hours as a fallback.

## Develop

```bash
npm test            # unit tests for the record/diff helpers
npm run typecheck
echo API_TOKEN=dev-token > .dev.vars && npm run dev   # local server on http://localhost:8787
```

## API

All requests need the header `Authorization: Bearer <API_TOKEN>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | Record counts, current sequence number, time of the last push |
| PUT | `/api/snapshot` | Upload the full snapshot (same JSON as an app backup). Add `?force=1` to bypass the deletion guard. |
| GET | `/api/snapshot` | Download the full snapshot |
| GET | `/api/changes?since=N&limit=1000` | Records changed after sequence N; deleted records have `data: null` |
| GET | `/api/history` | List of the server's daily safety copies |
| GET | `/api/history/:id` | Download one safety copy |

## Cost and limits

Durable Objects with SQLite storage are included in the Workers free plan: 100,000 requests per day and 5 GB of storage. A personal planner uses a tiny fraction of that.
