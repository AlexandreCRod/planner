// End-to-end check against a running server (local `npm run dev` or a deployment).
// Usage: node test/e2e.mjs [baseUrl] [token]
// Note: it overwrites the server's data, so don't point it at your real deployment.
import assert from "node:assert/strict";
// The app's own sync steps (item 141), so the conflict checks below run the real app code.
import { outgoingChanges, settleReply } from "../../web/src/domain/syncMerge.ts";

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
await call("PUT", "/api/snapshot?force=1", { body: snapshot([], { completions: [], reminders: [], categories: [], tags: [], itemTags: [], links: [], images: [], trainingEntries: [], trainingFiles: [] }) });
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
  await call("PUT", "/api/snapshot?force=1", { body: snapshot([], { completions: [], reminders: [], categories: [], tags: [], itemTags: [], links: [], images: [], trainingEntries: [], trainingFiles: [] }) });
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

await step("item 141: note edits merge field by field, and both versions are kept on a clash", async () => {
  await call("PUT", "/api/snapshot?force=1", { body: snapshot([], { completions: [], reminders: [], categories: [], tags: [], itemTags: [], links: [], images: [], trainingEntries: [], trainingFiles: [] }) });
  const PHONE = { device: "Google Pixel 6a" };
  const PC = { device: "PC browser" };
  const note = (extra = {}) => item(50, "Shopping", { type: "NOTE", freq: "NONE", startDay: null, startMin: null, content: "<p>milk</p>", categoryId: 4, updatedAt: 10, ...extra });
  const b0 = note();
  const s0 = (await call("GET", "/api/status")).json.seq;
  const first = await call("POST", "/api/sync", { ...PHONE, body: { since: s0, changes: [
    { kind: "items", id: "50", data: b0 }, { kind: "itemTags", id: "50:8", data: { itemId: 50, tagId: 8 } },
  ] } });
  assert.ok(first.json.features.includes("baseMerge"));
  const since = first.json.seq;

  // One device renames the note, the other pins it: both stand, no copy.
  const pcTitle = await call("POST", "/api/sync", { ...PC, body: { since, changes: [{ kind: "items", id: "50", data: note({ title: "Groceries", updatedAt: 20 }), base: b0 }] } });
  assert.deepEqual([pcTitle.json.applied, pcTitle.json.copies], [1, 0]);
  const phonePin = await call("POST", "/api/sync", { ...PHONE, body: { since, changes: [{ kind: "items", id: "50", data: note({ pinned: true, pinOrder: 1, updatedAt: 15 }), base: b0 }] } });
  assert.deepEqual([phonePin.json.conflicts, phonePin.json.copies], [0, 0]);
  const merged = note({ title: "Groceries", pinned: true, pinOrder: 1, updatedAt: 20 });
  const back = phonePin.json.changes.find((c) => c.kind === "items" && c.id === "50");
  assert.deepEqual(back?.data, merged, "the phone gets the merged note back");
  let notes = (await call("GET", "/api/snapshot")).json.items;
  assert.deepEqual(notes, [merged]);

  // Both edit the content: the phone's wins, and the PC's is kept as a conflicted copy with the same tags.
  const since2 = phonePin.json.seq;
  const pcText = await call("POST", "/api/sync", { ...PC, body: { since: since2, changes: [{ kind: "items", id: "50", data: { ...merged, content: "<p>milk, bread</p>", updatedAt: 40 }, base: merged }] } });
  assert.equal(pcText.json.copies, 0);
  const phoneText = await call("POST", "/api/sync", { ...PHONE, body: { since: since2, changes: [{ kind: "items", id: "50", data: { ...merged, content: "<p>milk, eggs</p>", updatedAt: 30 }, base: merged }] } });
  assert.deepEqual([phoneText.json.conflicts, phoneText.json.copies], [1, 1]);
  const snap = (await call("GET", "/api/snapshot")).json;
  const original = snap.items.find((i) => i.id === 50);
  const copy = snap.items.find((i) => i.id !== 50);
  assert.equal(original.content, "<p>milk, eggs</p>", "the phone's edit wins");
  assert.equal(original.updatedAt, 40);
  assert.deepEqual([copy.title, copy.content, copy.categoryId, copy.type, copy.pinned], ["Groceries (conflicted copy)", "<p>milk, bread</p>", 4, "NOTE", false]);
  assert.deepEqual(snap.itemTags.map((t) => `${t.itemId}:${t.tagId}`).sort(), ["50:8", `${copy.id}:8`].sort());
  assert.ok(phoneText.json.changes.some((c) => c.kind === "items" && c.data?.id === copy.id), "the syncing device receives the copy");
  const pcPull = await call("POST", "/api/sync", { ...PC, body: { since: pcText.json.seq, changes: [] } });
  assert.deepEqual(pcPull.json.changes.filter((c) => c.kind === "items").map((c) => c.data.title).sort(), ["Groceries", "Groceries (conflicted copy)"], "and so does the other");

  // An edit made while a sync was out: the app sent v1 (title), the PC pinned off meanwhile, then the app
  // sends v2 (content typed during the first request) against v1. Nothing is lost.
  const cur = original;
  const s3 = pcPull.json.seq;
  const v1 = { ...cur, title: "Weekly shop", updatedAt: 50 };
  const r1 = await call("POST", "/api/sync", { ...PHONE, body: { since: s3, changes: [{ kind: "items", id: "50", data: v1, base: cur }] } });
  await call("POST", "/api/sync", { ...PC, body: { since: s3, changes: [{ kind: "items", id: "50", data: { ...cur, pinned: false, pinOrder: undefined, updatedAt: 45 }, base: cur }] } });
  const v2 = { ...v1, content: "<p>milk, eggs, tea</p>", updatedAt: 55 };
  const r2 = await call("POST", "/api/sync", { ...PHONE, body: { since: r1.json.seq, changes: [{ kind: "items", id: "50", data: v2, base: v1 }] } });
  assert.deepEqual([r2.json.conflicts, r2.json.copies], [0, 0]);
  const end = (await call("GET", "/api/snapshot")).json.items.find((i) => i.id === 50);
  assert.deepEqual([end.title, end.content, end.pinned, end.pinOrder, end.updatedAt], ["Weekly shop", "<p>milk, eggs, tea</p>", false, undefined, 55]);
  assert.equal(r2.json.changes.find((c) => c.id === "50")?.data.pinned, false, "the app receives the PC's unpin");

  // An older app (no base) keeps the old rules: its whole note wins or loses, and no copy is made.
  const s4 = r2.json.seq;
  await call("POST", "/api/sync", { ...PC, body: { since: s4, changes: [{ kind: "items", id: "50", data: { ...end, content: "<p>from the PC</p>", updatedAt: 70 } }] } });
  const old = await call("POST", "/api/sync", { ...PHONE, body: { since: s4, changes: [{ kind: "items", id: "50", data: { ...end, title: "Old phone", updatedAt: 60 } }] } });
  assert.deepEqual([old.json.conflicts, old.json.copies], [0, 0]);
  const after = (await call("GET", "/api/snapshot")).json.items;
  assert.equal(after.length, 2, "no new copy");
  assert.deepEqual([after.find((i) => i.id === 50).title, after.find((i) => i.id === 50).content], ["Old phone", "<p>milk, eggs, tea</p>"], "phone wins whole, as before");
});

