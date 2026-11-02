import assert from "node:assert/strict";
import { test } from "node:test";
import { type ActivityNote, gameNote, playedGames, runNote } from "../src/domain/cardio.ts";
import type { HealthSession } from "../src/domain/health.ts";
import { type Entry, PLAN_FILE, dayOf, logCsv, planFileId } from "../src/domain/training.ts";
import type { Run } from "../src/domain/trends.ts";
import { newItem } from "../src/domain/types.ts";

// The real store, with small stand-ins for what the browser gives it.
(globalThis as { window?: unknown }).window ??= { setTimeout: () => 0 };
const store = await import("../src/store/store.ts");
const { saveGameLog } = await import("../src/store/futsal.ts");
const { saveGameNote, saveRunNote, training } = await import("../src/store/training.ts");

const d = (iso: string) => dayOf(iso)!;
const plan = {
  version: 1, plan: { id: "p", start: "2026-10-26", end: "2026-11-08" },
  phases: [{ name: "W1", start: "2026-10-26", end: "2026-11-08", sessions: [{ id: "easy", kind: "run", title: "Easy run" }] }],
};
store.putRecords("trainingFiles", [{ id: planFileId("p", PLAN_FILE), planId: "p", file: PLAN_FILE, text: JSON.stringify(plan), updatedAt: 1 }]);
const day = d("2026-10-28");
const itemId = store.saveItem(newItem({ type: "EVENT", title: "Futsal Alvalade", startDay: day, endDay: day, allDay: true }));
const game = () => { const t = training(), g = t.games.find((x) => x.entry?.itemId === itemId); assert.ok(g); return g; };
const run = (o: Partial<Run>): Run => ({
  id: "hc:r", day, time: "07:00", title: "Run", sessionId: null, type: "other", source: "health_connect", distanceKm: 5, durationS: 1800, paceSPerKm: 360, avgHr: 140, maxHr: 170, cadenceSpm: null, ascentM: null, ...o,
});
const stored = () => [...training().entries.values()];
const records = () => store.listOf<ActivityNote>("trainingNotes");

test("a game's effort and pain go in its log, keep what else was logged, and reach the plan session's CSV", () => {
  const ref = { itemId, day };
  saveGameLog(ref, "p", { durationMin: 60, note: "Good game" });
  saveGameLog(ref, "p", { effort: 8 });
  saveGameLog(ref, "p", { pain: 2 });
  const e = game().entry!;
  assert.deepEqual([e.durationMin, e.note, e.effort, e.pain], [60, "Good game", 8, 2]);
  const rows = logCsv(training().plans[0].plan, training().entries.values()).split(/\r?\n/);
  assert.equal(rows[0].split(",").slice(5, 9).join(), "duration_min,pain_0_10,effort_1_10,note");
  const row = rows.find((r) => r.includes("Futsal Alvalade"));
  assert.ok(row?.includes(",60,2,8,Good game,"), row);
});

test("picking a rating off keeps the rest of the log; a game with nothing logged makes no log", () => {
  saveGameLog({ itemId, day }, "p", { pain: null });
  assert.equal(game().entry!.pain, null);
  assert.equal(game().entry!.effort, 8);
  const before = store.listOf<Entry>("trainingEntries").length;
  saveGameLog({ itemId, day: day + 7 }, "p", { effort: null });
  assert.equal(store.listOf<Entry>("trainingEntries").length, before);
});

test("a game's note saves in its log, not as a record", () => {
  saveGameNote(game(), "  Legs fresh ");
  assert.equal(gameNote(game(), training().notes), "Legs fresh");
  assert.equal(game().entry!.effort, 8);
  assert.equal(records().length, 0);
});

test("a watch-only run's note is a record of its own; clearing it is a soft delete that syncs", () => {
  const r = run({});
  saveRunNote(r, "Felt strong");
  assert.equal(runNote(r, stored(), training().notes), "Felt strong");
  assert.deepEqual(records().map((n) => [n.id, n.note, n.deletedAt]), [["hc:r", "Felt strong", null]]);
  saveRunNote(r, "   ");
  assert.equal(runNote(r, stored(), training().notes), "");
  assert.equal(records().length, 1);
  assert.notEqual(records()[0].deletedAt, null);
});

