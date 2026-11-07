// What a notification, the alarm clock's icon or an app shortcut (375) opens in the app (371).

/** The app icon's long-press shortcuts (375). */
export type Shortcut = "task" | "note" | "stopwatch" | "timer";
export interface Launch { itemId?: number; section?: string; shortcut?: string }

const SHORTCUT_HASH: Record<Shortcut, string> = {
  task: "#/today", note: "#/note/new", stopwatch: "#/alarms/stopwatch", timer: "#/alarms/timer",
};
export const isShortcut = (s: string | undefined): s is Shortcut => !!s && s in SHORTCUT_HASH;

/** The hash a launch opens: an item, a section of the Clock page, or a shortcut's page. Null when nothing was asked. */
export function launchHash(l: Launch): string | null {
  if (l.itemId) return `#/item/${l.itemId}`;
  if (l.section) return `#/alarms/${l.section}`;
  if (isShortcut(l.shortcut)) return SHORTCUT_HASH[l.shortcut];
  return null;
}

// The part of a shortcut the pages do themselves ("New task" opens the add panel), waiting until the shell is up.
let pending: Shortcut | null = null;
const listeners = new Set<() => void>();
export function askShortcut(s: Shortcut) { pending = s; listeners.forEach((l) => l()); }
/** The shortcut waiting to be acted on, once. */
export function takeShortcut(): Shortcut | null { const s = pending; pending = null; return s; }
export function onShortcut(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
