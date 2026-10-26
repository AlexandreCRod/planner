import assert from "node:assert/strict";
import { test } from "node:test";
import { charsetOf, decodeEntities, isPrivateHost, parsePage, parseWebUrl, toBase64 } from "../src/preview.ts";

test("only public http(s) addresses are accepted", () => {
  assert.equal(parseWebUrl("https://example.com/a?b=1")?.hostname, "example.com");
  assert.equal(parseWebUrl("http://example.com")?.protocol, "http:");
  for (const bad of [
    "", "nope", "ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@example.com",
    "http://localhost:8787", "http://app.localhost", "http://127.0.0.1", "http://10.1.2.3", "http://192.168.0.5/x", "http://172.20.0.1",
    "http://169.254.169.254/latest", "http://0.0.0.0", "http://[::1]/", "http://[fd12:3456::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/",
    "http://2130706433/", "http://0x7f.0.0.1/", "http://printer.local/", "http://100.64.0.1",
  ]) assert.equal(parseWebUrl(bad), null, bad);
  assert.equal(isPrivateHost("172.32.0.1"), false);
  assert.equal(isPrivateHost("8.8.8.8"), false);
  assert.equal(isPrivateHost("example.com"), false);
});

test("a page's meta tags and title", () => {
  const html = `<html><head><title> Fallback &amp; title </title>
    <meta property="og:title" content="Great &quot;read&quot;">
    <meta name="twitter:description" content="Short  text">
    <meta property='og:site_name' content='The Site'>
    <meta property="og:image" content="/img/cover.jpg"></head></html>`;
  const p = parsePage(html, "https://www.example.com/post/1");
  assert.equal(p.title, 'Great "read"');
  assert.equal(p.description, "Short text");
  assert.equal(p.site, "The Site");
  assert.equal(p.imageUrl, "https://www.example.com/img/cover.jpg");
});

test("falls back to <title>, the host and no picture", () => {
  const p = parsePage("<title>Just a title</title>", "https://www.example.org/x");
  assert.deepEqual([p.title, p.description, p.site, p.imageUrl], ["Just a title", "", "example.org", ""]);
});

test("entities, base64 and charset", () => {
  assert.equal(decodeEntities("a&nbsp;&lt;b&gt; &#65;&#x42; &unknown;"), "a <b> AB &unknown;");
  assert.equal(toBase64(new Uint8Array([104, 105])), "aGk=");
  assert.equal(charsetOf("text/html; charset=ISO-8859-1", ""), "iso-8859-1");
  assert.equal(charsetOf("text/html", '<meta charset="windows-1252">'), "windows-1252");
  assert.equal(charsetOf("text/html", ""), "utf-8");
});
