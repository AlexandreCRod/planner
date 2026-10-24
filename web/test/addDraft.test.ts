import assert from "node:assert/strict";
import { test } from "node:test";
import { onSlot, takeKept, worthKeeping } from "../src/ui/phone/addDraft.ts";

test("a flicked-away panel keeps its draft only when something was typed, and never a saved one", () => {
  assert.equal(worthKeeping("Dentist tue 3pm", true, "", 0), true);
  assert.equal(worthKeeping("   ", true, "Dentist", 0), false); // the line is what counts while it's the line
  assert.equal(worthKeeping("", false, "Dentist", 0), true); // grown into the editor: its title
  assert.equal(worthKeeping("", false, " ", 0), false);
  assert.equal(worthKeeping("x", true, "x", 12), false); // already saved by the editor
});

test("the kept draft comes back once, to a panel of its own kind", () => {
  const kept = { mode: "quick" as const, state: { text: "Call mom" } };
  assert.deepEqual(takeKept(kept, "slot"), { state: null, rest: kept }); // a slot panel leaves it for later
  assert.deepEqual(takeKept(kept, "quick"), { state: { text: "Call mom" }, rest: null });
  assert.deepEqual(takeKept(null, "quick"), { state: null, rest: null });
});

test("a slot draft moves to the slot tapped next, keeping its length", () => {
  const ev = { startDay: 100, endDay: 100, startMin: 540, endMin: 630, allDay: false, title: "Gym" };
  assert.deepEqual(onSlot(ev, 105, 600), { ...ev, startDay: 105, endDay: 105, startMin: 600, endMin: 690 });
  // Never past the end of the day.
  assert.equal(onSlot(ev, 105, 23 * 60 + 30).endMin, 24 * 60 - 1);
  // Over two days, it stays over two days; all day stays all day.
  assert.deepEqual(onSlot({ ...ev, endDay: 101, allDay: true, startMin: null, endMin: null }, 7, 600), { ...ev, startDay: 7, endDay: 8, allDay: true, startMin: null, endMin: null });
  // A task (no end) only moves.
  assert.deepEqual(onSlot({ ...ev, endDay: null, endMin: null }, 7, 480), { ...ev, startDay: 7, endDay: null, startMin: 480, endMin: null });
});
