// Estimated stats for an activity marked done with no watch data (340): domain/estimate.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Recorded, estimateGame, estimateLine, gameEstimate, recordedGames, runEstimate, sampleFor, targetKm, targetMin } from "../src/domain/estimate.ts";
import type { Entry } from "../src/domain/training.ts";
import type { HealthSession } from "../src/domain/health.ts";
import type { Run } from "../src/domain/trends.ts";

const rec = (day: number, series: string, min: number, kcal: number | null, avgHr: number | null): Recorded =>
  ({ day, series, title: series, durationS: min * 60, kcal, avgHr, paceSPerKm: null });

test("a game's estimate: median kcal a minute of the same event, times its own length; median heart rate", () => {
  // Thursday futsal: 10 kcal/min (600 in 60), 9 (540 in 60), 12 (900 in 75) -> median 10; HR 150, 140, 160 -> 150.
  const h = [rec(10, "event:7", 60, 600, 150), rec(17, "event:7", 60, 540, 140), rec(24, "event:7", 75, 900, 160), rec(20, "event:9", 60, 300, 120)];
  const x = estimateGame("event:7", 31, 90 * 60, h)!;
  assert.equal(x.kcal, 900); // 10 kcal a minute for 90 minutes
  assert.equal(x.avgHr, 150);
  assert.equal(x.same, true);
  assert.equal(x.from, 3);
  assert.equal(estimateLine(x), "90 min · ≈ 150 bpm · ≈ 900 kcal");
});

test("with fewer than 3 of the same event, the latest 8 of the kind; only up to its day", () => {
  const h = [rec(1, "event:7", 60, 600, 150), rec(2, "event:9", 60, 300, 120), rec(3, "event:9", 60, 360, 130), rec(40, "event:9", 60, 1200, 190)];
  const x = estimateGame("event:7", 30, 60 * 60, h)!;
  assert.equal(x.same, false);
  assert.equal(x.from, 3); // day 40 is after the game: not used
  assert.equal(x.kcal, 360); // per minute 10, 5, 6 -> 6
  // Eight at most, the newest.
  const many = Array.from({ length: 12 }, (_, i) => rec(i, "event:7", 60, (i + 1) * 60, 100 + i));
  const s = sampleFor("event:7", 99, many);
  assert.equal(s.list.length, 8);
  assert.deepEqual(s.list.map((r) => r.day), [11, 10, 9, 8, 7, 6, 5, 4]);
});

test("no estimate without a length or without anything recorded", () => {
  assert.equal(estimateGame("event:7", 30, 0, [rec(1, "event:7", 60, 600, 150)]), null);
  assert.equal(estimateGame("event:7", 30, 3600, []), null);
});

const entry = (id: string, day: number, f: Partial<Entry> = {}): Entry => ({
  id, planId: "p", sessionId: null, kind: "futsal", status: "done", day, doneDay: null, durationMin: null, pain: null, effort: null, note: "",
  ticks: [], title: "Futsal", detail: "", itemId: 7, updatedAt: 0, deletedAt: null, ...f,
});
const session = (id: string, day: number, min: number, kcal: number, avgHr: number) =>
  ({ id, day, durationS: min * 60, movingS: 0, kcal, avgHr } as unknown as HealthSession);

test("the 2 Nov game: marked done, watch not started, gets the usual of that event; it goes once the watch's data is there", () => {
  const games = [entry("g1", 10), entry("g2", 17), entry("g3", 24), entry("nov2", 30, { durationMin: 60 }), entry("other", 26, { sport: true, itemId: 8 })];
  const byGame = new Map([["g1", session("s1", 10, 60, 600, 150)], ["g2", session("s2", 17, 60, 660, 154)], ["g3", session("s3", 24, 60, 720, 158)], ["other", session("s4", 26, 60, 100, 100)]]);
  const x = gameEstimate(games[3], false, games, byGame, undefined)!;
  assert.equal(x.kcal, 660);
  assert.equal(x.avgHr, 154);
  // Another sport's games aren't futsal's sample.
  assert.equal(recordedGames(games, byGame, false).length, 3);
  // Football sessions no game took count among futsal's own kind.
  assert.equal(recordedGames(games, byGame, false, [session("loose", 20, 60, 300, 120)]).length, 4);
  // Its length from the event when none was logged.
  assert.equal(gameEstimate(entry("e", 30), false, games, byGame, { startMin: 20 * 60, endMin: 21 * 60 + 30 })!.kcal, 990);
  // Watched, not done, or no length: no estimate.
  assert.equal(gameEstimate(games[3], true, games, byGame, undefined), null);
  assert.equal(gameEstimate({ ...games[3], status: "planned" }, false, games, byGame, undefined), null);
  assert.equal(gameEstimate(entry("e", 30), false, games, byGame, undefined), null);
});

test("the plan's distance and time in a session's words", () => {
  assert.equal(targetKm("Easy 8 km"), 8);
  assert.equal(targetKm("Long run 12,5 km"), 12.5);
  assert.equal(targetKm("10K tempo"), 10);
  assert.equal(targetKm("Strides x6"), null);
  assert.equal(targetMin("45 min easy"), 45);
  assert.equal(targetMin("1 h 10 min"), 70);
  assert.equal(targetMin("Easy 8 km"), null);
});

const run = (day: number, title: string, km: number, paceS: number, avgHr: number, type: Run["type"] = "easy"): Run => ({
  id: `r${day}`, day, time: null, title, sessionId: null, type, source: null, distanceKm: km, durationS: Math.round(km * paceS), paceSPerKm: paceS,
  avgHr, maxHr: null, cadenceSpm: null, ascentM: null,
});

test("a run's estimate: the plan's km when it names them, else its length over the usual pace", () => {
  const runs = [run(1, "Easy run", 6, 360, 140), run(5, "Easy run", 6, 340, 144), run(9, "Easy run", 7, 350, 142)];
  const kcal = [{ id: "r1", kcal: 360 }, { id: "r5", kcal: 340 }, { id: "r9", kcal: 410 }] as unknown as HealthSession[];
  // "Easy run · 45 min" with no km: 45 min at the usual 5:50 a km -> 7.7 km.
  const a = runEstimate({ title: "Easy run", detail: "45 min" }, { status: "done", durationMin: null }, 12, runs, kcal)!;
  assert.equal(a.durationS, 2700);
  assert.equal(a.distanceKm, 7.7);
  assert.equal(a.avgHr, 142);
  assert.equal(a.same, true);
  // "Easy run · 8 km" with no time: the plan's km, its length from the usual pace.
  const b = runEstimate({ title: "Easy run", detail: "8 km" }, { status: "done", durationMin: null }, 12, runs, kcal)!;
  assert.equal(b.distanceKm, 8);
  assert.equal(b.durationS, 8 * 350);
  // Logged length wins over the plan's words.
  assert.equal(runEstimate({ title: "Easy run", detail: "45 min" }, { status: "done", durationMin: 30 }, 12, runs, kcal)!.durationS, 1800);
  // Not done, or nothing recorded: none.
  assert.equal(runEstimate({ title: "Easy run", detail: "8 km" }, { status: "planned", durationMin: null }, 12, runs, kcal), null);
  assert.equal(runEstimate({ title: "Easy run", detail: "8 km" }, { status: "done", durationMin: null }, 12, [], []), null);
});