// A device running the app's sync steps: its records ("kind/id" → record) and its synced copy.
const EMPTY = { completions: [], reminders: [], categories: [], tags: [], itemTags: [], links: [], images: [], trainingEntries: [], trainingFiles: [] };
function device(name, seq) { return { name, base: { seq, records: {} }, local: new Map() }; }
/** One sync of [d] as the app does it; [during] edits its records while the request is out. */
async function appSync(d, during) {
  const sent = new Map(d.local);
  const { outgoing } = outgoingChanges(d.base, sent, { withBase: true, takes: () => true, maxChars: 1_000_000 });
  const reply = await call("POST", "/api/sync", { device: d.name, body: { since: d.base.seq, changes: outgoing } });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  during?.(d.local);
  const { apply, next } = settleReply(d.base, sent, d.local, outgoing, reply.json);
  for (const c of apply) { const k = `${c.kind}/${c.id}`; if (c.data === null) d.local.delete(k); else d.local.set(k, c.data); }
  d.base = next;
  return reply.json;
}
const edit = (d, id, fields) => { const k = `items/${id}`; d.local.set(k, { ...d.local.get(k), ...fields }); };
const items = async () => (await call("GET", "/api/snapshot")).json.items;

await step("item 141 review: the second round after an edit during a sync, through the app's own code", async () => {
  await call("PUT", "/api/snapshot?force=1", { body: snapshot([], EMPTY) });
  const s0 = (await call("GET", "/api/status")).json.seq;
  const phone = device("Google Pixel 6a", s0), pc = device("PC browser", s0);
  phone.local.set("items/60", item(60, "Shopping", { type: "NOTE", freq: "NONE", content: "<p>milk</p>", updatedAt: 10 }));
  await appSync(phone);
  await appSync(pc);
  assert.equal(pc.local.get("items/60").content, "<p>milk</p>");
  edit(phone, 60, { content: "<p>phone</p>", updatedAt: 20 });
  await appSync(phone);
  // The PC's edit loses to the phone's; more is typed on the PC while that sync is out.
  edit(pc, 60, { content: "<p>pc 1</p>", updatedAt: 30 });
  const r1 = await appSync(pc, (local) => edit({ local }, 60, { content: "<p>pc 1 and 2</p>", updatedAt: 31 }));
  assert.deepEqual([r1.conflicts, r1.copies], [1, 1]);
  assert.deepEqual(pc.base.mine, ["items/60"]);
  assert.equal(pc.local.get("items/60").content, "<p>pc 1 and 2</p>", "the typing stays on screen");
  const r2 = await appSync(pc);
  assert.equal(r2.copies, 1, "the stored text is kept once, as a copy");
  const r3 = await appSync(pc);
  assert.deepEqual([r3.copies, r3.applied], [0, 0], "and nothing more after");
  await appSync(phone);
  const contents = (await items()).map((i) => [i.id === 60 ? "main" : "copy", i.content]).sort();
  assert.deepEqual(contents, [["copy", "<p>pc 1</p>"], ["copy", "<p>phone</p>"], ["main", "<p>pc 1 and 2</p>"]], "nothing lost");
  assert.deepEqual([...phone.local.values()].map((r) => r.content).sort(), contents.map((c) => c[1]).sort(), "the phone has it all");
});

