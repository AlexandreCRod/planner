import assert from "node:assert/strict";
import { test } from "node:test";
import type { HealthSession } from "../src/domain/health.ts";
import {
  hiddenRunId, hiddenWatchRuns, isRunSession, mergedRuns, runOfSession, runTypeOf, sameRun, sourceRank, tickedEntry, typedRuns, untickedEntry,
  watchLinks, watchRunSteps,
} from "../src/domain/healthRuns.ts";
import { type Entry, dayOf, entryId, newEntry, readPlan } from "../src/domain/training.ts";
import type { Run } from "../src/domain/trends.ts";

const d = (iso: string) => dayOf(iso)!;

const hc = (over: Partial<HealthSession> = {}): HealthSession => ({
  id: "hc:a", day: d("2026-10-28"), time: "07:00", endTime: "07:52", startMs: 0, durationS: 3120, movingS: 3000,
  exerciseType: "running", title: "", source: "com.garmin.android.apps.connectmobile", distanceKm: 8, ascentM: 40, steps: 8400,
  kcal: 600, avgHr: 150, maxHr: 171, cadenceSpm: 168, laps: [], splits: [{ km: 1, s: 375, hr: 140 }], hr: [], updatedAt: 1, ...over,
});

const run = (over: Partial<Run> = {}): Run => ({
  id: "g1", day: d("2026-10-28"), time: "07:01", title: "Morning Run", sessionId: null, type: "easy", source: "garmin_export",
  distanceKm: 8.1, durationS: 3100, paceSPerKm: 380, avgHr: 151, maxHr: 170, cadenceSpm: 167, ascentM: 38, ...over,
});

test("a running session as a run: pace from moving time, its splits kept, source health_connect", () => {
  const r = runOfSession(hc());
  assert.equal(r.id, "hc:a");
  assert.equal(r.source, "health_connect");
  assert.equal(r.paceSPerKm, 375);           // 3000 s over 8 km
  assert.equal(r.durationS, 3120);
  assert.equal(r.movingS, 3000);
  assert.equal(r.cadenceSpm, 168);
  assert.equal(r.ascentM, 40);
  assert.equal(r.maxHr, 171);
  assert.deepEqual(r.splits, [{ km: 1, s: 375, hr: 140 }]);
  assert.equal(r.title, "Run");
  assert.equal(r.type, "other");
  assert.equal(runOfSession(hc({ exerciseType: "running_treadmill" })).title, "Treadmill run");
  assert.equal(runOfSession(hc({ distanceKm: null })).paceSPerKm, null);
  assert.equal(runOfSession(hc({ movingS: 0 })).paceSPerKm, 390);   // no moving time: the whole duration
});

test("which sessions are runs", () => {
  for (const [type, yes] of [["running", true], ["running_treadmill", true], ["walking", false], ["soccer", false], ["strength_training", false]] as const) {
    assert.equal(isRunSession({ exerciseType: type }), yes, type);
  }
});

test("source priority: Health Connect, Garmin (export or account), Strava, the rest", () => {
  assert.deepEqual(["health_connect", "garmin_export", "garmin_account", "strava", null, "other"].map(sourceRank), [0, 1, 1, 2, 3, 3]);
});

test("the same run: starts within 2 minutes and distances within 5%", () => {
  const cases: [Partial<Run>, Partial<Run>, boolean][] = [
    [{ time: "07:00" }, { time: "07:02" }, true],
    [{ time: "07:00" }, { time: "07:03" }, false],
    [{ time: "23:59" }, { time: "00:00", day: d("2026-10-29") }, true],     // over midnight
    [{ distanceKm: 8 }, { distanceKm: 8.4 }, true],                          // 4.8%
    [{ distanceKm: 8 }, { distanceKm: 8.5 }, false],                         // 5.9%
    [{ time: null }, { time: "07:00" }, true],                               // no time: same day and distance
    [{ time: null }, { time: "07:00", day: d("2026-10-27") }, false],
    [{ time: null, distanceKm: null }, { time: "07:00" }, false],            // nothing to go by
    [{ distanceKm: null }, { time: "07:01" }, true],                         // no distance: the time decides
  ];
  for (const [a, b, same] of cases) assert.equal(sameRun(run({ time: "07:00", distanceKm: 8, ...a }), run({ time: "07:00", distanceKm: 8, ...b })), same, JSON.stringify([a, b]));
});

