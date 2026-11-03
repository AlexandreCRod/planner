import assert from "node:assert/strict";
import { test } from "node:test";
import { searchEmpty } from "../src/ui/shared/kinds.ts";

// Review of 2.10, finding 8: a chip picked with no words is a search that found nothing, not an empty app.
test("Search's empty block says what fits: words, a chip, or nothing asked", () => {
  assert.deepEqual(searchEmpty("dentist", false), { title: "Nothing found", hint: "Try other words or fewer filters" });
  assert.deepEqual(searchEmpty("dentist", true), { title: "Nothing found", hint: "Try other words or fewer filters" });
  assert.deepEqual(searchEmpty("  ", true), { title: "Nothing found", hint: "Try fewer filters" });
  assert.deepEqual(searchEmpty("", false), { title: "Nothing here yet", hint: "What you add shows up here" });
});

test("341: a routine is called Routine and found under Routines only; a repeating task that isn't one stays Recurring task", async () => {
  const { KINDS, typeLabel } = await import("../src/ui/shared/kinds.ts");
  const { newItem } = await import("../src/domain/types.ts");
  const routine = { ...newItem({ type: "TASK", title: "Stretch", startDay: 20000, freq: "DAILY" }), routine: true };
  const repeating = newItem({ type: "TASK", title: "Bins", startDay: 20000, freq: "WEEKLY" });
  const kindsOf = (i: typeof routine) => KINDS.filter(([k, , t]) => k !== "ALL" && t(i)).map(([k]) => k);
  assert.equal(typeLabel(routine), "Routine");
  assert.deepEqual(kindsOf(routine), ["ROUTINES"]);
  assert.equal(typeLabel(repeating), "Recurring task");
  assert.deepEqual(kindsOf(repeating), ["RECURRING_TASKS"]);
});
