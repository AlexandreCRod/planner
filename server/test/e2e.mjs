// End-to-end check against a running server (local `npm run dev` or a deployment).
// Usage: node test/e2e.mjs [baseUrl] [token]
// Note: it overwrites the server's data, so don't point it at your real deployment.
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://127.0.0.1:8787";
const token = process.argv[3] ?? "dev-token";

async function call(method, path, { body, auth = token, device = "e2e" } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json", "X-Device": device },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

// Same field layout the Android app's kotlinx-serialization backup produces.
const item = (id, title, extra = {}) => ({
  id, type: "TASK", title, content: "", categoryId: null, color: null, startDay: 20374, startMin: 540,
  endDay: null, endMin: null, allDay: false, freq: "DAILY", interval: 1, weekDays: 0, monthDays: "", months: 0,
  untilDay: null, excludedDays: "", overduePolicy: "SHOW_OVERDUE", parentId: null, noteDay: null, pinned: false,
  bgColor: null, bgPattern: 0, fontFamily: 0, createdAt: 1, updatedAt: 1, deletedAt: null, ...extra,
});
const snapshot = (items, extra = {}) => ({
  version: 1, createdAt: Date.now(), items,
  completions: [{ itemId: 1, day: 20374, completedAt: 5 }, { itemId: 1, day: 20375, completedAt: 6 }],
  reminders: [{ id: 1, itemId: 1, offsetMin: 0, type: "ALARM", soundUri: null }],
  categories: [{ id: 1, name: "Health", color: -1, defaultAlert: "ALARM" }],
  tags: [{ id: 1, name: "health" }], itemTags: [{ itemId: 1, tagId: 1 }],
  links: [{ sourceId: 1, targetId: 2, auto: false }], versions: [],
  ...extra,
});

const steps = [];
async function step(name, fn) {
  await fn();
  steps.push(name);
  console.log(`✔ ${name}`);
}

await step("rejects missing and wrong tokens", async () => {
  assert.equal((await call("GET", "/api/status", { auth: null })).status, 401);
  assert.equal((await call("GET", "/api/status", { auth: "nope" })).status, 401);
});

// Start from a clean slate (force) so the test can be re-run.
await call("PUT", "/api/snapshot?force=1", { body: snapshot([], { completions: [], reminders: [], categories: [], tags: [], itemTags: [], links: [] }) });
const startSeq = (await call("GET", "/api/status")).json.seq;

const three = [item(1, "Stretch"), item(2, "Read"), item(3, "Water plants")];
let seqAfterFirst;
await step("first push stores every record", async () => {
  const r = await call("PUT", "/api/snapshot", { body: snapshot(three) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.upserted, 3 + 2 + 1 + 1 + 1 + 1 + 1);
  seqAfterFirst = r.json.seq;
  const s = await call("GET", "/api/status");
  assert.equal(s.json.counts.items, 3);
  assert.equal(s.json.lastDevice, "e2e");
});

await step("identical push changes nothing", async () => {
  const r = await call("PUT", "/api/snapshot", { body: snapshot([...three].reverse()) });
  assert.deepEqual([r.json.upserted, r.json.deleted, r.json.seq], [0, 0, seqAfterFirst]);
});

await step("edit + delete produce exactly two changes", async () => {
  const edited = [item(1, "Stretch 10 min", { updatedAt: 2 }), item(2, "Read"), item(3, "Water plants")];
  const r = await call("PUT", "/api/snapshot", {
    body: snapshot(edited, { completions: [{ itemId: 1, day: 20374, completedAt: 5 }] }),
  });
  assert.deepEqual([r.json.upserted, r.json.deleted], [1, 1]);
  const c = await call("GET", `/api/changes?since=${seqAfterFirst}`);
  assert.equal(c.json.changes.length, 2);
  const byKind = Object.fromEntries(c.json.changes.map((x) => [x.kind, x]));
  assert.equal(byKind.items.data.title, "Stretch 10 min");
  assert.equal(byKind.completions.id, "1:20375");
  assert.equal(byKind.completions.data, null);
});

await step("change feed pages correctly", async () => {
  const p1 = await call("GET", `/api/changes?since=${startSeq}&limit=4`);
  assert.equal(p1.json.changes.length, 4);
  assert.equal(p1.json.more, true);
  const p2 = await call("GET", `/api/changes?since=${p1.json.seq}&limit=1000`);
  assert.equal(p2.json.more, false);
  assert.ok(p2.json.changes.every((x) => x.seq > p1.json.seq));
});

await step("download returns what the phone sent", async () => {
  const r = await call("GET", "/api/snapshot");
  assert.equal(r.json.items.length, 3);
  assert.equal(r.json.items.find((i) => i.id === 1).title, "Stretch 10 min");
  assert.deepEqual(r.json.items.find((i) => i.id === 2), item(2, "Read"));
  assert.equal(r.json.completions.length, 1);
  assert.deepEqual(r.json.links, [{ auto: false, sourceId: 1, targetId: 2 }]);
});

await step("guard refuses wiping all items", async () => {
  const empty = snapshot([]);
  const r = await call("PUT", "/api/snapshot", { body: empty });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /delete all 3/);
  assert.equal((await call("GET", "/api/status")).json.counts.items, 3);
});

await step("guard refuses deleting most of a larger store", async () => {
  const many = Array.from({ length: 25 }, (_, i) => item(i + 1, `Task ${i + 1}`));
  assert.equal((await call("PUT", "/api/snapshot", { body: snapshot(many) })).status, 200);
  const r = await call("PUT", "/api/snapshot", { body: snapshot(many.slice(0, 5)) });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /20 of 25/);
  const forced = await call("PUT", "/api/snapshot?force=1", { body: snapshot(many.slice(0, 5)) });
  assert.equal(forced.status, 200);
  assert.equal(forced.json.deleted, 20);
});

