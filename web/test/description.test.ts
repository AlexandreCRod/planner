import assert from "node:assert/strict";
import { test } from "node:test";
import { descriptionText, plainToHtml } from "../src/domain/text.ts";

// Round 10, item 40: a task's or event's description is edited as plain text.

test("plain text round-trips through the stored HTML", () => {
  for (const t of ["Bring the forms", "Line one\nLine two", "a\n\nb", "x < y & z > 2", "☐ milk\n☑ eggs"]) {
    assert.equal(descriptionText(plainToHtml(t)), t);
  }
  assert.equal(plainToHtml("  \n "), "");
  assert.equal(plainToHtml("a\n\n"), "<p>a</p>");
});

test("rich descriptions read sensibly as plain text", () => {
  assert.equal(descriptionText("<p>Hello <b>there</b></p><p>Second&nbsp;line</p>"), "Hello there\nSecond line");
  assert.equal(descriptionText("<ul><li>one</li><li>two</li></ul><p>after</p>"), "• one\n• two\nafter");
  assert.equal(descriptionText("<ol><li>first</li><li>second</li></ol>"), "1. first\n2. second");
  assert.equal(descriptionText("<p dir=\"ltr\">Android</p>\n<p dir=\"ltr\">html</p>\n"), "Android\nhtml");
  assert.equal(descriptionText("<p>a</p><p><br></p><p>b</p>"), "a\n\nb");
  assert.equal(descriptionText("one<br>two"), "one\ntwo");
  assert.equal(descriptionText("<p>&lt;tag&gt; &amp; &#39;quote&#39;</p>"), "<tag> & 'quote'");
  assert.equal(descriptionText("Plain old text"), "Plain old text");
});
