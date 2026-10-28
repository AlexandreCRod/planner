import assert from "node:assert/strict";
import { test } from "node:test";
import { KEPT_VERSION, applyChanges, checkPlan, checkShared, fileChanges, healthCsvs, keptKind, sinceOf } from "../tools/training-sync.ts";
import { planFileId, readPlan } from "../src/domain/training.ts";
import { MEALS_FILE, RUNS_FILE, SHARED_PLAN } from "../src/domain/trends.ts";

const rec = (planId: string, file: string, text: string) => ({ id: `${planId}:${file}`, planId, file, text, updatedAt: 1 });

test("fileChanges: sends new and changed files only", () => {
  const base = { "trainingFiles/p:a.md": rec("p", "a.md", "same"), "trainingFiles/p:b.md": rec("p", "b.md", "old") };
  const ch = fileChanges("p", new Map([["a.md", "same"], ["b.md", "new"], ["c.md", "x"]]), base, 5);
  assert.deepEqual(ch.map((c) => c.id), ["p:b.md", "p:c.md"]);
  assert.equal((ch[0].data as { updatedAt: number }).updatedAt, 5);
});

test("fileChanges: deletes this plan's unlisted files, not another plan's", () => {
  const base = { "trainingFiles/p:a.md": rec("p", "a.md", "t"), "trainingFiles/q:a.md": rec("q", "a.md", "t"), "trainingEntries/p:s1": { planId: "p" } };
  const ch = fileChanges("p", new Map(), base, 1);
  assert.deepEqual(ch, [{ kind: "trainingFiles", id: "p:a.md", data: null }]);
});

test("fileChanges: the shared files stay on the server when taken out of the folder", () => {
  const base = { "trainingFiles/shared:runs.json": rec("shared", "runs.json", "t") };
  assert.deepEqual(fileChanges("shared", new Map(), base, 1, true), []);
  assert.equal(fileChanges("shared", new Map([["runs.json", "u"]]), base, 1, true).length, 1);
});

test("applyChanges: sets and deletes", () => {
  const out = applyChanges({ "k/a": { v: 1 }, "k/b": { v: 2 } }, [{ kind: "k", id: "a", data: null }], [{ kind: "k", id: "c", data: { v: 3 } }]);
  assert.deepEqual(Object.keys(out), ["k/b", "k/c"]);
});

