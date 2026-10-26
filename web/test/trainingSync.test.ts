import assert from "node:assert/strict";
import { test } from "node:test";
import { applyChanges, checkPlan, checkShared, fileChanges } from "../tools/training-sync.ts";
import { planFileId } from "../src/domain/training.ts";
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
