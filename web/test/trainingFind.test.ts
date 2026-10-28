import assert from "node:assert/strict";
import { test } from "node:test";
import { readPlan } from "../src/domain/training.ts";
import { findInTraining, guideParts, snippet } from "../src/domain/trainingFind.ts";

// A made-up plan and guide (the real ones stay out of this public repo).
const plan = () => {
  const r = readPlan({
    version: 1,
    plan: { id: "p", name: "Test", start: "2026-11-02", end: "2026-11-15" },
    documents: [{ file: "Guide.md", title: "Exercise guide" }, { file: "Days.md", title: "Workout days" }],
    exercises: [
      { id: "x1", name: "Front squat", card: { doc: "Guide.md", anchor: "ex-front-squat" }, type: "weighted", log: "sets" },
      { id: "x2", name: "Leg press", card: null, type: "weighted", log: "sets" },
      { id: "x3", name: "Spanish squat", card: { doc: "Guide.md", anchor: "spanish-squat" }, type: "timed", log: "tick" },
      { id: "x4", name: "Squat jump", card: null, type: "bodyweight", log: "sets" },
    ],
    phases: [{
      name: "Week 1", start: "2026-11-02", end: "2026-11-08", summary: "", rules: [], notes: [],
      sessions: [
        { id: "t1", title: "Easy run", detail: "25'", kind: "run", card: null },
        {
          id: "t2", title: "Gym S1 · Full body", detail: "Legs, back", kind: "gym", card: null,
          exercises: [
            { exercise: "x3", group: "warm-up", sets: "1", reps: "45 s", swaps: [] },
            { exercise: "x1", group: "main", sets: "3", reps: "5", swaps: [{ exercise: "x2", when: "If it hurts" }] },
          ],
        },
        { id: "t3", title: "Squats at home", detail: "", kind: "other", card: null },
      ],
    }],
  });
  assert.deepEqual(r.problems, []);
  return r.plan!;
};

const GUIDE = [
  "# Exercise guide", "", "Sets are on the cards.", "",
  '<a id="ex-front-squat"></a>', "", "### Front squat",
  "[Video](https://www.youtube.com/results?search_query=front+squat+technique)",
  "- Elbows high, brace before each rep.", "- 2–3 s down.", "",
  "### Spanish squat",
  "**For:** the knee. Gym and home. [Video](https://www.youtube.com/results?search_query=spanish+squat)",
  "- **Do:** sit back as if onto a chair. Keep your shins vertical.", "",
  "```", "squat inside code still counts", "```",
].join("\n");
const DAYS = "# Workout days\n\n## Gym session\n\nFront squat, controlled 2–3 s down.\n\n## Rest\n\nNothing here.";
const docs = new Map([["Guide.md", GUIDE], ["Days.md", DAYS]]);

test("nothing is found for an empty query", () => {
  assert.deepEqual(findInTraining(plan(), docs, "  "), { sessions: [], exercises: [], guides: [] });
});

test("sessions are found by title, detail and the exercises in them (swaps too)", () => {
  const h = findInTraining(plan(), docs, "squat");
  assert.deepEqual(h.sessions.map((s) => [s.id, s.matched]), [["t2", ["Spanish squat", "Front squat"]], ["t3", []]]);
  assert.deepEqual(findInTraining(plan(), docs, "leg press").sessions.map((s) => s.id), ["t2"]);
  assert.deepEqual(findInTraining(plan(), docs, "LEGS").sessions.map((s) => [s.id, s.matched]), [["t2", ["Legs, back"]]]);
});

test("exercises are found by name, those starting with a word of it first", () => {
  assert.deepEqual(findInTraining(plan(), docs, "squat").exercises.map((e) => e.id), ["x1", "x3", "x4"]);
  assert.deepEqual(findInTraining(plan(), docs, "qua").exercises.map((e) => e.id), ["x1", "x3", "x4"]);
  assert.deepEqual(findInTraining(plan(), docs, "spanish").exercises.map((e) => e.id), ["x3"]);
});

test("guide text is found once per section, with the heading's place and the line that matched", () => {
  const g = findInTraining(plan(), docs, "chair").guides;
  assert.deepEqual(g, [{ file: "Guide.md", doc: "Exercise guide", anchor: "spanish-squat", heading: "Spanish squat", text: "Do: sit back as if onto a chair. Keep your shins vertical." }]);
  const sq = findInTraining(plan(), docs, "squat").guides;
  assert.deepEqual(sq.map((x) => [x.doc, x.heading, x.anchor]), [
    ["Exercise guide", "Front squat", "front-squat"], ["Exercise guide", "Spanish squat", "spanish-squat"], ["Workout days", "Gym session", "gym-session"],
  ]);
  // A heading match takes the section's first matching line as its text; link targets don't count.
  assert.equal(sq[0].text, "");
  assert.equal(sq[1].text, "squat inside code still counts");
  assert.equal(findInTraining(plan(), docs, "youtube").guides.length, 0);
  // Before the first heading, the document's own title.
  assert.deepEqual(findInTraining(plan(), docs, "cards").guides.map((x) => [x.heading, x.anchor]), [["Exercise guide", "exercise-guide"]]);
  // Accents and case don't matter.
  assert.equal(findInTraining(plan(), docs, "ÉLBOWS").guides[0].heading, "Front squat");
});

test("a long line is cut around its match", () => {
  const long = `${"word ".repeat(30)}target ${"tail ".repeat(30)}`.trim();
  const s = snippet(long, "target");
  assert.ok(s.startsWith("…") && s.endsWith("…"), s);
  assert.ok(s.includes("target"));
  assert.ok(s.length <= 94, String(s.length));
  assert.equal(snippet("short line", "line"), "short line");
});

test("a guide card splits into its video search and the rest", () => {
  const p = guideParts("### Front squat\n[Video](https://www.youtube.com/results?search_query=front+squat+technique)\n- Elbows high.\n- 2–3 s down.");
  assert.deepEqual(p, { video: { url: "https://www.youtube.com/results?search_query=front+squat+technique", query: "front squat technique" }, body: "- Elbows high.\n- 2–3 s down." });
  const q = guideParts("### Spanish squat\n**For:** the knee. Gym and home. [Video](https://www.youtube.com/results?search_query=spanish+squat)\n- Do it.");
  assert.equal(q.body, "**For:** the knee. Gym and home.\n- Do it.");
  assert.equal(q.video?.query, "spanish squat");
  // Other links stay; no video, no change but the heading.
  const r = guideParts("### Strides\n- See [the plan](Plan.md#strides).");
  assert.deepEqual(r, { video: null, body: "- See [the plan](Plan.md#strides)." });
});
