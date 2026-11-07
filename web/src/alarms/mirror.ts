// Keeps the alarm engine's copy of the data fresh (web/android/.../alarm/AlarmData.kt): on start, after
// every local change and after every sync, the records alarms need are sent to it, so it can ring (and
// set everything again after a reboot) without this page running. Only what alarms use leaves the page:
// items that have reminders, cut down to their scheduling fields, their reminders and completions, and
// the alarm settings. Things ticked natively (a notification's "Done", the ringing screen's "Mark done")
// come back here and are saved like any tick, so they sync.
import { type MirrorPush, buildMirror, cardChoices, ringChoices } from "../domain/alarms.ts";
import { buildAgenda } from "../domain/agenda.ts";
import { clockFormat, dateStyle, today } from "../domain/dates.ts";
import { snapshot, subscribe, toggleCompletion } from "../store/store.ts";
import { carryOver } from "../store/prefs.ts";
import { look, onLooks } from "../ui/phone/looks.ts";
import { clockPrefs, onClockPrefs } from "./clockPrefs.ts";
import { alarmSettings, onAlarmSettings } from "./settings.ts";
import { startWidgetMirror } from "./widgets.ts";
import { hasAlarms, native, onNative, refreshAlarmState } from "./native.ts";
import { type Launch, askShortcut, isShortcut, launchHash } from "./launch.ts";

let last = "";
let timer: number | undefined;

function current(): MirrorPush {
  const s = snapshot();
  let accent = "#1a73e8";
  try { accent = localStorage.getItem("accent") ?? accent; } catch { /* default */ }
  const push = buildMirror(s.allItems, s.reminders, s.completions, alarmSettings(), clockFormat(), dateStyle(), accent);
  return {
    ...push,
    agenda: buildAgenda(s.items, s.done, today(), carryOver()),
    settings: {
      ...push.settings,
      ...cardChoices(look("notifCard"), look("notifIcons"), clockPrefs().bundleWindow),
      ...ringChoices(look("ringLayout"), look("ringStop"), look("ringComing"), look("ringIcons")),
    },
  };
}

/** Sends the data if it changed since the last push (or always, with [force]). */
export function pushMirror(force = false) {
  if (!hasAlarms) return;
  const payload = current();
  const text = JSON.stringify(payload);
  if (!force && text === last) return;
  last = text;
  void native.sync(payload);
}

/** Saves what was ticked natively; the store then syncs it and the next push carries it back. */
async function takeDone() {
  const done = await native.takeDone();
  if (!done.length) return;
  const s = snapshot();
  for (const c of done) if (!s.done.isDone(c.itemId, c.day)) toggleCompletion(c.itemId, c.day, true);
}

/** Shown after the page has drawn what was opened: two frames, so the new page is on screen, not just in the DOM. */
const whenDrawn = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

/**
 * A notification (or the alarm clock's icon) asked to open an item or a section of the Clock page while the app
 * was in the background. The app hid itself as it came back (AlarmPlugin), so the last page (Training, say) doesn't
 * show for a moment first (371); it shows again once the item is drawn.
 */
async function takeLaunch() {
  const l = await native.takeLaunch();
  const to = launchHash(l);
  if (to) location.hash = to;
  shortcutParts(l);
  whenDrawn(() => void native.launchShown());
}

/** What a shortcut does besides opening its page (375): the stopwatch starts; "New task" opens the add panel. */
function shortcutParts(l: Launch) {
  if (!isShortcut(l.shortcut)) return;
  if (l.shortcut === "stopwatch") void native.stopwatch("start", { id: 0 }).then(refreshAlarmState);
  if (l.shortcut === "task") askShortcut("task");
}

/**
 * On a cold start, before the first drawing: the app opens straight on what the notification asked for, with the
 * Today page under it (so back goes there, not out of the app).
 */
export async function takeLaunchBeforeStart() {
  if (!hasAlarms) return;
  const l = await native.takeLaunch();
  const to = launchHash(l);
  if (to) {
    history.replaceState(null, "", "#/today");
    if (to.startsWith("#/alarms/")) history.replaceState(null, "", to);
    else if (to !== "#/today") history.pushState(null, "", to);
  }
  shortcutParts(l);
  whenDrawn(() => void native.launchShown());
}

let started = false;
/** Starts the mirror (phone build only): first push now, then after each change. */
export function startAlarmMirror() {
  if (!hasAlarms || started) return;
  started = true;
  pushMirror(true);
  const soon = () => { clearTimeout(timer); timer = window.setTimeout(() => pushMirror(), 300); };
  subscribe(soon);
  onAlarmSettings(soon);
  onLooks(soon);
  onClockPrefs(soon);
  onNative("changed", (what) => {
    if (what === "done" || what === "resume") void takeDone();
    if (what === "resume") pushMirror();
  });
  onNative("launch", () => void takeLaunch());
  void takeDone();
  void refreshAlarmState();
  startWidgetMirror();
}
