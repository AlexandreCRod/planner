import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorsIn, parseDocLink, sectionAt, slugOf } from "../src/domain/markdown.ts";
import {
  type Entry, type Lift, activePlan, dayOf, entryId, isoOf, leftToPlace, logCsv, markedDays, missingCards, newBestsIn, newEntry,
  phaseView, planChanges, prefillSets, rangeOf, readPlan, repBests, seenOf, sessionsOnDay, setsCsv, targetLine,
} from "../src/domain/training.ts";

// A made-up plan in the plan session's format (the real one stays out of this public repo).
const raw = () => ({
  version: 1,
  plan: { id: "test-plan", name: "Test 10 km", start: "2026-11-02", end: "2026-11-15" },
  bests_since: "2026-10-01",
  documents: [{ file: "Days.md", title: "Days" }, { file: "Guide.md", title: "Guide" }],
  exercises: [
    { id: "x001", name: "Front squat", card: { doc: "Guide.md", anchor: "ex-front-squat" }, type: "weighted", log: "sets", track_bests: true },
    { id: "x002", name: "Leg press", card: null, type: "weighted", log: "sets", track_bests: false },
    { id: "x003", name: "Ankle warm-up", card: { doc: "Days.md", anchor: "card-ankle" }, type: "timed", log: "tick", track_bests: false },
  ],
  phases: [
    {
      name: "Week 1 · Build", start: "2026-11-02", end: "2026-11-08", summary: "~20 km", rules: ["Not the day before the long run"], notes: ["Finger: stage 1"],
      sessions: [
        { id: "t001", title: "Threshold", detail: "4×4'", kind: "run", card: { doc: "Days.md", anchor: "card-threshold" }, default_date: null, locked: false, optional: false, extra: [] },
        {
          id: "t002", title: "Gym S1 · A", detail: "Legs", kind: "gym", card: { doc: "Days.md", anchor: "card-gym-a" }, default_date: null,
          exercises: [
            { exercise: "x003", group: "warm-up", sets: "1", reps: "5 min", target_kg: null, rpe: "", target_text: "", note: "", swaps: [] },
            { exercise: "x001", group: "main", sets: "2–3", reps: "5", target_kg: 60, rpe: "5–6", target_text: "", note: "Cross-arm", swaps: [{ exercise: "x002", when: "If it hurts" }] },
          ],
        },
        { id: "t003", title: "Easy run", detail: "25'", kind: "run", default_date: null, optional: true, card: null },
        { id: "t004", title: "Long run", detail: "10 km", kind: "run", default_date: "2026-11-08", card: { doc: "Days.md", anchor: "card-long-run" }, some_new_field: 1 },
      ],
    },
    {
      name: "Week 2 · Race", start: "2026-11-09", end: "2026-11-15", summary: "", rules: [], notes: [],
      sessions: [{ id: "t005", title: "RACE", detail: "10 km", kind: "run", default_date: "2026-11-15", locked: true, card: null }],
    },
  ],
  records: { historical: [{ exercise: "x001", kg: 170, reps: 1, label: "historical" }], estimated_1rm: [], runs: [{ distance: "5 km", time: "22:52", date: "2026-05-04", source: "garmin_record", note: "" }] },
  future_field: { anything: true },
});
const read = () => { const r = readPlan(raw()); assert.deepEqual(r.problems, []); return r.plan!; };
const d = (iso: string) => dayOf(iso)!;
const entries = (...es: Entry[]) => new Map(es.map((e) => [e.id, e]));

test("dates read and write as YYYY-MM-DD", () => {
  assert.equal(isoOf(d("2026-11-29")), "2026-11-29");
  assert.equal(dayOf("2026-02-30"), null);
  assert.equal(dayOf("29/11/2026"), null);
  assert.equal(dayOf(null), null);
});

test("the plan reads with defaults, and unknown fields are ignored", () => {
  const p = read();
  assert.equal(p.id, "test-plan");
  assert.equal(p.phases.length, 2);
  const [t001, t002, t003, t004] = p.phases[0].sessions;
  assert.equal(t001.locked, false);
  assert.equal(t003.optional, true);
  assert.equal(t004.defaultDay, d("2026-11-08"));
  assert.equal(t002.exercises[1].sets, "2–3");
  assert.equal(t002.exercises[1].swaps[0].exercise, "x002");
  assert.equal(p.exercises[1].card, null);
  assert.equal(p.records.runs[0].day, d("2026-05-04"));
  assert.equal(p.bestsSince, d("2026-10-01"));
});

