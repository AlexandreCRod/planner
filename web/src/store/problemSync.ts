// The problem log syncs (265): this device's log (problems.ts) goes into one record of kind "problemLogs"
// whose id is this device's own random id, rewritten a few seconds after the log changes. No other device
// writes it, so it never conflicts; an older app keeps the unknown kind untouched. Settings → Problem log
// still shows and copies the local log.
import { isNative } from "../platform.ts";
import { type ProblemLogRecord, deviceLabel, onProblems, problemLogRecord, problems } from "../problems.ts";
import { listOf, putRecords } from "./store.ts";

const APP = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/** This device's id: random, made once, kept in localStorage (a fresh install is a new device). */
function deviceId(): string {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = `${isNative ? "phone" : "web"}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("deviceId", id);
  }
  return id;
}

/** Writes the record when the log differs from it. */
function write() {
  try {
    const id = deviceId();
    const had = listOf<ProblemLogRecord>("problemLogs").find((r) => r.id === id);
    const rec = problemLogRecord(id, deviceLabel(isNative, navigator.userAgent), APP, problems(), had, Date.now());
    if (rec) putRecords("problemLogs", [rec]);
  } catch { /* the log must never break the app */ }
}

/** Starts it, once the local copy is loaded: now (the log may have changed while the app was closed), then 5 s after each change. */
export function startProblemSync() {
  let timer: number | undefined;
  onProblems(() => { clearTimeout(timer); timer = window.setTimeout(write, 5000); });
  write();
}