await step("item 141 review: a lost reply sent again makes no second copy, and the phone still wins", async () => {
  await call("PUT", "/api/snapshot?force=1", { body: snapshot([], EMPTY) });
  const s0 = (await call("GET", "/api/status")).json.seq;
  const b0 = item(61, "Plan", { type: "NOTE", freq: "NONE", content: "<p>a</p>", updatedAt: 10 });
  await call("POST", "/api/sync", { device: "Pixel", body: { since: s0, changes: [{ kind: "items", id: "61", data: b0 }] } });
  const s1 = (await call("GET", "/api/status")).json.seq;
  await call("POST", "/api/sync", { device: "Pixel", body: { since: s1, changes: [{ kind: "items", id: "61", data: { ...b0, content: "<p>phone</p>", updatedAt: 20 }, base: b0 }] } });
  // The PC's clashing edit, with a pin: the phone's text stays, the pin merges in (a write by the PC).
  const body = { since: s1, changes: [{ kind: "items", id: "61", data: { ...b0, content: "<p>pc</p>", pinned: true, updatedAt: 99 }, base: b0 }] };
  const first = await call("POST", "/api/sync", { device: "PC browser", body });
  assert.deepEqual([first.json.copies, first.json.applied], [1, 2]);
  const again = await call("POST", "/api/sync", { device: "PC browser", body }); // its reply was lost
  assert.deepEqual([again.json.copies, again.json.applied], [0, 0]);
  assert.equal((await items()).length, 2, "one copy");
  assert.ok(again.json.changes.some((c) => c.kind === "items" && c.data.title === "Plan (conflicted copy)"), "the retry still receives the copy");
  // The merged write kept the phone's mark: another PC with an old copy and a later edit still loses.
  const other = await call("POST", "/api/sync", { device: "PC browser", body: { since: s1, changes: [{ kind: "items", id: "61", data: { ...b0, content: "<p>pc 2</p>", updatedAt: 500 }, base: b0 }] } });
  assert.equal(other.json.copies, 1);
  const main = (await items()).find((i) => i.id === 61);
  assert.deepEqual([main.content, main.pinned], ["<p>phone</p>", true]);
});