test("the reader lists what's wrong, in plain words", () => {
  const bad = raw();
  bad.phases[0].sessions[1].id = "t001";                                   // duplicate session id
  bad.phases[0].sessions[0].default_date = "2026-12-01" as unknown as null; // outside its phase
  (bad.phases[0].sessions[3] as Record<string, unknown>).default_date = "soon";
  bad.phases[1].sessions[0].locked = true;
  (bad.phases[1].sessions[0] as Record<string, unknown>).default_date = null;
  bad.exercises.push({ ...bad.exercises[0] });                              // duplicate exercise id
  const { plan, problems } = readPlan(bad);
  assert.ok(plan);
  assert.ok(problems.some((p) => p.includes("t001 is used twice")));
  assert.ok(problems.some((p) => p.includes("outside its phase")));
  assert.ok(problems.some((p) => p.includes("unreadable default_date")));
  assert.ok(problems.some((p) => p.includes("locked but has no default_date")));
  assert.ok(problems.some((p) => p.includes("x001 is used twice")));
  assert.match(readPlan({ ...raw(), version: 2 }).problems[0], /newer than this Planner reads/);
  assert.equal(readPlan({}).plan, null);
});

test("cards must point at a document and an anchor that exist", () => {
  const p = read();
  const ids: Record<string, Set<string>> = { "Days.md": new Set(["card-threshold", "card-gym-a", "card-long-run"]), "Guide.md": new Set(["ex-front-squat"]) };
  const missing = missingCards(p, (f) => ids[f] ?? null);
  assert.deepEqual(missing, ["Exercise x003 points at Days.md#card-ankle, which isn't in it."]);
});

test("headings get GitHub's slugs, and fixed anchors resolve too", () => {
  assert.equal(slugOf("Gym loads, S1 to S9"), "gym-loads-s1-to-s9");
  assert.equal(slugOf("Protein: 135–150 g/day (1.6–1.8 g/kg)"), "protein-135150-gday-1618-gkg");
  assert.equal(slugOf("[Easy run](#easy-run) **today**"), "easy-run-today");
  const md = "# Days\n\n## Notes\nA\n\n<a id=\"card-gym-a\"></a>\n\n### Gym session A\nSquat\n- one\n\n### Gym session B\nPress\n\n## Notes\nB\n";
  const a = anchorsIn(md);
  assert.ok(a.has("card-gym-a") && a.has("gym-session-a") && a.has("notes") && a.has("notes-1"));
  assert.equal(sectionAt(md, "card-gym-a"), "### Gym session A\nSquat\n- one");
  assert.equal(sectionAt(md, "gym-session-b"), "### Gym session B\nPress");
  assert.ok(sectionAt(md, "notes")!.startsWith("## Notes\nA") && sectionAt(md, "notes")!.endsWith("Press")); // with its sub-sections
  assert.equal(sectionAt(md, "notes-1"), "## Notes\nB");
  assert.equal(sectionAt(md, "nope"), null);
});

test("links between the documents are told apart from web links", () => {
  assert.deepEqual(parseDocLink("Workout-Days.md#card-gym-a"), { file: "Workout-Days.md", anchor: "card-gym-a" });
  assert.deepEqual(parseDocLink("#key-rules"), { file: null, anchor: "key-rules" });
  assert.deepEqual(parseDocLink("Race-Day.md"), { file: "Race-Day.md", anchor: null });
  assert.equal(parseDocLink("https://www.youtube.com/results?q=x"), null);
  assert.equal(parseDocLink("picture.png"), null);
});

