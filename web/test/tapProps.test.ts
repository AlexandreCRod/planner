import assert from "node:assert/strict";
import { test } from "node:test";
import { tapProps } from "../src/ui/phone/tapProps.ts";

// Review of 2.10.3, finding 6: in Training's week, a session's line sits inside its day, and both open on Enter.
// A key or click on the line goes up to the day after it (as the browser does), unless the line stops it.
type Ev = { key?: string; stopped: boolean; preventDefault(): void; stopPropagation(): void };
const ev = (key?: string): Ev => ({ key, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; } });
/** What a key or click on the session's line opens: the line's handler, then the day's unless stopped. */
function press(kind: "onKeyDown" | "onClick", key?: string) {
  const opened: string[] = [];
  const day = tapProps(() => opened.push("week page"));
  const line = tapProps(() => opened.push("session"), { stop: true });
  const e = ev(key);
  (line[kind] as (e: unknown) => void)(e);
  if (!e.stopped) (day[kind] as (e: unknown) => void)(e);
  return opened;
}

test("Enter or Space on a session in the week opens the session, not its day's week page", () => {
  assert.deepEqual(press("onKeyDown", "Enter"), ["session"]);
  assert.deepEqual(press("onKeyDown", " "), ["session"]);
});

test("a tap or click on a session opens the session only", () => {
  assert.deepEqual(press("onClick"), ["session"]);
});

test("Enter on the day itself still opens the week page; other keys open nothing", () => {
  const opened: string[] = [];
  const day = tapProps(() => opened.push("week page"));
  day.onKeyDown(ev("Enter") as never);
  day.onKeyDown(ev("a") as never);
  assert.deepEqual(opened, ["week page"]);
});
