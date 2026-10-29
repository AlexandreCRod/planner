import assert from "node:assert/strict";
import { test } from "node:test";
import { SIZE_MARK, sizeStyle, withoutMarks } from "../src/domain/textSize.ts";

test("Each size has its style; Normal has none (257)", () => {
  assert.deepEqual(sizeStyle(null), {});
  assert.deepEqual(sizeStyle(28), { fontSize: "28px", fontWeight: "bold" });
  assert.deepEqual(sizeStyle(18), { fontSize: "18px", fontWeight: "bold" });
  assert.deepEqual(sizeStyle(12), { fontSize: "12px" });
});

test("A size's caret mark goes once text is typed beside it, the caret staying put (257)", () => {
  const M = SIZE_MARK;
  // Only the mark: the caret is still waiting in it.
  assert.deepEqual(withoutMarks(M, 1), { data: M, caret: 1 });
  // Typed after the mark.
  assert.deepEqual(withoutMarks(M + "Big", 4), { data: "Big", caret: 3 });
  // Typed before it (the caret went in front of the mark).
  assert.deepEqual(withoutMarks("B" + M, 1), { data: "B", caret: 1 });
  assert.deepEqual(withoutMarks("Bi" + M + "g", null), { data: "Big", caret: null });
  assert.deepEqual(withoutMarks("plain", 2), { data: "plain", caret: 2 });
});
