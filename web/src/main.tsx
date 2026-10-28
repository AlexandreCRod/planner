import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { startNotifications } from "./notify.ts";
import { startAlarmMirror } from "./alarms/mirror.ts";
import { startHealthReading } from "./health/healthConnect.ts";
import { isNative } from "./platform.ts";
import { ensureDefaults, flushAll, load, setChangeHook, tidy } from "./store/store.ts";
import { logProblem, startProblemLog } from "./problems.ts";
import { OtherTab, StartFailed } from "./ui/Notice.tsx";
import { migrateLocalRoutines } from "./store/routines.ts";
import { convertOldFutsal } from "./store/futsal.ts";
import { getToken, onStatus, requestSync, signOut, startAutoSync, syncNow } from "./store/sync.ts";
import { App as CapApp } from "@capacitor/app";
import { App } from "./ui/App.tsx";
import { applyTheme } from "./ui/shared/settings.ts";
import { startPhoneTheme } from "./ui/phone/theme.ts";

applyTheme();
// The accent's palette (the calm tones both layouts and the first-run screen are drawn with).
startPhoneTheme();

/**
 * Only one tab or window may use the local copy at a time: two would each keep their own copy in memory
 * and write over each other's (and a stale one would send deletes for what the other added). The first
 * holds a lock; another shows a notice with "Use here", which takes the lock over. The tab that loses it
 * reloads at once, writing nothing, and then shows the notice itself.
 */
function claimThisTab(steal = false): Promise<boolean> {
  if (!("locks" in navigator)) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request("planner-local-copy", steal ? { steal: true } : { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return; }
      resolve(true);
      return new Promise<void>(() => {}); // held as long as this tab lives
    }).catch(() => location.reload()); // another tab took over
  });
}

const root = () => createRoot(document.getElementById("root")!);

async function start() {
  startProblemLog();
  if (!(await claimThisTab())) {
    const r = root();
    r.render(<OtherTab onUseHere={() => { void claimThisTab(true).then(() => location.reload()); }} />);
    return;
  }
  try {
    await load();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logProblem("start", `Couldn't load the data: ${message}`, e instanceof Error ? e.stack ?? "" : "");
    root().render(<StartFailed message={message} />);
    return;
  }
  // Ask the browser to keep the local copy even when the device runs low on space.
  void navigator.storage?.persist?.().catch(() => {});
  setChangeHook(() => requestSync());
  // Put away (home, recents, the screen going off, the tab closing): every waiting save is written at
  // once, and what changed goes to the server, as the app may be killed before any timer runs.
  const putAway = () => { void flushAll(); if (getToken()) void syncNow(); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") putAway(); });
  window.addEventListener("pagehide", putAway);
  if (isNative) void CapApp.addListener("pause", putAway);
  // Retention: ticked to-dos to the trash after 48 h, old trash deleted (domain/retention.ts).
  tidy();
  // The phone's old device-only routine marks move into the synced field once (when there are items).
  migrateLocalRoutines();
  // The old futsal entries become calendar events (item 240), only once a sync has finished: the same records
  // on every device, so the phone and the PC can both do it; a no-op once they're converted.
  onStatus((st) => { if (st.state === "idle" && st.lastSyncAt) { tidy(); migrateLocalRoutines(); convertOldFutsal(); } });
  window.setInterval(() => tidy(), 3_600_000);
  if (getToken()) startAutoSync();
  else signOut();
  // Default categories only after the first sync finds none (the server may already have the user's own).
  const offDefaults = onStatus((st) => { if (st.state === "idle" && st.lastSyncAt) { offDefaults(); ensureDefaults(); } });
  // The PC shows reminders from the page; the phone build hands them to its native alarm engine, which
  // rings them (and its alarm clocks, timers...) with the app closed.
  if (!isNative) startNotifications();
  else { document.documentElement.classList.add("native"); startAlarmMirror(); startHealthReading(); }
  root().render(<StrictMode><App /></StrictMode>);
  if ("serviceWorker" in navigator && location.hostname !== "localhost") navigator.serviceWorker.register("/sw.js").catch(() => {});
}

void start();
