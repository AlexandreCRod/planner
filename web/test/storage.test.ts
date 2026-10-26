import assert from "node:assert/strict";
import { test } from "node:test";
import { STORAGE_LIMIT, sizeText, storageUse } from "../src/domain/storage.ts";

test("sizes read in KB, MB and GB, with one decimal under 10", () => {
  assert.equal(sizeText(840_000), "820 KB");
  assert.equal(sizeText(4.2 * 1024 ** 2), "4.2 MB");
  assert.equal(sizeText(42 * 1024 ** 2), "42 MB");
  assert.equal(sizeText(1024 ** 3), "1 GB");
  assert.equal(sizeText(1.25 * 1024 ** 3), "1.3 GB");
});

test("storage use: the text, the share, and a warning from 80%", () => {
  assert.deepEqual(storageUse(42 * 1024 ** 2), { text: "42 MB of 1 GB", share: 42 / 1024, warn: false });
  assert.equal(storageUse(0.8 * STORAGE_LIMIT).warn, true);
  assert.equal(storageUse(2 * STORAGE_LIMIT).share, 1);
});
