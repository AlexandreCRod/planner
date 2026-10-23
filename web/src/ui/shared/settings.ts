// The chosen theme and accent on the page, and the sync status as a hook.
import { useEffect, useState } from "react";
import { type SyncStatus, getStatus, onStatus } from "../../store/sync.ts";

export function applyTheme() {
  const theme = localStorage.getItem("theme") ?? "system";
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.setProperty("--accent", localStorage.getItem("accent") ?? "#1a73e8");
}

export function useSyncStatus(): SyncStatus {
  const [st, setSt] = useState(getStatus());
  useEffect(() => { const off = onStatus(setSt); return () => { off(); }; }, []);
  return st;
}
