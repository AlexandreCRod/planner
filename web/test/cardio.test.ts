import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ActivityNote, type Game, activityNotes, fastest5k, fastest5kOf, finishedAverage, gameNote, gameSeconds, gameStats, gamesOf, longestRun, perWeek, playedGames, recordFor,
  runNote, runSeconds, tally, tallyHours, typeStats,
} from "../src/domain/cardio.ts";
import type { HealthSession } from "../src/domain/health.ts";
import { mergedRuns } from "../src/domain/healthRuns.ts";
import { type Entry, dayOf, futsalLogId, newEntry } from "../src/domain/training.ts";
import type { Run } from "../src/domain/trends.ts";
import { barLabels, rangeWindow } from "../src/ui/phone/chartMath.ts";

const d = (iso: string) => dayOf(iso)!;
const run = (o: Partial<Run> & { id: string; day: number }): Run => ({
  time: null, title: "Run", sessionId: null, type: "easy", source: "garmin_export", distanceKm: 10, durationS: 3600, paceSPerKm: 360, avgHr: 140, maxHr: 170, cadenceSpm: null, ascentM: null, ...o,
});
const session = (o: Partial<HealthSession> & { id: string; day: number }): HealthSession => ({
  time: "21:00", endTime: "22:00", startMs: o.day * 864e5, durationS: 3600, movingS: 0, exerciseType: "soccer", title: "", source: "garmin", distanceKm: null, ascentM: null, steps: null,
  kcal: 650, avgHr: 150, maxHr: 185, cadenceSpm: null, laps: [], splits: [], hr: [], updatedAt: 0, ...o,
});
const gameEntry = (itemId: number, day: number, o: Partial<Entry> = {}) =>
  newEntry({ id: futsalLogId(itemId, day), planId: "p", kind: "futsal", itemId, day, status: "done", title: "Futsal Alvalade", ...o });
const noMatches = { byGame: new Map<string, HealthSession>(), loose: [] as HealthSession[] };