test("merged runs: one copy each, Health Connect first, the plan session's session and type carried", () => {
  const table: { name: string; json: Run[]; hcs: HealthSession[]; ids: string[] }[] = [
    { name: "nothing", json: [], hcs: [], ids: [] },
    { name: "runs.json only", json: [run()], hcs: [], ids: ["g1"] },
    { name: "watch only", json: [], hcs: [hc()], ids: ["hc:a"] },
    { name: "the same run twice: Health Connect's kept", json: [run()], hcs: [hc()], ids: ["hc:a"] },
    { name: "different runs both kept, oldest first", json: [run({ day: d("2026-10-27") })], hcs: [hc()], ids: ["g1", "hc:a"] },
    { name: "Garmin over Strava", json: [run({ id: "s1", source: "strava" }), run()], hcs: [], ids: ["g1"] },
    { name: "Garmin account counts as the export", json: [run({ id: "s1", source: "strava" }), run({ source: "garmin_account" })], hcs: [], ids: ["g1"] },
    { name: "walks aren't runs", json: [], hcs: [hc({ exerciseType: "walking" })], ids: [] },
    { name: "two runs a day, an hour apart", json: [run({ time: "18:00" })], hcs: [hc()], ids: ["hc:a", "g1"] },
    { name: "two apps wrote the same run to Health Connect", json: [], hcs: [hc(), hc({ id: "hc:b", time: "07:01", source: "com.strava" })], ids: ["hc:a"] },
  ];
  for (const t of table) assert.deepEqual(mergedRuns(t.json, t.hcs).map((r) => r.id), t.ids, t.name);

  const [m] = mergedRuns([run({ sessionId: "w1-easy", type: "long" })], [hc()]);
  assert.equal(m.source, "health_connect");
  assert.equal(m.sessionId, "w1-easy");
  assert.equal(m.type, "long");
  assert.equal(m.paceSPerKm, 375);
  assert.equal(mergedRuns([run({ sessionId: "w1-easy" })], [hc()], new Map([["hc:a", "w1-long"]]))[0].sessionId, "w1-long");   // the tick's link wins
});

test("a linked watch run takes its session's type", () => {
  const { plan } = readPlan({
    version: 1, plan: { id: "p", start: "2026-10-26", end: "2026-11-01" },
    phases: [{ name: "W1", start: "2026-10-26", end: "2026-11-01", sessions: [
      { id: "e", kind: "run", title: "Easy run" }, { id: "l", kind: "run", title: "Long run" },
      { id: "q", kind: "run", title: "Tempo", tags: ["quality"] }, { id: "r", kind: "run", title: "Race", day_type: "race" },
      { id: "g", kind: "gym", title: "Gym" },
    ] }],
  });
  const s = (id: string) => plan!.phases[0].sessions.find((x) => x.id === id)!;
  assert.deepEqual(["e", "l", "q", "r"].map((id) => runTypeOf(s(id))), ["easy", "long", "quality", "race"]);
  const runs = [run({ id: "1", type: "other", sessionId: "l" }), run({ id: "2", type: "easy", sessionId: "l" }), run({ id: "3", type: "other", sessionId: "g" }), run({ id: "4", type: "other" })];
  assert.deepEqual(typedRuns(runs, [plan!]).map((r) => r.type), ["long", "easy", "other", "other"]);
});

// ---------- The watch run ticks its session ----------

const week = readPlan({
  version: 1, plan: { id: "p", start: "2026-10-26", end: "2026-11-08" },
  phases: [
    { name: "W1", start: "2026-10-26", end: "2026-11-01", sessions: [
      { id: "easy", kind: "run", title: "Easy run", default_date: "2026-10-28" },
      { id: "tempo", kind: "run", title: "Tempo", default_date: "2026-10-30", tags: ["quality"] },
      { id: "long", kind: "run", title: "Long run", default_date: "2026-11-01", locked: true },
      { id: "free", kind: "run", title: "Easy run 2" },
      { id: "gym", kind: "gym", title: "Gym", default_date: "2026-10-29" },
    ] },
    { name: "W2", start: "2026-11-02", end: "2026-11-08", sessions: [{ id: "w2easy", kind: "run", title: "Easy", default_date: "2026-11-03" }] },
  ],
}).plan!;
const sess = (id: string) => week.phases.flatMap((p) => p.sessions).find((s) => s.id === id)!;
const entry = (sid: string, over: Partial<Entry>): Entry => newEntry({ id: entryId("p", sid), planId: "p", kind: "session", sessionId: sid, ...over });
const watch = (iso: string, over: Partial<HealthSession> = {}) => runOfSession(hc({ id: `hc:${iso}`, day: d(iso), ...over }));
const T = d("2026-11-05");

