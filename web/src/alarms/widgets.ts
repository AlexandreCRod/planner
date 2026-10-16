// Keeps the home-screen widgets (web/android/.../widget/Widgets.kt) fresh: on start, after every change
// and whenever the app comes back, what they show is worked out here (domain/widgets.ts) and sent to
// them if it changed. Tasks ticked on the widget come back through the alarm engine's queue (mirror.ts,
// takeDone); un-ticks through the widget's own, taken here.
import { buildWidgets } from "../domain/widgets.ts";
import { formatDate, formatTime, today } from "../domain/dates.ts";
import { snapshot, subscribe, toggleCompletion } from "../store/store.ts";
import { hasAlarms, native, onNative } from "./native.ts";

let last = "";
let timer: number | undefined;

function push() {
  const s = snapshot();
  const payload = buildWidgets(s.items, s.done, today(), { time: formatTime, date: formatDate, color: (i) => s.colorOf(i) });
  const text = JSON.stringify(payload);
  if (text === last) return;
  last = text;
  void native.widgets(payload);
}

async function takeUndone() {
  const list = await native.takeWidgetUndone();
  if (!list.length) return;
  const s = snapshot();
  for (const c of list) if (s.done.isDone(c.itemId, c.day)) toggleCompletion(c.itemId, c.day, false);
}

let started = false;
export function startWidgetMirror() {
  if (!hasAlarms || started) return;
  started = true;
  push();
  subscribe(() => { clearTimeout(timer); timer = window.setTimeout(push, 300); });
  onNative("changed", (what) => {
    if (what === "widget" || what === "resume") void takeUndone();
    if (what === "resume") push(); // the day may have turned meanwhile
  });
  void takeUndone();
}
