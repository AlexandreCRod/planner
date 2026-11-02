import assert from "node:assert/strict";
import { test } from "node:test";
import { noteCardText, notePreview } from "../src/domain/text.ts";

// Item 89: previews on the Notes page keep the note's lines, with checkboxes shown as boxes.

test("a preview keeps paragraphs and shows checkboxes as ☐ / ☑ lines", () => {
  const html = "<p>Shopping</p><p>☐ milk</p><p>☑ <span style=\"text-decoration: line-through\">eggs</span></p><p><br></p><p>Then the rest</p>";
  assert.equal(notePreview(html), "Shopping\n☐ milk\n☑ eggs\nThen the rest");
});

test("lists and indented boxes keep their marks and indent", () => {
  assert.equal(notePreview("<ul><li>a</li><li>b</li></ul><ol><li>one</li></ol><p>⠀⠀⠀☐ sub</p>"), "• a\n• b\n1. one\n  ☐ sub");
});

test("a preview stops after its lines or characters", () => {
  const many = Array.from({ length: 12 }, (_, i) => `<p>line ${i}</p>`).join("");
  assert.equal(notePreview(many).split("\n").length, 8);
  const long = notePreview(`<p>${"x".repeat(300)}</p><p>next</p>`, 50);
  assert.equal(long, "x".repeat(49) + "…");
});

// 227: cards show the open lines; ticked boxes fold away under "+ N ticked".
test("a card leaves out ticked boxes and counts them, keeping the rest in order", () => {
  const html = "<p>Packing</p><p>☐ Rain jacket</p><p>☑ <span style=\"text-decoration: line-through\">Book</span></p><p>⠀⠀⠀☐ Charger</p><p>☑ Shoes</p><p>Done by Friday</p>";
  const c = noteCardText(html);
  assert.deepEqual(c.lines.map((l) => [l.kind, l.text, l.level, l.checked]), [
    ["TEXT", "Packing", 0, false], ["CHECK", "Rain jacket", 0, false], ["CHECK", "Charger", 1, false], ["TEXT", "Done by Friday", 0, false],
  ]);
  assert.equal(c.ticked, 2);
  assert.equal(c.more, false);
});

test("a card stops after its lines or characters and says there's more", () => {
  const many = Array.from({ length: 12 }, (_, i) => `<p>☐ item ${i}</p>`).join("") + "<p>☑ old</p>";
  const c = noteCardText(many);
  assert.equal(c.lines.length, 8);
  assert.equal(c.more, true);
  assert.equal(c.ticked, 1);
  const long = noteCardText(`<p>${"x".repeat(300)}</p><p>next</p>`, 50);
  assert.deepEqual(long.lines.map((l) => l.text), ["x".repeat(49) + "…"]);
  assert.equal(long.more, true);
  assert.deepEqual(noteCardText("<p>☑ a</p><p>☑ b</p>"), { lines: [], ticked: 2, more: false });
});

test("a card doesn't end in a line that would be only an ellipsis", () => {
  const c = noteCardText(`<p>${"a".repeat(40)}</p><p>${"b".repeat(15)}</p><p>more text here</p>`, 60);
  assert.deepEqual(c.lines.map((l) => l.text), ["a".repeat(40), "b".repeat(15)]);
  assert.equal(c.more, true);
});
