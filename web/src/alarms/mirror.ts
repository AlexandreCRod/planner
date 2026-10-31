// Keeps the alarm engine's copy of the data fresh (web/android/.../alarm/AlarmData.kt): on start, after
// every local change and after every sync, the records alarms need are sent to it, so it can ring (and
// set everything again after a reboot) without this page running. Only what alarms use leaves the page:
// items that have reminders, cut down to their scheduling fields, their reminders and completions, and
// the alarm settings. Things ticked natively (a notification's "Done", the ringing screen's "Mark done")
// come back here and are saved like any tick, so they sync.
import { type MirrorPush, buildMirror, cardChoices } from "../domain/alarms.ts";
import { clockFormat, dateStyle } from "../domain/dates.ts";
import { snapshot, subscribe, toggleCompletion } from "../store/store.ts";
import { go } from "../ui/shared/common.tsx";
import { look, onLooks } from "../ui/phone/looks.ts";
import { clockPrefs, onClockPrefs } from "./clockPrefs.ts";
import { alarmSettings, onAlarmSettings } from "./settings.ts";
import { startWidgetMirror } from "./widgets.ts";
import { hasAlarms, native, onNative, refreshAlarmState } from "./native.ts";

let last = "";
let timer: number | undefined;

function current(): MirrorPush {
  const s = snapshot();
  let accent = "#1a73e8";
  try { accent = localStorage.getItem("accent") ?? accent; } catch { /* default */ }
  const push = buildMirror(s.allItems, s.reminders, s.completions, alarmSettings(), clockFormat(), dateStyle(), accent);
  return { ...push, settings: { ...push.settings, ...cardChoices(look("notifCard"), look("notifIcons"), clockPrefs().bundleWindow) } };
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

/** A notification (or the alarm clock's icon) asked to open an item or a section of the Alarms page. */
async function takeLaunch() {
  const l = await native.takeLaunch();
  if (l.itemId) go(`item/${l.itemId}`);
  else if (l.section) go(`alarms/${l.section}`);
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
  void takeLaunch();
  void refreshAlarmState();
  startWidgetMirror();
}
