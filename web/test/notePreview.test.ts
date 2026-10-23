import assert from "node:assert/strict";
import { test } from "node:test";
import { notePreview } from "../src/domain/text.ts";

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