test("a watch run: one run session that day ticks it; two or none ask; used or hidden ones do nothing", () => {
  const two = new Map([[entryId("p", "free"), entry("free", { day: d("2026-10-28") })]]);
  const table: { name: string; runs: ReturnType<typeof watch>[]; entries?: Map<string, Entry>; hidden?: Set<string>; want: string[] }[] = [
    { name: "one run session that day: tick", runs: [watch("2026-10-28")], want: ["tick easy"] },
    { name: "the plan's locked day counts", runs: [watch("2026-11-01")], want: ["tick long"] },
    { name: "no run session that day (the gym's day): ask", runs: [watch("2026-10-29")], want: ["ask easy,tempo,long,free"] },
    { name: "two run sessions that day: ask", runs: [watch("2026-10-28")], entries: two, want: ["ask easy,free,tempo,long"] },
    { name: "already done: nothing", runs: [watch("2026-10-28")], entries: new Map([[entryId("p", "easy"), entry("easy", { status: "done", day: d("2026-10-28"), doneDay: d("2026-10-28") })]]), want: [] },
    { name: "skipped doesn't count as on the day: ask", runs: [watch("2026-10-28")], entries: new Map([[entryId("p", "easy"), entry("easy", { status: "skipped", day: d("2026-10-28") })]]), want: ["ask tempo,long,free"] },
    { name: "unticked before: nothing", runs: [watch("2026-10-28")], entries: new Map([[entryId("p", "easy"), entry("easy", { day: d("2026-10-28"), watchRunsDismissed: ["hc:2026-10-28"] })]]), want: [] },
    { name: "linked already: nothing", runs: [watch("2026-10-28")], entries: new Map([[entryId("p", "tempo"), entry("tempo", { status: "done", watchRunId: "hc:2026-10-28" })]]), want: [] },
    { name: "not a plan run: nothing", runs: [watch("2026-10-29")], hidden: new Set(["hc:2026-10-29"]), want: [] },
    { name: "matched by the plan session (runs.json): nothing", runs: [{ ...watch("2026-10-29"), sessionId: "tempo" }], want: [] },
    { name: "before the plan, or not yet run: nothing", runs: [watch("2026-10-20"), watch("2026-11-06")], want: [] },
    { name: "runs.json's own runs never tick", runs: [{ ...watch("2026-10-28"), id: "g1", source: "garmin_export" }], want: [] },
    { name: "a second run that day finds it done", runs: [watch("2026-10-28"), watch("2026-10-28", { id: "hc:b", time: "18:00" })], want: ["tick easy"] },
    { name: "the next phase asks for its own sessions", runs: [watch("2026-11-04")], want: ["ask w2easy"] },
  ];
  for (const t of table) {
    const got = watchRunSteps(week, t.entries ?? new Map(), t.runs, t.hidden ?? new Set(), T)
      .map((x) => (x.kind === "tick" ? `tick ${x.session.id}` : `ask ${x.choices.map((s) => s.id).join(",")}`));
    assert.deepEqual(got, t.want, t.name);
  }
});

test("a tick: done on the run's day, its moving time, linked; an untick remembers the run", () => {
  const r = watch("2026-10-28");
  const e = tickedEntry(week, sess("easy"), new Map(), r);
  assert.equal(e.id, "p:easy");
  assert.equal(e.status, "done");
  assert.equal(e.doneDay, d("2026-10-28"));
  assert.equal(e.day, d("2026-10-28"));
  assert.equal(e.durationMin, 50);
  assert.equal(e.watchRunId, "hc:2026-10-28");
  // Picked for a session placed on another day: it moves to the run's day; a locked one keeps its own.
  assert.equal(tickedEntry(week, sess("tempo"), new Map(), r).day, d("2026-10-28"));
  assert.equal(tickedEntry(week, sess("long"), new Map(), r).day, d("2026-11-01"));
  assert.deepEqual(untickedEntry(e), { watchRunId: null, watchRunsDismissed: ["hc:2026-10-28"] });
  assert.deepEqual(untickedEntry({ ...e, watchRunId: null }), {});
  assert.deepEqual(watchLinks([e]), new Map([["hc:2026-10-28", "easy"]]));
  assert.deepEqual(watchLinks([{ ...e, status: "planned" }]), new Map());
});

test("hidden watch runs: by kind, not deleted", () => {
  const h = (pastId: string, kind: "weighIn" | "watchRun", deletedAt: number | null = null) => ({ id: kind === "watchRun" ? hiddenRunId(pastId) : pastId, kind, pastId, hiddenAt: 1, updatedAt: 1, deletedAt });
  assert.equal(hiddenRunId("hc:x"), "watchRun:hc:x");
  assert.deepEqual(hiddenWatchRuns([h("hc:a", "watchRun"), h("hc:b", "watchRun", 5), h("w1", "weighIn")]), new Set(["hc:a"]));
});