await step("daily safety copy is kept and readable", async () => {
  const h = await call("GET", "/api/history");
  assert.ok(h.json.length >= 1);
  const copy = await call("GET", `/api/history/${h.json[0].id}`);
  assert.ok(Array.isArray(copy.json.items));
  assert.equal((await call("GET", "/api/history/999999")).status, 404);
});

await step("rejects malformed bodies", async () => {
  assert.equal((await call("PUT", "/api/snapshot", { body: "{not json" })).status, 400);
  assert.equal((await call("PUT", "/api/snapshot", { body: { items: "x" } })).status, 400);
  assert.equal((await call("PUT", "/api/snapshot", { body: { completions: [{ itemId: 1 }] } })).status, 400);
  assert.equal((await call("GET", "/api/nope")).status, 404);
});

await step("two devices sync both ways", async () => {
  // Start empty, then the phone syncs its data for the first time.
  await call("PUT", "/api/snapshot?force=1", { body: snapshot([], { completions: [], reminders: [], categories: [], tags: [], itemTags: [], links: [] }) });
  const s0 = (await call("GET", "/api/status")).json.seq;
  const PHONE = { device: "Google Pixel 6a" };
  const PC = { device: "PC browser" };
  const phone = await call("POST", "/api/sync", { ...PHONE, body: { since: s0, changes: [
    { kind: "items", id: "1", data: item(1, "Stretch", { updatedAt: 10 }) },
    { kind: "items", id: "2", data: item(2, "Read", { updatedAt: 10 }) },
  ] } });
  assert.equal(phone.status, 200, JSON.stringify(phone.json));
  assert.deepEqual([phone.json.applied, phone.json.changes.length], [2, 0]);

  // The PC syncs from scratch: gets both items, and adds its own.
  const pc = await call("POST", "/api/sync", { ...PC, body: { since: 0, changes: [
    { kind: "items", id: "900", data: item(900, "From PC", { updatedAt: 20 }) },
  ] } });
  assert.deepEqual(pc.json.changes.filter((c) => c.kind === "items" && c.data).map((c) => c.data.title).sort(), ["Read", "Stretch"]);

  // Both edit item 1 offline; the PC's edit is newer but the phone's wins. The phone also deletes item 2.
  const pcEdit = await call("POST", "/api/sync", { ...PC, body: { since: pc.json.seq, changes: [
    { kind: "items", id: "1", data: item(1, "Stretch 15 min", { updatedAt: 40 }) },
  ] } });
  assert.equal(pcEdit.json.applied, 1);
  const phoneEdit = await call("POST", "/api/sync", { ...PHONE, body: { since: phone.json.seq, changes: [
    { kind: "items", id: "1", data: item(1, "Stretch 5 min", { updatedAt: 30 }) },
    { kind: "items", id: "2", data: null },
  ] } });
  assert.equal(phoneEdit.json.conflicts, 0, "the phone's edit wins over the PC's");
  const back = Object.fromEntries(phoneEdit.json.changes.filter((c) => c.kind === "items").map((c) => [c.id, c.data?.title]));
  assert.ok(!("1" in back), "phone keeps its own edit");
  assert.equal(back["900"], "From PC", "phone receives the PC's new item");
  assert.ok(!("2" in back), "phone's delete was applied, not echoed");

  // The PC catches up: gets the phone's edit and the delete.
  const pcPull = await call("POST", "/api/sync", { ...PC, body: { since: pcEdit.json.seq, changes: [] } });
  assert.deepEqual(pcPull.json.changes.map((c) => [c.kind, c.id, c.data?.title ?? null]), [["items", "1", "Stretch 5 min"], ["items", "2", null]]);

  // A later PC edit of the same item, made after it has seen the phone's, goes through normally.
  const pcAgain = await call("POST", "/api/sync", { ...PC, body: { since: pcPull.json.seq, changes: [
    { kind: "items", id: "1", data: item(1, "Stretch 10 min", { updatedAt: 50 }) },
  ] } });
  assert.deepEqual([pcAgain.json.applied, pcAgain.json.conflicts], [1, 0]);
  const final = await call("GET", "/api/snapshot");
  assert.deepEqual(final.json.items.map((i) => i.title).sort(), ["From PC", "Stretch 10 min"]);
  assert.equal(final.json.seq, pcAgain.json.seq);
});

console.log(`\nAll ${steps.length} end-to-end checks passed against ${base}`);
