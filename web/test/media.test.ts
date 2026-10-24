import assert from "node:assert/strict";
import { test } from "node:test";
import { LENS_MINI, downloadName, filesToFetch, isVideo, lensPlace, lensPosFor, lensStep, miniScale, pieces, previewHash, syncedFile } from "../src/domain/media.ts";

// Items 80 and 96: a note's pictures and videos.

const pic = { mime: "image/jpeg", hash: "p1", createdAt: new Date(2026, 9, 23, 14, 5, 9).getTime() };
const vid = { mime: "video/mp4", hash: "v1", poster: "s1", createdAt: pic.createdAt };

test("a video's file never syncs: only its still does", () => {
  assert.deepEqual(syncedFile(pic), { hash: "p1", mime: "image/jpeg" });
  assert.deepEqual(syncedFile(vid), { hash: "s1", mime: "image/jpeg" });
  assert.equal(syncedFile({ mime: "video/webm", hash: "v2" }), null);
  // Older records with no type are pictures.
  assert.deepEqual(syncedFile({ mime: "", hash: "p2" }), { hash: "p2", mime: "image/jpeg" });
  assert.equal(isVideo({ mime: undefined as unknown as string }), false);
});

test("previews show a picture itself, a video's still", () => {
  assert.equal(previewHash(pic), "p1");
  assert.equal(previewHash(vid), "s1");
  assert.equal(previewHash({ mime: "video/mp4", hash: "v3" }), "");
});

test("saved files are named by when they were added, with the right extension", () => {
  assert.equal(downloadName(pic), "Planner 2026-10-23 140509.jpg");
  assert.equal(downloadName(vid), "Planner 2026-10-23 140509.mp4");
  assert.equal(downloadName({ mime: "video/quicktime", createdAt: pic.createdAt }), "Planner 2026-10-23 140509.mov");
});

test("a file is sent in whole base64 pieces, covering it exactly", () => {
  const ps = pieces(10, 4);
  assert.deepEqual(ps, [[0, 3], [3, 6], [6, 9], [9, 10]]);
  assert.deepEqual(pieces(0), []);
  for (const [a, b] of pieces(5_000_000)) assert.equal((b - a) % 3 === 0 || b === 5_000_000, true);
});

test("the lens: the middle one big, the others true miniatures beside it, moving smoothly between", () => {
  const W = 246; // a 411 px wide phone
  assert.deepEqual(lensPlace(0, W, miniScale(W, 400)), { x: 0, scale: 1, opacity: 1 });
  // A portrait picture as big as the big one: shrunk to a miniature, its longer side LENS_MINI px.
  const mini = miniScale(W, 400);
  const right = lensPlace(1, W, mini), left = lensPlace(-1, W, mini);
  assert.ok(Math.abs(400 * right.scale - LENS_MINI) < 1e-9);
  assert.ok(LENS_MINI <= 64); // a miniature, not a smaller picture
  assert.equal(left.x, -right.x);
  // The miniature beside the big one doesn't overlap it, and is in sight on the screen.
  assert.ok(right.x - (W * right.scale) / 2 >= W / 2);
  assert.ok(right.x + LENS_MINI / 2 <= W / 0.6 / 2);
  // Continuous: a little past 1 is a little further on.
  const a = lensPlace(0.999, W, mini).x, b = lensPlace(1.001, W, mini).x;
  assert.ok(Math.abs(a - b) < 1);
  assert.ok(lensPlace(5, W, mini).opacity === 0);
});

test("the lens: the finger moving right brings the ones on the right to the middle", () => {
  const p = lensPosFor(2, 30);
  assert.ok(p > 2);
  // One miniature's width to the right: the next one is in the middle; to the left, the previous one.
  assert.ok(Math.abs(lensPosFor(2, lensStep()) - 3) < 1e-9);
  assert.ok(Math.abs(lensPosFor(2, -lensStep()) - 1) < 1e-9);
});

// Item 156: a picture added on another device is fetched after the sync that brings its record.
test("after a sync, each note picture's file (or a video's still) is fetched once", () => {
  const records: [string, unknown][] = [
    ["images/1", { noteId: 5, hash: "p1", mime: "image/jpeg" }],
    ["images/2", { noteId: 6, hash: "p1" }], // the same file in two notes; an old record without a mime
    ["images/3", { noteId: 5, hash: "v1", mime: "video/mp4", poster: "s1" }],
    ["images/4", { noteId: 5, hash: "v2", mime: "video/mp4" }], // a video with no still: nothing to fetch
    ["items/5", { id: 5, hash: "not-a-file" }],
  ];
  assert.deepEqual(filesToFetch(records), ["p1", "s1"]);
  assert.deepEqual(filesToFetch(new Map(records)), ["p1", "s1"]);
});