test("ranges: a week by days, a month by days, 13 weeks, months, and All from the first day", () => {
  const t = d("2026-10-29"); // a Thursday
  const w = rangeWindow("1W", t);
  assert.deepEqual([w.from, w.to, w.unit, w.label], [d("2026-10-26"), d("2026-11-02"), "day", "This week"]);
  assert.deepEqual(w.bars.map((b) => b.label), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.deepEqual(w.bars.map((b) => b.future), [false, false, false, false, true, true, true]);
  const m = rangeWindow("1M", t);
  assert.deepEqual([m.from, m.to, m.bars.length, m.label], [d("2026-10-01"), d("2026-11-01"), 31, "Oct 2026"]);
  const q = rangeWindow("3M", t);
  assert.equal(q.unit, "week"); assert.equal(q.bars.length, 13);
  assert.equal(q.to, d("2026-11-02")); assert.equal(q.bars[12].now, true); assert.equal(q.bars[12].title, "Week of 26 Oct");
  const y = rangeWindow("1Y", t);
  assert.deepEqual([y.from, y.to, y.bars.length, y.unit], [d("2025-11-01"), d("2026-11-01"), 12, "month"]);
  assert.deepEqual(y.bars.slice(0, 3).map((b) => b.to - b.from), [30, 31, 31]); // Nov, Dec, Jan: each its real length
  assert.equal(rangeWindow("6M", t).bars[0].title, "May 2026");
  const all = rangeWindow("All", t, d("2024-03-20"));
  assert.deepEqual([all.from, all.bars.length, all.bars[0].title], [d("2024-03-01"), 32, "Mar 2024"]);
});

test("a window further back: the one before it, ending where it starts, none of it now", () => {
  const t = d("2026-10-29");
  for (const k of ["1W", "1M", "3M", "6M", "1Y"] as const) {
    const a = rangeWindow(k, t), b = rangeWindow(k, t, t, 1);
    assert.equal(b.to, a.from, k);
    assert.ok(b.bars.every((x) => !x.now && !x.future), k);
  }
});

test("a chart labels every bar up to 7, else the first, middle and last", () => {
  assert.equal(barLabels(rangeWindow("1W", d("2026-10-29")).bars).length, 7);
  assert.deepEqual(barLabels(rangeWindow("1M", d("2026-10-29")).bars).map((l) => [l.text, l.anchor]), [["1", "start"], ["16", "middle"], ["31", "end"]]);
});

test("a game is played once ticked or caught by the watch, and takes its event's title", () => {
  const t = d("2026-10-29");
  const ticked = gameEntry(1, d("2026-10-21"));
  const caught = gameEntry(1, d("2026-10-28"), { status: "planned" });
  const missed = gameEntry(1, d("2026-10-14"), { status: "planned" });
  const coming = gameEntry(1, d("2026-11-04"), { status: "planned" });
  const other = gameEntry(2, d("2026-10-21"), { sport: true, title: "Padel" });
  const s = session({ id: "hc:1", day: d("2026-10-28") }), loose = session({ id: "hc:2", day: d("2026-10-10") });
  const games = gamesOf([ticked, caught, missed, coming, other], { byGame: new Map([[caught.id, s]]), loose: [loose] }, new Map([[1, { startMin: 1260, endMin: 1320 }]]));
  const played = playedGames(games, t);
  assert.deepEqual(played.map((g) => [g.title, g.fromEvent]), [["Futsal", false], ["Futsal Alvalade", true], ["Futsal Alvalade", true]]);
  assert.deepEqual(played.map((g) => g.day), [d("2026-10-10"), d("2026-10-21"), d("2026-10-28")]);
  assert.equal(played[2].startMin, 1260);
});

test("the totals: km are runs only, time takes the games only when they count", () => {
  const runs = [run({ id: "a", day: d("2026-10-27"), distanceKm: 6, durationS: 2400, movingS: 1800 }), run({ id: "b", day: d("2026-10-25"), distanceKm: 16, durationS: 6000 })];
  const e = gameEntry(1, d("2026-10-28"));
  const games = playedGames(gamesOf([e], { byGame: new Map([[e.id, session({ id: "x", day: d("2026-10-28") })]]), loose: [] }, new Map()), d("2026-10-29"));
  const week = tally(runs, games, d("2026-10-26"), d("2026-11-02"));
  assert.equal(week.km, 6); assert.equal(week.runs.length, 1); assert.equal(week.games.length, 1);
  assert.equal(tallyHours(week, false), 0.5);        // moving time, not the whole 40 min
  assert.equal(tallyHours(week, true), 1.5);
  assert.equal(tally(runs, games, d("2026-11-02"), d("2026-11-09")).km, 0);
});

test("a game's length: the watch's, else what was logged, else nothing", () => {
  const base: Game = { id: "g", day: 1, title: "", fromEvent: true, startMin: null, endMin: null, entry: gameEntry(1, 1, { durationMin: 75 }), session: null, done: true };
  assert.equal(gameSeconds(base), 4500);
  assert.equal(gameSeconds({ ...base, session: session({ id: "s", day: 1, durationS: 3540 }) }), 3540);
  assert.equal(gameSeconds({ ...base, entry: gameEntry(1, 1) }), 0);
});

test("runs a week count only the days gone by", () => {
  const from = d("2026-10-26");
  assert.equal(perWeek(2, from, from + 7, from + 6), 2);
  assert.equal(perWeek(2, from, from + 7, from + 2), (2 / 3) * 7);          // three days in
  assert.equal(perWeek(4, from - 28, from, from + 3), 1);                    // a past window: all of it
});

test("the average leaves out the bar still filling and those to come", () => {
  const bars = [{ now: false, future: false }, { now: false, future: false }, { now: true, future: false }, { now: false, future: true }];
  assert.equal(finishedAverage(bars, [10, 20, 1, 0]), 15);
  assert.equal(finishedAverage(bars.slice(2), [1, 0]), null);
});

test("longest, and fastest 5 km: true splits in a row beat the run's average; a shorter run has none", () => {
  const steady = run({ id: "a", day: 1, distanceKm: 10, paceSPerKm: 300 });
  const split = run({ id: "b", day: 2, distanceKm: 8.4, paceSPerKm: 310, splits: [...[330, 330, 290, 280, 280, 280, 280, 330].map((s, i) => ({ km: i + 1, s, hr: null })), { km: 8.4, s: 120, hr: null }] });
  const short = run({ id: "c", day: 3, distanceKm: 4.9, paceSPerKm: 200 });
  assert.equal(fastest5kOf(steady), 1500);
  assert.equal(fastest5kOf(split), 1410);           // km 3 to 7; the partial last split doesn't count
  assert.equal(fastest5kOf(short), null);
  assert.deepEqual(fastest5k([steady, split, short])?.run.id, "b");
  assert.equal(fastest5k([short]), null);
  assert.equal(longestRun([steady, split, short])?.id, "a");
  assert.equal(longestRun([run({ id: "x", day: 1, distanceKm: null })]), null);
});

test("a type's stats: pace over total time and km, trends from first to last, gaps left out", () => {
  const s = typeStats([
    run({ id: "a", day: 1, distanceKm: 5, durationS: 2000, paceSPerKm: 400, avgHr: 150 }),
    run({ id: "b", day: 2, distanceKm: 10, durationS: 3700, paceSPerKm: 370, avgHr: null }),
    run({ id: "c", day: 3, distanceKm: null, durationS: 600, paceSPerKm: null, avgHr: 140 }),
  ]);
  assert.equal(s.count, 3); assert.equal(s.km, 15); assert.equal(s.longestKm, 10);
  assert.equal(s.paceS, 380);                     // 5700 s over 15 km: not the mean of the paces
  assert.equal(s.hr, 145); assert.equal(s.faster, 30); assert.equal(s.hrChange, -10);
  const one = typeStats([run({ id: "a", day: 1 })]);
  assert.equal(one.faster, null); assert.equal(one.hrChange, null);
  assert.equal(typeStats([]).paceS, null);
});

test("games' stats: the middle length, the hardest by max heart rate, gaps left out", () => {
  const g = (id: string, s: Partial<HealthSession> | null): Game => ({
    id, day: 1, title: "", fromEvent: true, startMin: null, endMin: null, entry: gameEntry(1, 1), session: s ? session({ id, day: 1, ...s }) : null, done: true,
  });
  const st = gameStats([g("a", { durationS: 3000, maxHr: 180, avgHr: 140, kcal: 600 }), g("b", { durationS: 3600, maxHr: 189, avgHr: 150, kcal: 700 }), g("c", { durationS: 7200, maxHr: 170, avgHr: 160, kcal: null }), g("d", null)]);
  assert.equal(st.count, 4); assert.equal(st.usualMin, 60); assert.equal(st.avgHr, 150); assert.equal(st.kcal, 1300); assert.equal(st.usualKcal, 650);
  assert.equal(st.hardest?.id, "b");
  assert.equal(gameStats([]).usualMin, null);
});

test("a run's note: its log's if it has a session, else the note kept beside it, found through a merged copy", () => {
  const rec: ActivityNote = { id: "g2026-10-25", note: "Gel at 10 km", updatedAt: 1, deletedAt: null };
  const notes = activityNotes([rec, { id: "gone", note: "old", updatedAt: 1, deletedAt: 2 }]);
  // The same run later also read from the watch: the watch's copy is kept, under another id.
  const json = run({ id: "g2026-10-25", day: d("2026-10-25"), time: "09:00", distanceKm: 16 });
  const [merged] = mergedRuns([json], [session({ id: "hc:9", day: d("2026-10-25"), time: "09:01", exerciseType: "running", distanceKm: 16.1 })]);
  assert.equal(merged.id, "hc:9");
  assert.equal(runNote(merged, [], notes), "Gel at 10 km");
  const linked = { ...merged, sessionId: "w3-long" };
  const log = newEntry({ id: "p:w3-long", planId: "p", kind: "session", sessionId: "w3-long", note: "From the log" });
  assert.equal(runNote(linked, [log], notes), "From the log");
  assert.equal(runNote(run({ id: "gone", day: 1 }), [], notes), "");
});

test("a game's note: its log's; one with no event keeps it beside it", () => {
  const notes = activityNotes([{ id: "hc:2", note: "Pickup game", updatedAt: 1, deletedAt: null }]);
  const [game] = gamesOf([gameEntry(1, 5, { note: " Good game " })], noMatches, new Map());
  assert.equal(gameNote(game, notes), "Good game");
  const [loose] = gamesOf([], { byGame: new Map(), loose: [session({ id: "hc:2", day: 3 })] }, new Map());
  assert.equal(gameNote(loose, notes), "Pickup game");
});

test("a run's time falls back to its length, and a record is found by its distance", () => {
  assert.equal(runSeconds({ movingS: 0, durationS: 100 }), 100);
  assert.equal(runSeconds({ movingS: null, durationS: null }), 0);
  const rec = { distance: "5 km", time: "22:52", day: null, source: "", note: "" };
  assert.equal(recordFor([{ ...rec, distance: "10 km" }, rec], "5 km")?.time, "22:52");
  assert.equal(recordFor([{ ...rec, distance: "15 km" }], "5 km"), undefined);
});