test("a run tied to a plan session writes its log, and a note kept from before moves there", () => {
  const before = run({ id: "hc:s" });
  saveRunNote(before, "Written before the tick");
  const linked = { ...before, sessionId: "easy" };
  saveRunNote(linked, "Written before the tick, then changed");
  assert.equal(runNote(linked, stored(), training().notes), "Written before the tick, then changed");
  assert.equal(training().stored.get("p:easy")?.note, "Written before the tick, then changed");
  assert.equal(training().stored.get("p:easy")?.status, "planned");       // a note doesn't tick the session
  assert.equal(training().notes.has("hc:s"), false);
});

test("a run whose session isn't in any plan keeps its note in a record", () => {
  const r = run({ id: "g:old", sessionId: "gone" });
  saveRunNote(r, "Old plan");
  assert.equal(training().notes.get("g:old")?.note, "Old plan");
  assert.equal(runNote(r, stored(), training().notes), "Old plan");
});

test("a watch session no event took is a game, and its note stays with it", () => {
  const s: HealthSession = {
    id: "hc:loose", day: d("2026-10-29"), time: "19:00", endTime: "20:00", startMs: 1, durationS: 3600, movingS: 0, exerciseType: "soccer", title: "", source: "garmin", distanceKm: null,
    ascentM: null, steps: null, kcal: 600, avgHr: 150, maxHr: 180, cadenceSpm: null, laps: [], splits: [], hr: [], updatedAt: 1,
  };
  store.putRecords("healthSessions", [s]);
  const loose = playedGames(training().games, d("2026-10-30")).find((g) => g.id === "hc:loose");
  assert.ok(loose);
  assert.equal(loose.title, "Futsal");
  saveGameNote(loose, "Pickup in the park");
  assert.equal(gameNote(training().games.find((g) => g.id === "hc:loose")!, training().notes), "Pickup in the park");
});

test("a note on a watch-only game stays once the game gets its event, and moves into the log on the next save", () => {
  const on = d("2026-10-30");
  const s: HealthSession = {
    id: "hc:later", day: on, time: "19:00", endTime: "20:00", startMs: 1, durationS: 3600, movingS: 0, exerciseType: "soccer", title: "", source: "garmin", distanceKm: null,
    ascentM: null, steps: null, kcal: 600, avgHr: 150, maxHr: 180, cadenceSpm: null, laps: [], splits: [], hr: [], updatedAt: 1,
  };
  store.putRecords("healthSessions", [s]);
  saveGameNote(training().games.find((g) => g.id === "hc:later")!, "Written before the event");
  const event = store.saveItem(newItem({ type: "EVENT", title: "Futsal", startDay: on, endDay: on, allDay: true }));
  const now = () => { const g = training().games.find((x) => x.entry?.itemId === event); assert.ok(g); return g; };
  assert.equal(now().session?.id, "hc:later");
  assert.equal(gameNote(now(), training().notes), "Written before the event");
  saveGameNote(now(), "Changed after");
  assert.equal(now().entry!.note, "Changed after");
  assert.equal(gameNote(now(), training().notes), "Changed after");
  assert.equal(training().notes.has("hc:later"), false);
  const row = logCsv(training().plans[0].plan, training().entries.values()).split(/\r?\n/).find((r) => r.includes("Changed after"));
  assert.ok(row, "the log's note reaches the CSV");
});

test("a run whose session left the plan edits the note in its log: the new text is what shows", () => {
  const e = { id: "p:dropped", planId: "p", sessionId: "dropped", kind: "session", day, status: "done", doneDay: day, durationMin: null, pain: null, effort: null, note: "Old text", ticks: [], title: "Dropped", detail: "", updatedAt: 1, deletedAt: null };
  store.putRecords("trainingEntries", [e]);
  const r = run({ id: "hc:dropped", sessionId: "dropped" });
  assert.equal(runNote(r, stored(), training().notes), "Old text");
  saveRunNote(r, "New text");
  assert.equal(runNote(r, stored(), training().notes), "New text");
  assert.equal(training().stored.get("p:dropped")?.note, "New text");
  assert.equal(training().stored.get("p:dropped")?.status, "done");
  assert.equal(training().notes.has("hc:dropped"), false);
});
