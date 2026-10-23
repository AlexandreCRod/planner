import assert from "node:assert/strict";
import { test } from "node:test";
import { LENS_SMALL, downloadName, isVideo, lensPlace, lensPosFor, lensStep, pieces, previewHash, syncedFile } from "../src/domain/media.ts";

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

test("the lens: the middle one big, the others smaller beside it, moving smoothly between", () => {
  const W = 300;
  assert.deepEqual(lensPlace(0, W), { x: 0, scale: 1, opacity: 1 });
  const right = lensPlace(1, W), left = lensPlace(-1, W);
  assert.ok(Math.abs(right.scale - LENS_SMALL) < 1e-9);
  assert.ok(LENS_SMALL < 0.4); // much smaller than the big one
  assert.equal(left.x, -right.x);
  // The small one beside the big one doesn't overlap it.
  assert.ok(right.x - (W * right.scale) / 2 >= W / 2);
  // Continuous: a little past 1 is a little further on.
  const a = lensPlace(0.999, W).x, b = lensPlace(1.001, W).x;
  assert.ok(Math.abs(a - b) < 1);
  assert.ok(lensPlace(4, W).opacity === 0);
});

test("the lens follows the finger: the big one stays under it, left brings the next one in", () => {
  const W = 246; // a 411 px wide phone
  // Finger 30 px to the right: the big one moves 30 px to the right, toward the previous one.
  const p = lensPosFor(2, 30, W);
  assert.ok(p < 2);
  assert.ok(Math.abs(lensPlace(2 - p, W).x - 30) < 1e-9);
  // A whole step to the left: the next one is in the middle.
  assert.ok(Math.abs(lensPosFor(2, -lensStep(W), W) - 3) < 1e-9);
  // The previous and next ones are mostly in sight at the sides of the screen.
  const next = lensPlace(1, W), screen = W / 0.6;
  const visible = (screen / 2 - (next.x - (W * next.scale) / 2)) / (W * next.scale);
  assert.ok(visible > 0.7, String(visible));
});
