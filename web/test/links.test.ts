import assert from "node:assert/strict";
import { test } from "node:test";
import { findLinks, linkAt, shortUrl } from "../src/domain/links.ts";

const texts = (s: string) => findLinks(s).map((l) => l.text);

test("finds http, https and www links in running text", () => {
  assert.deepEqual(texts("see https://example.com/a?b=1#c and http://x.org now"), ["https://example.com/a?b=1#c", "http://x.org"]);
  assert.deepEqual(findLinks("go to www.example.com/path").map((l) => l.url), ["https://www.example.com/path"]);
  assert.deepEqual(texts("no links here, just example.com and ftp://x.y"), []);
});

test("punctuation after a link is not part of it", () => {
  assert.deepEqual(texts("Read https://example.com/page."), ["https://example.com/page"]);
  assert.deepEqual(texts("(see https://example.com/a)"), ["https://example.com/a"]);
  assert.deepEqual(texts("https://en.wikipedia.org/wiki/Tea_(drink) is good"), ["https://en.wikipedia.org/wiki/Tea_(drink)"]);
  assert.deepEqual(texts('"https://example.com/x", then'), ["https://example.com/x"]);
  assert.deepEqual(texts("https://example.com?!"), ["https://example.com"]);
});

test("positions, and the link at a caret", () => {
  const s = "a https://e.com/x b";
  const [l] = findLinks(s);
  assert.deepEqual([l.start, l.end], [2, 17]);
  assert.equal(linkAt(s, 2)?.text, "https://e.com/x");
  assert.equal(linkAt(s, 17)?.text, "https://e.com/x");
  assert.equal(linkAt(s, 1), null);
  assert.equal(linkAt(s, 18), null);
});

test("rejects things that are not addresses", () => {
  assert.deepEqual(texts("https:// and www. and http://"), []);
  assert.deepEqual(texts("javascript:alert(1)"), []);
});

test("a link ends at the note's blank characters", () => {
  assert.deepEqual(texts("https://a.com/x⠀⠀tail"), ["https://a.com/x"]);
  assert.equal(shortUrl("https://www.example.com/a/"), "example.com/a");
});
