// Moving an event on Today by holding its time: the time wheel opens, and the event moves to the
// picked start keeping its length, with Undo in the snackbar. A repeating event moves on that day only.
import { formatTime } from "../../domain/dates.ts";
import type { Occurrence } from "../../domain/schedule.ts";
import { isRecurring } from "../../domain/types.ts";
import { deleteForever, saveItem, saveSeriesEdit } from "../../store/store.ts";
import { showSnackbar } from "./m3.tsx";
import { openTimeWheel } from "./TimeWheel.tsx";
import { moveKeepingLength } from "./wheelMath.ts";

/** Whether holding this occurrence's time moves it (a timed event within one day). */
export const canMoveByWheel = (o: Occurrence) => o.timed && !o.multiDay && o.startMin !== null && o.item.type !== "TASK";

/** Opens the wheel for [o]; [pointerId] is the finger still down from the hold. */
export function moveByWheel(o: Occurrence, pointerId?: number) {
  const s0 = o.startMin!, e0 = o.endMin;
  openTimeWheel({
    title: o.item.title.trim() || "Untitled",
    value: s0,
    okLabel: "Move",
    pointerId,
    note: (t) => (e0 !== null ? `${formatTime(t)} – ${formatTime(moveKeepingLength(t, s0, e0).endMin!)}` : formatTime(t)),
    onPick: (t) => { if (t !== s0) moveTo(o, t); },
  });
}

function moveTo(o: Occurrence, t: number) {
  const item = o.item;
  const span = moveKeepingLength(t, o.startMin!, o.endMin);
  let undo: () => void;
  if (!isRecurring(item)) {
    saveItem({ ...item, ...span });
    undo = () => saveItem(item);
  } else {
    // Just this day's: the series skips it and a one-off copy takes its place (as the calendar does).
    const id = saveSeriesEdit("THIS", item, o.day, { ...item, ...span });
    undo = () => { deleteForever(id); saveItem(item); };
  }
  showSnackbar(`Moved to ${formatTime(t)}`, "Undo", undo);
}
