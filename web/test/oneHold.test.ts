import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// 342: press and hold waits one time everywhere (press.ts LONG_PRESS). A hold timer is a setTimeout that
// fires a pick-up, a lift, a menu or the like; any of them written with its own number is a second hold time.
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
});
const src = files(new URL("../src/ui", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

test("no hold keeps a time of its own", () => {
  const bad: string[] = [];
  for (const f of src) {
    const text = readFileSync(f, "utf8");
    text.split("\n").forEach((line, i) => {
      // A hold's own constant (const X_HOLD = 400, const LONG_PRESS_MS = 500...), other than the one in press.ts.
      if (/const\s+\w*(LONG_PRESS|HOLD)\w*\s*=\s*\d+/.test(line) && !/press\.ts$/.test(f)
        && !/EDGE_HOLD/.test(line) && !/ProgressChart/.test(f)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      // A timer that picks up or opens on a hold, with a number for its time.
      if (/setTimeout\(.*(pickup|lift|onLong|onHold|onOpen).*,\s*\d{3}\s*\)/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});
