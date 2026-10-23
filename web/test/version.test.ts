import assert from "node:assert/strict";
import { test } from "node:test";
import { UPDATE_CHECK_EVERY_MS, compareVersions, isNewerVersion, parseVersion, releaseNoteBlocks, updateCheckDue } from "../src/domain/version.ts";

test("versions compare part by part, not as text", () => {
  assert.ok(compareVersions("v2.10", "2.9") > 0);
  assert.ok(compareVersions("2.9", "v2.10") < 0);
  assert.equal(compareVersions("v2.1", "2.1"), 0);   // a "v" in front doesn't count
  assert.equal(compareVersions("V2.1", "2.1"), 0);
  assert.equal(compareVersions("2.1", "2.1.0"), 0);  // missing parts are 0
  assert.ok(compareVersions("2.1.1", "2.1") > 0);
  assert.ok(compareVersions("3", "2.99") > 0);
  assert.ok(compareVersions("2.0", "10.0") < 0);
});

test("only a real, newer version is an update", () => {
  assert.equal(isNewerVersion("v2.1", "2.0"), true);
  assert.equal(isNewerVersion("v2.0", "2.0"), false);
  assert.equal(isNewerVersion("v1.9", "2.0"), false);
  assert.equal(isNewerVersion("v2.10", "2.9"), true);
  assert.equal(isNewerVersion("nightly", "2.0"), false);
  assert.equal(isNewerVersion("v2.1", ""), false);
  assert.deepEqual(parseVersion("v2.1-beta"), [2, 1]);
  assert.equal(parseVersion("latest"), null);
});

test("release notes become plain headings, bullets and text", () => {
  const blocks = releaseNoteBlocks("## What's new\r\n\r\n- **Routines** sync to the PC\n* See [the guide](https://example.com) and `Settings`\n1. First\n\n---\nThanks!");
  assert.deepEqual(blocks, [
    { kind: "heading", text: "What's new" },
    { kind: "bullet", text: "Routines sync to the PC" },
    { kind: "bullet", text: "See the guide and Settings" },
    { kind: "bullet", text: "First" },
    { kind: "text", text: "Thanks!" },
  ]);
  assert.deepEqual(releaseNoteBlocks(""), []);
});

test("automatic update checks: at most every 6 hours, on a start or a return to the app", () => {
  const h = 3600_000, t0 = 1_800_000_000_000;
  assert.equal(UPDATE_CHECK_EVERY_MS, 6 * h);
  assert.equal(updateCheckDue(0, t0), true);                 // never checked
  assert.equal(updateCheckDue(NaN, t0), true);               // unreadable
  assert.equal(updateCheckDue(t0, t0 + 1000), false);        // a return a moment later
  assert.equal(updateCheckDue(t0, t0 + 6 * h - 1), false);
  assert.equal(updateCheckDue(t0, t0 + 6 * h), true);        // six hours on
  assert.equal(updateCheckDue(t0, t0 - h), true);            // the clock went back
});