test("sessions wait in To place until given a day; the plan's own days and the race are on theirs", () => {
  const p = read();
  const none = entries();
  const v = phaseView(p, 0, none, []);
  assert.deepEqual(v.toPlace.map((s) => s.id), ["t001", "t002", "t003"]);
  assert.equal(v.days.length, 7);
  assert.deepEqual(v.days[6].items.map((i) => i.session?.id), ["t004"]);

  const placed = newEntry({ id: entryId(p.id, "t001"), planId: p.id, sessionId: "t001", kind: "session", day: d("2026-11-03"), title: "Threshold" });
  const futsal = newEntry({ id: "f1", planId: p.id, kind: "futsal", day: d("2026-11-04"), durationMin: 60 });
  const moved = newEntry({ id: entryId(p.id, "t004"), planId: p.id, sessionId: "t004", kind: "session", day: d("2026-11-07") });
  const all = entries(placed, futsal, moved);
  const v2 = phaseView(p, 0, all, all.values());
  assert.deepEqual(v2.toPlace.map((s) => s.id), ["t002", "t003"]);
  assert.deepEqual(v2.days[1].items.map((i) => i.session?.id), ["t001"]);
  assert.deepEqual(v2.days[2].items.map((i) => i.entry.kind), ["futsal"]);
  assert.deepEqual(v2.days[5].items.map((i) => i.session?.id), ["t004"]); // the user moved the long run to Saturday
  assert.equal(v2.days[6].items.length, 0);

  // The race stays on its day whatever an entry says.
  const race = newEntry({ id: entryId(p.id, "t005"), planId: p.id, sessionId: "t005", kind: "session", day: d("2026-11-10") });
  assert.deepEqual(sessionsOnDay(p, d("2026-11-15"), entries(race)).map((x) => x.session.id), ["t005"]);
  assert.ok(markedDays(p, all).has(d("2026-11-03")) && markedDays(p, all).has(d("2026-11-15")));
  // Today's "N to place this week" leaves out the optional ones.
  assert.deepEqual(leftToPlace(p, d("2026-11-05"), all).map((s) => s.id), ["t002"]);
});

test("a plan update warns about the days it affects, and never drops the user's choices", () => {
  const p = read();
  const seen = seenOf(p, 1);
  const thr = newEntry({ id: entryId(p.id, "t001"), planId: p.id, sessionId: "t001", kind: "session", day: d("2026-11-03"), title: "Threshold" });
  const easy = newEntry({ id: entryId(p.id, "t003"), planId: p.id, sessionId: "t003", kind: "session", day: d("2026-11-06"), title: "Easy run" });
  const next = raw();
  next.phases[0].sessions = next.phases[0].sessions.filter((s) => s.id !== "t001");          // removed (or replaced: new id)
  next.phases[0].sessions[2].default_date = "2026-11-07";                                    // the long run's own day moved
  next.phases[0].end = "2026-11-05"; next.phases[1].start = "2026-11-06";                    // phases reworked: t003's day is now outside
  const p2 = readPlan(next).plan!;
  const changes = planChanges(p2, seen, [thr, easy]);
  assert.deepEqual(changes.map((c) => [c.kind, c.sessionId]).sort(), [["moved", "t004"], ["outside", "t003"], ["removed", "t001"]]);
  assert.deepEqual(planChanges(p, seen, [thr, easy]), []);                                  // nothing changed, nothing to say
  // A session the user ticked done is history, not a warning.
  assert.deepEqual(planChanges(p2, seenOf(p2), [{ ...thr, status: "done" }]), []);
});

test("the active plan is the latest started one, else the next to start", () => {
  const a = { id: "a", start: 10 }, b = { id: "b", start: 20 };
  assert.equal(activePlan([a, b], 15)?.id, "a");
  assert.equal(activePlan([a, b], 25)?.id, "b");
  assert.equal(activePlan([b, a], 5)?.id, "a");
  assert.equal(activePlan([], 5), null);
});

const lift = (id: string, day: number, sets: [number, number][], extra: Partial<Lift> = {}): Lift => ({
  id, planId: "test-plan", sessionId: "t002", planned: "x001", exercise: "x001", day,
  sets: sets.map(([kg, reps]) => ({ kg, reps, done: true })), rpe: 6, pain: null, note: "", name: "Front squat", target: "3×5", updatedAt: day, ...extra,
});