test("checkPlan: reports missing documents and anchors", () => {
  const raw = {
    version: 1, plan: { id: "p", start: "2026-01-01", end: "2026-01-31" },
    exercises: [{ id: "sq", name: "Squat", card: { doc: "g.md", anchor: "nope" } }],
    phases: [], documents: [{ file: "g.md" }, { file: "missing.md" }],
  };
  const r = checkPlan(raw, (f) => (f === "g.md" ? "# Squat\n" : null));
  assert.equal(r.problems.length, 2);
  assert.match(r.problems.join("\n"), /missing\.md/);
  assert.match(r.problems.join("\n"), /g\.md#nope/);
});

test("checkShared: the history files are checked and summed up like runs.json", () => {
  const files: Record<string, string> = {
    "weights.json": JSON.stringify({ version: 1, weights: [{ id: "f1", date: "2024-01-31", time: "10:49", kg: 85.9, when: null, source: "fitnotes", note: "" }], measurements: [] }),
    "lift-history.json": JSON.stringify({ version: 1, sets: [{ id: "f1", date: "2024-02-19", exercise_id: "x036", name: "Deadlift", kg: 205, reps: 1, source: "fitnotes", note: "" }] }),
    "sleep.json": "{ not json",
  };
  const r = checkShared((f) => files[f] ?? null);
  assert.deepEqual([...r.texts.keys()], ["weights.json", "lift-history.json"]);
  assert.deepEqual(r.ok, ["OK: weights.json: 1 weigh-in, 0 other measurements.", "OK: lift-history.json: 1 set."]);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /^sleep\.json isn't valid JSON/);
});

test("pull keeps the training and watch kinds only, and receives everything again once for the watch's", () => {
  assert.deepEqual(["trainingEntries", "trainingHidden", "healthSessions", "healthNights", "healthDays", "notes", "tasks"].map(keptKind), [true, true, true, true, true, false, false]);
  assert.equal(sinceOf({ seq: 40, records: {} }), 0);
  assert.equal(sinceOf({ seq: 40, records: {}, kept: KEPT_VERSION }), 40);
});

test("pull's watch CSVs: runs.json as pushed merged with the watch's runs, linked by the tick", () => {
  const plan = readPlan({ version: 1, plan: { id: "p", start: "2026-10-26", end: "2026-11-01" },
    phases: [{ name: "W1", start: "2026-10-26", end: "2026-11-01", sessions: [{ id: "long", kind: "run", title: "Long run" }] }] }).plan!;
  const runsJson = (title: string) => JSON.stringify({ version: 1, runs: [
    { id: "g1", date: "2026-10-28", start_time: "07:01", title, run_type: "easy", source: "garmin_export", distance_km: 8.1 },
    { id: "g2", date: "2026-10-20", start_time: "07:00", title, run_type: "easy", source: "garmin_export", distance_km: 5 },
  ] });
  const session = { id: "hc:a", day: 20754, time: "07:00", endTime: "07:52", startMs: 1, durationS: 3120, movingS: 3000, exerciseType: "running", title: "",
    source: "x", distanceKm: 8, ascentM: null, steps: null, kcal: null, avgHr: null, maxHr: null, cadenceSpm: null, laps: [], splits: [], hr: [], updatedAt: 1 };
  const walk = { ...session, id: "hc:w", exerciseType: "walking" };
  const records = {
    [`trainingFiles/${planFileId(SHARED_PLAN, RUNS_FILE)}`]: rec(SHARED_PLAN, RUNS_FILE, runsJson("Pushed")),
    "healthSessions/hc:a": session, "healthSessions/hc:w": walk,
    "healthDays/hcd:2026-10-28": { id: "hcd:2026-10-28", day: 20754, steps: 100 },
    "trainingEntries/p:long": { id: "p:long", planId: "p", sessionId: "long", kind: "session", status: "done", watchRunId: "hc:a", deletedAt: null },
  };
  const out = healthCsvs(records, plan, runsJson("Folder"));
  assert.deepEqual([...out.keys()], ["runs.csv", "workouts.csv", "daily.csv", "sleep.csv"]);
  const runs = out.get("runs.csv")!.trimEnd().split("\r\n");
  assert.equal(runs.length, 3);
  assert.match(runs[1], /^g2,2026-10-20,07:00,Pushed,,easy,garmin_export,5,/);
  assert.match(runs[2], /^hc:a,2026-10-28,07:00,Run,long,easy,health_connect,8,3120,3000,375,/);
  assert.match(out.get("workouts.csv")!, /hc:w,2026-10-28,07:00,walking/);
  assert.match(out.get("daily.csv")!, /2026-10-28,100,/);
  assert.match(out.get("sleep.csv")!, /^date,bed,wake,total_min,awake_min,deep_min,light_min,rem_min,score,resting_hr,hrv_ms,avg_spo2,avg_respiration,source\r\n/);
  // sleep.json from the folder, a watch night on the same morning wins and sleep.json fills the score.
  const sleepJson = JSON.stringify({ version: 1, nights: [{ date: "2026-10-28", bed: "2026-10-27T23:00", wake: "2026-10-28T06:00", total_min: 400, score: 80, resting_hr: 50 }] });
  const night = { id: "hc:n", day: 20754, bed: "2026-10-27T23:10", wake: "2026-10-28T06:50", totalMin: 450, awakeMin: 10, deepMin: 150, lightMin: 210, remMin: 90, stages: [], source: "w" };
  const s2 = healthCsvs({ "healthNights/hc:n": night }, plan, null, sleepJson).get("sleep.csv")!.trimEnd().split("\r\n");
  assert.equal(s2.length, 2);
  assert.match(s2[1], /^2026-10-28,2026-10-27T23:10,2026-10-28T06:50,450,10,150,210,90,80,50,/);
  assert.match(s2[1], /health_connect$/);
  // Nothing pushed yet: the folder's runs.json.
  assert.match(healthCsvs({}, plan, runsJson("Folder")).get("runs.csv")!, /Folder/);
});
