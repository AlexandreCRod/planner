// Desktop notifications for reminders while the PC app is open. The phone remains the device that
// rings; this is an extra pop-up when you're at the computer.
import { toTimestamp, today } from "./domain/dates.ts";
import { occurrences } from "./domain/recurrence.ts";
import { isRecurring } from "./domain/types.ts";
import { snapshot } from "./store/store.ts";

export const notificationsEnabled = () => localStorage.getItem("desktopNotifications") === "true" && "Notification" in window && Notification.permission === "granted";

export async function setNotificationsEnabled(on: boolean): Promise<boolean> {
  if (!on) { localStorage.setItem("desktopNotifications", "false"); return false; }
  if (!("Notification" in window)) return false;
  const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  localStorage.setItem("desktopNotifications", String(p === "granted"));
  return p === "granted";
}

let lastCheck = Date.now();

function check() {
  const now = Date.now();
  const from = lastCheck;
  lastCheck = now;
  if (!notificationsEnabled()) return;
  const s = snapshot();
  const t = today();
  for (const [itemId, rs] of s.reminders) {
    const item = s.byId.get(itemId);
    if (!item || item.type === "NOTE" || item.startDay === null) continue;
    for (const r of rs) {
      const lookBack = Math.ceil(Math.abs(r.offsetMin) / 1440) + 1;
      for (const day of occurrences(item, t - (r.offsetMin < 0 ? lookBack : 1), t + lookBack)) {
        const time = item.allDay || item.startMin === null ? 9 * 60 : item.startMin;
        const fire = toTimestamp(day, time) - r.offsetMin * 60_000;
        if (fire <= from || fire > now) continue;
        const cday = isRecurring(item) ? day : item.startDay;
        if (item.type === "TASK" && s.done.isDone(item.id, cday)) continue;
        new Notification(item.title || "Planner", { body: noticeText(r.offsetMin), tag: `${r.id}-${day}`, icon: "/icon.svg" });
      }
    }
  }
}

/** "In 30 min", "In 2 h", "Now", or for a reminder after the start "Started 10 min ago". */
function noticeText(offset: number): string {
  const a = Math.abs(offset), h = Math.round(a / 60);
  const span = h >= 1 ? `${h} h` : `${a} min`;
  return offset === 0 ? "Now" : offset > 0 ? `In ${span}` : `Started ${span} ago`;
}

export function startNotifications() { window.setInterval(check, 30_000); }