test("sets pre-fill from the target, else from last time, reps never past the range's low end", () => {
  const p = read();
  const fs = p.phases[0].sessions[1].exercises[1];
  assert.deepEqual(rangeOf("2–3"), [2, 3]);
  assert.deepEqual(rangeOf("6–8/side"), [6, 8]);
  assert.deepEqual(rangeOf("5"), [5, 5]);
  assert.equal(rangeOf(""), null);
  assert.equal(targetLine(fs), "2–3×5 @ ~60 kg · RPE 5–6");
  assert.deepEqual(prefillSets(fs, null), [{ kg: 60, reps: 5, done: false }, { kg: 60, reps: 5, done: false }, { kg: 60, reps: 5, done: false }]);
  const noTarget = { ...fs, targetKg: null, sets: "3", reps: "6–8" };
  assert.deepEqual(prefillSets(noTarget, null)[0], { kg: null, reps: 6, done: false });
  assert.deepEqual(prefillSets(noTarget, lift("l1", 100, [[70, 7], [75, 7]]))[0], { kg: 75, reps: 7, done: false });
});

test("rep bests count sets since the return, at 1, 3 and 5 reps, and a new one is marked", () => {
  const tracked = new Set(["x001"]);
  const since = 100;
  const old = lift("l0", 90, [[120, 5]]);            // before the return: not counted
  const a = lift("l1", 101, [[60, 5], [70, 3]]);
  const b = lift("l2", 104, [[65, 5]]);
  const bests = repBests([old, a, b], tracked, since).get("x001")!;
  assert.deepEqual([bests.get(1)?.kg, bests.get(3)?.kg, bests.get(5)?.kg], [70, 70, 65]);
  assert.deepEqual(newBestsIn(b, [old, a], tracked, since), [5]);
  assert.deepEqual(newBestsIn(a, [old, b], tracked, since), [1, 3]);
  assert.deepEqual(newBestsIn(lift("l3", 105, [[50, 5]]), [a, b], tracked, since), []);
  assert.deepEqual(newBestsIn(lift("l4", 105, [[90, 5]], { exercise: "x002" }), [a], tracked, since), []); // not tracked
});

test("the logs back to the plan session: placed, done and skipped sessions, futsal, sets done", () => {
  const p = read();
  const thr = newEntry({ id: entryId(p.id, "t001"), planId: p.id, sessionId: "t001", kind: "session", status: "done", day: d("2026-11-03"), doneDay: d("2026-11-03"), effort: 7, pain: 1, note: "knee 1/10, fine", title: "Threshold", detail: "4×4'" });
  const gone = newEntry({ id: entryId(p.id, "t099"), planId: p.id, sessionId: "t099", kind: "session", status: "skipped", day: d("2026-11-02"), title: "Old session" });
  const futsal = newEntry({ id: "f1", planId: p.id, kind: "futsal", status: "done", day: d("2026-11-04"), doneDay: d("2026-11-04"), durationMin: 60, note: 'said "ouch"' });
  const other = newEntry({ id: "f2", planId: "another-plan", kind: "futsal", day: d("2026-11-04") });
  const log = logCsv(p, [thr, gone, futsal, other]).split("\r\n");
  assert.equal(log[0], "session_id,kind,status,scheduled_date,date_done,duration_min,pain_0_10,effort_1_10,note,title,detail");
  assert.equal(log[1], "t001,session,done,2026-11-03,2026-11-03,,1,7,\"knee 1/10, fine\",Threshold,4×4'");
  assert.equal(log[2], "t004,session,planned,2026-11-08,,,,,,Long run,10 km");       // the plan's own day
  assert.equal(log[3], "t005,session,planned,2026-11-15,,,,,,RACE,10 km");
  assert.equal(log[4], "t099,session,skipped,2026-11-02,,,,,,Old session,");          // gone from the plan, still history
  assert.equal(log[5], ',futsal,done,2026-11-04,2026-11-04,60,,,"said ""ouch""",,');
  assert.equal(log.length, 7);

  const l = lift("test-plan:t002:x001", d("2026-11-05"), [[60, 5], [60, 5]], { exercise: "x002", name: "Leg press" });
  l.sets.push({ kg: 60, reps: 5, done: false });
  const sets = setsCsv(p, [l]).split("\r\n");
  assert.equal(sets[0], "session_id,date,exercise_id,swapped_from,set_no,kg,reps,rpe,pain_0_10,note,exercise_name");
  assert.equal(sets[1], "t002,2026-11-05,x002,x001,1,60,5,6,,,Leg press");
  assert.equal(sets.length, 4);
});