await step("item 141 review: daily notes' copies are plain notes; an edit beats a trashing", async () => {
  await call("PUT", "/api/snapshot?force=1", { body: snapshot([], EMPTY) });
  const s0 = (await call("GET", "/api/status")).json.seq;
  const daily = item(62, "", { type: "NOTE", freq: "NONE", startDay: null, noteDay: 20391, content: "<p>day</p>", updatedAt: 10 });
  const plain = item(63, "Ideas", { type: "NOTE", freq: "NONE", content: "<p>x</p>", updatedAt: 10 });
  const r0 = await call("POST", "/api/sync", { device: "Pixel", body: { since: s0, changes: [{ kind: "items", id: "62", data: daily }, { kind: "items", id: "63", data: plain }] } });
  await call("POST", "/api/sync", { device: "Pixel", body: { since: r0.json.seq, changes: [
    { kind: "items", id: "62", data: { ...daily, content: "<p>phone</p>", updatedAt: 20 }, base: daily },
    { kind: "items", id: "63", data: { ...plain, deletedAt: 25, updatedAt: 25 }, base: plain },
  ] } });
  const pc = await call("POST", "/api/sync", { device: "PC browser", body: { since: r0.json.seq, changes: [
    { kind: "items", id: "62", data: { ...daily, content: "<p>pc</p>", updatedAt: 30 }, base: daily },
    { kind: "items", id: "63", data: { ...plain, content: "<p>x and more</p>", updatedAt: 30 }, base: plain },
  ] } });
  assert.equal(pc.json.copies, 1);
  const all = await items();
  assert.deepEqual(all.filter((i) => i.noteDay === 20391).map((i) => i.content), ["<p>phone</p>"], "still one daily note for the day");
  const copy = all.find((i) => ![62, 63].includes(i.id));
  assert.deepEqual([copy.title, copy.noteDay, copy.content], ["30 Oct 2025 (conflicted copy)", null, "<p>pc</p>"]);
  const kept = all.find((i) => i.id === 63);
  assert.deepEqual([kept.deletedAt, kept.content], [null, "<p>x and more</p>"], "the edited note is out of the trash");
});

