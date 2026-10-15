import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { startNotifications } from "./notify.ts";
import { isNative } from "./platform.ts";
import { ensureDefaults, load, setChangeHook } from "./store/store.ts";
import { getToken, requestSync, signOut, startAutoSync } from "./store/sync.ts";
import { App } from "./ui/App.tsx";
import { applyTheme } from "./ui/SettingsView.tsx";

applyTheme();

async function start() {
  await load();
  setChangeHook(() => requestSync());
  if (getToken()) startAutoSync();
  else signOut();
  // Default categories only once this browser has synced (the server may already have them).
  window.setTimeout(ensureDefaults, 4000);
  // No reminders from the phone build: the native app (or the PC) does that.
  if (!isNative) startNotifications();
  else document.documentElement.classList.add("native");
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
  if ("serviceWorker" in navigator && location.hostname !== "localhost") navigator.serviceWorker.register("/sw.js").catch(() => {});
}

void start();
