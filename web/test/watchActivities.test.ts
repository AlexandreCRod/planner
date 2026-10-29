// The watch's activities on Training (item 268): football sessions matched to games, the venue (distance
// only outdoors), the stats shown, strength sessions by day, a run's stats.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HealthSession } from "../src/domain/health.ts";
import { sessionOf } from "../src/domain/health.ts";
import type { Run } from "../src/domain/trends.ts";
import {
  APPROX_NOTE, type GameSlot, clock, isFootballSession, isStrengthSession, matchGames, runStats, sessionStats, statItems, statLine, strengthOn, venueOf,
} from "../src/domain/watchActivities.ts";

const DAY = 20_400;
let n = 1;
function session(time: string, minutes: number, more: Partial<HealthSession> = {}): HealthSession {
  const [h, m] = time.split(":").map(Number);
  const startMs = (DAY * 1440 + h * 60 + m) * 60_000;
  return {
    id: `hc:${n++}`, day: DAY, time, endTime: "", startMs, durationS: minutes * 60, movingS: minutes * 60, exerciseType: "soccer", title: "", source: "g",
    distanceKm: 6.24, ascentM: null, steps: null, kcal: 612, avgHr: 151.4, maxHr: 182, cadenceSpm: null, laps: [], splits: [], hr: [], updatedAt: 0, ...more,
  };
}
const slot = (id: string, startMin: number | null, endMin: number | null, futsal = true, day = DAY): GameSlot => ({ id, day, startMin, endMin, futsal });

test("football: Garmin's arrives as soccer; a title saying football or futsal counts too; strength types", () => {
  assert.equal(isFootballSession({ exerciseType: "soccer", title: "" }), true);
  assert.equal(isFootballSession({ exerciseType: "other_workout", title: "Lisbon Soccer/Football" }), true);
  assert.equal(isFootballSession({ exerciseType: "running", title: "Morning run" }), false);
  assert.equal(isStrengthSession({ exerciseType: "strength_training" }), true);
  assert.equal(isStrengthSession({ exerciseType: "walking" }), false);
});

test("matchGames: overlap or a start within 30 min, the same day; futsal first; each once; the rest loose", () => {
  const a = session("19:05", 60); // overlaps the 19:00 game
  const b = session("21:20", 50); // inside the 21:00-22:00 game (another sport)
  const c = session("08:00", 60); // nothing near
  const d = session("17:00", 60, { day: DAY + 1 }); // the untimed game on the next day
  const e = session("12:00", 60, { exerciseType: "running" }); // not football
  const m = matchGames([slot("g1", 19 * 60, 20 * 60), slot("g2", 21 * 60, 22 * 60, false), slot("g3", null, null, true, DAY + 1), slot("g4", 10 * 60, 11 * 60)], [a, b, c, d, e]);
  assert.deepEqual([...m.byGame].map(([g, s]) => [g, s.id]).sort(), [["g1", a.id], ["g2", b.id], ["g3", d.id]]);
  assert.deepEqual(m.loose.map((s) => s.id), [c.id]);
  // A start 25 min before a game that it doesn't reach still matches; 40 min doesn't.
  assert.equal(matchGames([slot("g", 19 * 60, 20 * 60)], [session("18:35", 20)]).byGame.size, 1);
  assert.equal(matchGames([slot("g", 19 * 60, 20 * 60)], [session("18:00", 15)]).byGame.size, 0);
  // Two games at the same time: the futsal one takes it.
  const both = matchGames([slot("tennis", 19 * 60, 20 * 60, false), slot("futsal", 19 * 60, 20 * 60)], [session("19:00", 60)]);
  assert.deepEqual([...both.byGame.keys()], ["futsal"]);
  // A timed game beats an untimed one the same day; the longer overlap wins.
  const s1 = session("19:00", 60);
  assert.deepEqual([...matchGames([slot("untimed", null, null), slot("timed", 19 * 60 + 30, 20 * 60 + 30)], [s1]).byGame.keys()], ["timed"]);
});

test("venue: a GPS route is outdoors; futsal or indoor in a title is indoors; else not known", () => {
  assert.equal(venueOf({ route: true, title: "Futsal" }), "outdoor");
  assert.equal(venueOf({ title: "Soccer/Football" }, "Futsal with work"), "indoor");
  assert.equal(venueOf({ title: "Indoor football" }), "indoor");
  assert.equal(venueOf({ route: false, title: "Soccer/Football" }, "Football"), "unknown");
});

test("stats: distance and speed only outdoors, ≈ when not known; only what the watch wrote", () => {
  const s = session("19:00", 62, { movingS: 0 });
  const out = statItems(sessionStats(s, "outdoor"));
  assert.deepEqual(out.map((x) => `${x.label} ${x.value}`), ["Time 1:02:00", "Distance 6.2 km", "Speed 6.0 km/h", "Avg HR 151 bpm", "Max HR 182 bpm", "Calories 612 kcal"]);
  const unknown = sessionStats(s, "unknown");
  assert.equal(unknown.approx, true);
  assert.deepEqual(statItems(unknown).filter((x) => x.value.startsWith("≈")).map((x) => x.label), ["Distance", "Speed"]);
  assert.ok(APPROX_NOTE.length > 0);
  const indoor = statItems(sessionStats(s, "indoor")).map((x) => x.label);
  assert.deepEqual(indoor, ["Time", "Avg HR", "Max HR", "Calories"]);
  const bare = sessionStats(session("19:00", 45, { avgHr: null, maxHr: null, kcal: null, distanceKm: null }), "outdoor");
  assert.deepEqual(statItems(bare).map((x) => x.label), ["Time"]);
  assert.equal(statLine(sessionStats(s, "indoor")), "62 min · 151 bpm · 612 kcal");
  assert.equal(statLine(bare), "45 min");
  assert.equal(clock(2700), "45:00");
});

test("strengthOn: the day's strength sessions, oldest first", () => {
  const g1 = session("18:00", 50, { exerciseType: "strength_training" });
  const g0 = session("07:00", 30, { exerciseType: "weightlifting" });
  const other = session("12:00", 30, { exerciseType: "strength_training", day: DAY + 1 });
  assert.deepEqual(strengthOn([g1, g0, other, session("19:00", 60)], DAY).map((s) => s.id), [g0.id, g1.id]);
});

test("runStats: the run's own figures, the watch session's calories; pace from time over distance when missing", () => {
  const run: Run = { id: "hc:9", day: DAY, time: "07:00", title: "Run", sessionId: "t1", type: "easy", source: "health_connect",
    distanceKm: 8, durationS: 2700, movingS: 2580, paceSPerKm: null, avgHr: 148, maxHr: 165, cadenceSpm: null, ascentM: 40 };
  const st = runStats(run, session("07:00", 45, { kcal: 520 }));
  assert.deepEqual(statItems(st).map((x) => `${x.label} ${x.value}`),
    ["Time 45:00", "Moving 43:00", "Distance 8 km", "Pace 5:23 /km", "Avg HR 148 bpm", "Max HR 165 bpm", "Calories 520 kcal", "Climb 40 m"]);
  assert.equal(runStats({ ...run, ascentM: null }, undefined).kcal, null);
});

test("sessionOf keeps whether the session has a GPS route (the plugin's hasRoute)", () => {
  const meta = { id: "s1", origin: "g" };
  const r = { metadata: meta, startTime: 0, endTime: 3_600_000, exerciseTypeName: "soccer", hasRoute: true };
  assert.equal(sessionOf(r, {}, 0).route, true);
  assert.equal(sessionOf({ ...r, hasRoute: false }, {}, 0).route, false);
});