await step("image files: stored by hash, synced as records", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const put = (h, body, type = "image/jpeg") =>
    fetch(`${base}/api/blobs/${h}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": type }, body });
  assert.equal((await put(hash, bytes)).status, 200);
  assert.equal((await put(hash, bytes)).status, 200, "same file again is fine");
  assert.equal((await put("0".repeat(64), bytes)).status, 400, "hash must match the bytes");
  assert.equal((await put(hash, bytes, "text/plain")).status, 415);
  assert.equal((await fetch(`${base}/api/blobs/${hash}`)).status, 401);
  const got = await fetch(`${base}/api/blobs/${hash}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(got.headers.get("Content-Type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), bytes);
  assert.equal((await fetch(`${base}/api/blobs/${"a".repeat(64)}`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);

  const s0 = (await call("GET", "/api/status")).json.seq;
  const image = { id: 77, itemId: 1, hash, mime: "image/jpeg", width: 4, height: 3, createdAt: 1 };
  const r = await call("POST", "/api/sync", { body: { since: s0, changes: [{ kind: "images", id: "77", data: image }] } });
  assert.equal(r.json.applied, 1);
  assert.deepEqual((await call("GET", "/api/snapshot")).json.images, [image]);
});

await step("newer record kinds sync with no Worker change, and the reply lists the features", async () => {
  const status = (await call("GET", "/api/status")).json;
  assert.ok(status.features.includes("anyKind"));
  const entry = { id: "hm:t004", planId: "hm", sessionId: "t004", day: 20390, status: "planned", updatedAt: 5 };
  const r = await call("POST", "/api/sync", { device: "Pixel", body: { since: status.seq, changes: [{ kind: "trainingEntries", id: "hm:t004", data: entry }] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.features.includes("anyKind"));
  assert.deepEqual((await call("GET", "/api/snapshot")).json.trainingEntries, [entry]);
  // An older app's push carries only the kinds it knows: the training records stay.
  await call("PUT", "/api/snapshot?force=1", { body: snapshot([item(1, "Stretch")]) });
  assert.deepEqual((await call("GET", "/api/snapshot")).json.trainingEntries, [entry]);
  // The plan script's files: a plain record kind too.
  const file = { id: "hm:planner.json", planId: "hm", file: "planner.json", text: "{}", pushedAt: 1 };
  const s1 = (await call("GET", "/api/status")).json.seq;
  const f = await call("POST", "/api/sync", { device: "plan-script", body: { since: s1, changes: [{ kind: "trainingFiles", id: file.id, data: file }] } });
  assert.equal(f.json.applied, 1);
});

await step("a record over 1 MB is refused by name, with 413", async () => {
  const s0 = (await call("GET", "/api/status")).json.seq;
  const big = { id: "hm:Big.md", text: "x".repeat(1_000_001) };
  const r = await call("POST", "/api/sync", { body: { since: s0, changes: [{ kind: "trainingFiles", id: big.id, data: big }] } });
  assert.equal(r.status, 413);
  assert.match(r.json.error, /trainingFiles\/hm:Big\.md/);
});

await step("the deletion guard ignores items already in the trash", async () => {
  const many = Array.from({ length: 30 }, (_, i) => item(1000 + i, `Old ${i}`, { deletedAt: 1 }));
  await call("PUT", "/api/snapshot?force=1", { body: snapshot([item(1, "Stretch"), ...many]) });
  const s0 = (await call("GET", "/api/status")).json.seq;
  // Emptying the trash: 30 deletes of trashed items go through.
  const purge = await call("POST", "/api/sync", { body: { since: s0, changes: many.map((m) => ({ kind: "items", id: String(m.id), data: null })) } });
  assert.equal(purge.status, 200, JSON.stringify(purge.json));
  // Deleting most live items is still refused, until forced.
  const live = Array.from({ length: 24 }, (_, i) => item(2000 + i, `Live ${i}`));
  await call("PUT", "/api/snapshot?force=1", { body: snapshot(live) });
  const s1 = (await call("GET", "/api/status")).json.seq;
  const wipe = { since: s1, changes: live.slice(0, 20).map((m) => ({ kind: "items", id: String(m.id), data: null })) };
  assert.equal((await call("POST", "/api/sync", { body: wipe })).status, 409);
  assert.equal((await call("POST", "/api/sync?force=1", { body: wipe })).status, 200);
});

await step("web link previews: need the token, refuse private and non-http addresses (all offline)", async () => {
  const q = (u) => `/api/preview?url=${encodeURIComponent(u)}`;
  assert.equal((await call("GET", q("https://example.com/"), { auth: null })).status, 401);
  for (const bad of ["http://127.0.0.1:8787/api/status", "http://localhost/", "http://[::1]/", "http://169.254.169.254/", "ftp://example.com/", "javascript:alert(1)", "nope"]) {
    const r = await call("GET", q(bad));
    assert.equal(r.status, 400, bad);
    assert.ok(r.json.error);
  }
  assert.equal((await call("GET", "/api/preview")).status, 400);
});

await step("place links: need the token, only Google Maps short links are accepted (all offline)", async () => {
  const q = (u) => `/api/resolve-place?url=${encodeURIComponent(u)}`;
  assert.equal((await call("GET", q("https://maps.app.goo.gl/abc"), { auth: null })).status, 401);
  for (const bad of ["https://example.com/maps", "http://127.0.0.1/", "https://goo.gl/other", "https://maps.app.goo.gl.evil.com/x", "nope"]) {
    const r = await call("GET", q(bad));
    assert.equal(r.status, 400, bad);
    assert.ok(r.json.error);
  }
  assert.equal((await call("GET", "/api/resolve-place")).status, 400);
});

console.log(`\nAll ${steps.length} end-to-end checks passed against ${base}`);
