import assert from "node:assert/strict";
import { test } from "node:test";
import type { HealthNight, HealthSession } from "../src/domain/health.ts";
import {
  GARMIN_FIX, GARMIN_ORIGIN, lastReadsOf, newestRead, nextLastReads, oldestRead, readSummary, watchFound, watchStatus,
} from "../src/domain/healthRead.ts";
import { epochOf } from "../src/domain/dates.ts";

const DAY = 86_400_000;
/** A UTC midnight stands in for the local one. */
const midnight = (day: number) => day * DAY;
const T = ["ExerciseSession", "HeartRate", "Steps"];

// ---------- Per-type last reads ----------

test("last reads: stored per type; else the older single time for every type; else none", () => {
  assert.deepEqual(lastReadsOf('{"HeartRate":5,"Steps":7}', 3, T), { HeartRate: 5, Steps: 7 });
  assert.deepEqual(lastReadsOf(null, 3, T), { ExerciseSession: 3, HeartRate: 3, Steps: 3 });
  assert.deepEqual(lastReadsOf(null, null, T), {});
  assert.deepEqual(lastReadsOf("not json", 3, T), { ExerciseSession: 3, HeartRate: 3, Steps: 3 });
  assert.deepEqual(lastReadsOf('{"HeartRate":"x","Steps":-1,"Speed":9}', null, T), { Speed: 9 });
});

test("the read starts from the oldest type's last read; a type never read rides along; none: first connect", () => {
  assert.equal(oldestRead({ ExerciseSession: 9, HeartRate: 4, Steps: 7 }, T), 4);
  assert.equal(oldestRead({ ExerciseSession: 9, Speed: 1 }, T), 9);  // Speed isn't read this time
  assert.equal(oldestRead({}, T), null);
  assert.equal(newestRead({ a: 3, b: 8 }), 8);
  assert.equal(newestRead({}), null);
});

test("after a read: types read whole move on, a failed one keeps its old time and is read again", () => {
  const prev = { ExerciseSession: 100 * DAY, HeartRate: 100 * DAY, Steps: 100 * DAY, Speed: 50 * DAY };
  const next = nextLastReads(prev, T, new Map([["HeartRate", 97]]), 105 * DAY, midnight);
  assert.deepEqual(next, { ExerciseSession: 105 * DAY, HeartRate: 100 * DAY, Steps: 105 * DAY, Speed: 50 * DAY });
  // The next read goes back to HeartRate's time, so its days are read again.
  assert.equal(oldestRead(next, T), 100 * DAY);
});

test("first connect: a type failed in an old window starts the next read at that window, not the whole history", () => {
  const next = nextLastReads({}, T, new Map([["Steps", 60]]), 120 * DAY, midnight);
  assert.equal(next.ExerciseSession, 120 * DAY);
  assert.equal(next.Steps, midnight(63));  // 3 days' re-read before it lands on day 60
  assert.equal(nextLastReads({}, T, new Map(T.map((t) => [t, 0])), 120 * DAY, midnight).HeartRate, midnight(3));
});

// ---------- The read's summary ----------

test("the read's summary: per type ok or failed, how many, the newest day; empty types on one line", () => {
  const s = readSummary({
    ExerciseSession: { ok: true, count: 3, newestDay: epochOf(2026, 10, 27) },
    HeartRate: { ok: false, count: 1200, newestDay: epochOf(2026, 10, 20), error: "Rate limited request" },
    Steps: { ok: true, count: 0, newestDay: null },
    Weight: { ok: true, count: 0, newestDay: null },
  }, 1203, 5);
  assert.equal(s.message, "Read 4 types: 3 ok, 1 failed (tried again next read); 1203 from Garmin, 5 saved");
  assert.equal(s.detail, [
    "ExerciseSession: ok, 3, newest 2026-10-27",
    "HeartRate: failed, 1200, newest 2026-10-20 (Rate limited request)",
    "Nothing in: Steps, Weight",
  ].join("\n"));
  assert.equal(readSummary({ Steps: { ok: true, count: 2, newestDay: null } }, 0, 0).message, "Read 1 type: 1 ok; 0 from Garmin, 0 saved");
});

// ---------- Settings' status ----------

const session = (day: number, exerciseType: string, source = GARMIN_ORIGIN) => ({ day, exerciseType, source }) as HealthSession;
const night = (day: number, source = GARMIN_ORIGIN) => ({ day, source }) as HealthNight;
const date = (day: number) => `d${day}`;

test("what was found: the last run (runs only) and night, and whether any of it is Garmin's", () => {
  const f = watchFound([session(5, "running"), session(9, "walking"), session(7, "running_treadmill")], [night(8), night(6)], false);
  assert.deepEqual(f, { lastRunDay: 7, lastNightDay: 8, garmin: true });
  assert.deepEqual(watchFound([session(5, "running", "com.sec.android.app.shealth")], [], false), { lastRunDay: 5, lastNightDay: null, garmin: false });
  assert.deepEqual(watchFound([], [], true), { lastRunDay: null, lastNightDay: null, garmin: true });  // only steps from Garmin
});

test("the status names the last run and night; nothing from Garmin says how to fix it", () => {
  assert.deepEqual(watchStatus({ lastRunDay: 7, lastNightDay: 8, garmin: true }, date), { text: "Last run d7 · last night d8", fix: "" });
  assert.deepEqual(watchStatus({ lastRunDay: null, lastNightDay: 8, garmin: true }, date), { text: "Last night d8", fix: "" });
  assert.deepEqual(watchStatus({ lastRunDay: null, lastNightDay: null, garmin: true }, date), { text: "No runs or sleep yet", fix: "" });
  assert.deepEqual(watchStatus({ lastRunDay: null, lastNightDay: null, garmin: false }, date), { text: "Nothing from Garmin yet", fix: GARMIN_FIX });
  assert.deepEqual(watchStatus({ lastRunDay: 5, lastNightDay: null, garmin: false }, date), { text: "Last run d5", fix: GARMIN_FIX });
});
