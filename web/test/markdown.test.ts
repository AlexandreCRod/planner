import assert from "node:assert/strict";
import { test } from "node:test";
import { type Block, type Inline, anchorsIn, inlines, parseMarkdown, plainOf } from "../src/domain/markdown.ts";

const kinds = (bs: Block[]) => bs.map((b) => b.t);

test("inline: bold, italic, code, links and bold links", () => {
  assert.deepEqual(inlines("a **b** *c* `d`"), [
    { t: "text", text: "a " }, { t: "strong", children: [{ t: "text", text: "b" }] }, { t: "text", text: " " },
    { t: "em", children: [{ t: "text", text: "c" }] }, { t: "text", text: " " }, { t: "code", text: "d" },
  ]);
  const bl = inlines("1. **[Front squat](Exercise-Guide.md#front-squat)**, slow");
  const strong = bl[1] as Extract<Inline, { t: "strong" }>;
  assert.equal(strong.t, "strong");
  assert.deepEqual(strong.children[0], { t: "link", href: "Exercise-Guide.md#front-squat", children: [{ t: "text", text: "Front squat" }] });
  // Parentheses inside a web address are kept.
  const w = inlines("[Carb loading](https://en.wikipedia.org/wiki/Loading_(diet)) here");
  assert.equal((w[0] as Extract<Inline, { t: "link" }>).href, "https://en.wikipedia.org/wiki/Loading_(diet)");
  assert.equal(plainOf(w), "Carb loading here");
});

test("inline: what isn't emphasis stays text", () => {
  assert.equal(plainOf(inlines("2 * 3 = 6, snake_case_name, 5*")), "2 * 3 = 6, snake_case_name, 5*");
  assert.equal(plainOf(inlines("a \\*star\\* &amp; &lt;b&gt;")), "a *star* & <b>");
  // Bare web addresses become links, without the full stop after them.
  const u = inlines("See https://example.com/a_b. Then");
  assert.deepEqual(u[1], { t: "link", href: "https://example.com/a_b", children: [{ t: "text", text: "https://example.com/a_b" }] });
  // Unknown inline HTML is dropped, its text kept; <br> breaks the line.
  assert.deepEqual(inlines("x<span>y</span><br>z"), [{ t: "text", text: "xy" }, { t: "br" }, { t: "text", text: "z" }]);
});

test("blocks: headings with the same ids as the anchor finder, rules, anchors", () => {
  const md = "# Title\n\nSome *text*\non two lines.\n\n---\n\n<a id=\"card-a\"></a>\n\n## Notes\n\n## Notes\n";
  const bs = parseMarkdown(md);
  assert.deepEqual(kinds(bs), ["heading", "para", "hr", "anchor", "heading", "heading"]);
  const ids = bs.flatMap((b) => (b.t === "heading" ? [b.id] : b.t === "anchor" ? [b.id] : []));
  assert.deepEqual(ids, [...anchorsIn(md).keys()]);
  assert.equal(plainOf((bs[1] as Extract<Block, { t: "para" }>).children), "Some text on two lines.");
});

test("blocks: nested lists, numbered and not, with paragraphs right before them", () => {
  const md = [
    "**Warm-up**",
    "1. 5' bike",
    "2. Ankle warm-up",
    "   - band 2×15",
    "   - balance",
    "3. Ramp-up sets",
    "",
    "- one",
    "  - one.a",
    "",
    "- two",
    "",
    "After.",
  ].join("\n");
  const bs = parseMarkdown(md);
  assert.deepEqual(kinds(bs), ["para", "list", "list", "para"]);
  const ol = bs[1] as Extract<Block, { t: "list" }>;
  assert.equal(ol.ordered, true);
  assert.equal(ol.items.length, 3);
  assert.deepEqual(kinds(ol.items[1]), ["para", "list"]);
  assert.equal((ol.items[1][1] as Extract<Block, { t: "list" }>).items.length, 2);
  const ul = bs[2] as Extract<Block, { t: "list" }>;
  assert.equal(ul.ordered, false);
  assert.equal(ul.items.length, 2, "a blank line between items keeps the list going");
  assert.deepEqual(kinds(ul.items[0]), ["para", "list"]);
});

test("blocks: details with a summary, tables, quotes and code", () => {
  const md = [
    "<details>",
    "<summary>Sources</summary>",
    "",
    "- [A](https://a.example)",
    "",
    "</details>",
    "",
    "| Distance | Time |",
    "|---|---:|",
    "| 5 km | 22:52 |",
    "",
    "> Quoted **bit**",
    "",
    "```",
    "raw *text*",
    "```",
  ].join("\n");
  const bs = parseMarkdown(md);
  assert.deepEqual(kinds(bs), ["details", "table", "quote", "code"]);
  const d = bs[0] as Extract<Block, { t: "details" }>;
  assert.equal(plainOf(d.summary), "Sources");
  assert.deepEqual(kinds(d.blocks), ["list"]);
  const tb = bs[1] as Extract<Block, { t: "table" }>;
  assert.deepEqual(tb.head.map(plainOf), ["Distance", "Time"]);
  assert.deepEqual(tb.rows.map((r) => r.map(plainOf)), [["5 km", "22:52"]]);
  assert.equal((bs[3] as Extract<Block, { t: "code" }>).text, "raw *text*");
});
