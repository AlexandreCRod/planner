import assert from "node:assert/strict";
import { test } from "node:test";
import { photoLines, readExif } from "../src/domain/exif.ts";

// 379: a photo's date taken, camera, size and place, from its EXIF. A small JPEG with an EXIF block, built here.
type E = { tag: number; type: number; count: number; data: number[] };
function jpegWithExif(le: boolean, orientation?: number): ArrayBuffer {
  const bytes: number[] = [];
  const u16 = (n: number) => (le ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const rat = (...xs: [number, number][]) => xs.flatMap(([a, b]) => [...u32(a), ...u32(b)]);
  // Layout: header (8), IFD0 at 8, Exif IFD, GPS IFD, then the data they point to.
  const ifd0: E[] = [
    { tag: 0x010f, type: 2, count: 7, data: ascii("Google") },
    { tag: 0x0110, type: 2, count: 9, data: ascii("Pixel 6a") },
    ...(orientation ? [{ tag: 0x0112, type: 3, count: 1, data: u16(orientation) }] : []),
    { tag: 0x8769, type: 4, count: 1, data: [] }, { tag: 0x8825, type: 4, count: 1, data: [] },
  ];
  const exif: E[] = [
    { tag: 0x9003, type: 2, count: 20, data: ascii("2026:11:03 14:05:12") },
    { tag: 0xa002, type: 4, count: 1, data: u32(4032) }, { tag: 0xa003, type: 4, count: 1, data: u32(3024) },
  ];
  const gps: E[] = [
    { tag: 1, type: 2, count: 2, data: ascii("N") }, { tag: 2, type: 5, count: 3, data: rat([38, 1], [43, 1], [2028, 100]) },
    { tag: 3, type: 2, count: 2, data: ascii("W") }, { tag: 4, type: 5, count: 3, data: rat([9, 1], [8, 1], [2148, 100]) },
  ];
  const size = (l: E[]) => 2 + l.length * 12 + 4;
  const at0 = 8, atExif = at0 + size(ifd0), atGps = atExif + size(exif);
  let data = atGps + size(gps);
  const extra: number[] = [];
  const write = (l: E[], fix: Record<number, number> = {}) => {
    const out = [...u16(l.length)];
    for (const e of l) {
      out.push(...u16(e.tag), ...u16(e.type), ...u32(e.count));
      if (e.tag in fix) out.push(...u32(fix[e.tag]));
      else if (e.data.length <= 4) out.push(...e.data, ...Array(4 - e.data.length).fill(0));
      else { out.push(...u32(data)); extra.push(...e.data); data += e.data.length; }
    }
    return out.concat(u32(0));
  };
  const tiff = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8),
    ...write(ifd0, { 0x8769: atExif, 0x8825: atGps }), ...write(exif), ...write(gps), ...extra];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  bytes.push(0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9);
  return new Uint8Array(bytes).buffer;
}

for (const le of [false, true]) {
  test(`reads when, the camera, the original size and the place (${le ? "little" : "big"}-endian)`, () => {
    const info = readExif(jpegWithExif(le));
    assert.equal(info.taken, "2026:11:03 14:05:12");
    assert.equal(info.camera, "Google Pixel 6a");
    assert.deepEqual([info.width, info.height], [4032, 3024]);
    assert.ok(Math.abs(info.lat! - 38.72230) < 1e-4, String(info.lat));
    assert.ok(Math.abs(info.lng! - -9.13930) < 1e-4, String(info.lng));
  });
}

test("a photo without EXIF (or not a JPEG) has no details, and shows the date it was added", () => {
  assert.deepEqual(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), {});
  assert.deepEqual(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), {});
  const lines = photoLines(null, new Date(2026, 10, 7, 9, 30), { width: 1600, height: 1200 }, (d) => `${d.getDate()}/${d.getMonth() + 1}`);
  assert.deepEqual(lines, ["Added 7/11", "1600 × 1200 · 1.9 MP"]);
});

test("with EXIF: taken first, then added, the camera, the original size and the coordinates", () => {
  const lines = photoLines(readExif(jpegWithExif(false)), new Date(2026, 10, 7), { width: 1600, height: 1200 }, (d) => `${d.getDate()}/${d.getMonth() + 1}`);
  assert.deepEqual(lines, ["Taken 3/11", "Added 7/11", "Google Pixel 6a", "4032 × 3024 · 12.2 MP", "38.72230, -9.13930"]);
});

// Review of 2.10.4, finding 6: a phone photo held upright is stored sideways with an orientation saying so.
for (const le of [false, true]) {
  test(`a photo taken upright gives its size upright (${le ? "little" : "big"}-endian)`, () => {
    for (const o of [5, 6, 7, 8]) assert.deepEqual(((i) => [i.width, i.height])(readExif(jpegWithExif(le, o))), [3024, 4032], `orientation ${o}`);
    for (const o of [1, 3]) assert.deepEqual(((i) => [i.width, i.height])(readExif(jpegWithExif(le, o))), [4032, 3024], `orientation ${o}`);
  });
}
