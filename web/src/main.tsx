import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { startNotifications } from "./notify.ts";
import { startAlarmMirror } from "./alarms/mirror.ts";
import { isNative } from "./platform.ts";
import { ensureDefaults, load, setChangeHook, tidy } from "./store/store.ts";
import { migrateLocalRoutines } from "./store/routines.ts";
import { getToken, onStatus, requestSync, signOut, startAutoSync } from "./store/sync.ts";
import { App } from "./ui/App.tsx";
import { applyTheme } from "./ui/SettingsView.tsx";

applyTheme();

async function start() {
  await load();
  setChangeHook(() => requestSync());
  // Retention: ticked to-dos to the trash after 48 h, old trash deleted (domain/retention.ts).
  tidy();
  // The phone's old device-only routine marks move into the synced field once (when there are items).
  migrateLocalRoutines();
  onStatus((st) => { if (st.state === "idle" && st.lastSyncAt) { tidy(); migrateLocalRoutines(); } });
  window.setInterval(() => tidy(), 3_600_000);
  if (getToken()) startAutoSync();
  else signOut();
  // Default categories only once this browser has synced (the server may already have them).
  window.setTimeout(ensureDefaults, 4000);
  // The PC shows reminders from the page; the phone build hands them to its native alarm engine, which
  // rings them (and its alarm clocks, timers...) with the app closed.
  if (!isNative) startNotifications();
  else { document.documentElement.classList.add("native"); startAlarmMirror(); }
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
  if ("serviceWorker" in navigator && location.hostname !== "localhost") navigator.serviceWorker.register("/sw.js").catch(() => {});
}

void start();
