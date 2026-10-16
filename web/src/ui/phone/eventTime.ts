// Changing a time on Today by holding its digits (the drum, TimeWheel.tsx): an event moves keeping
// its length (or, from its end time, changes its end); a task moves. A repeating item changes on that
// day only, as the calendar's drag does. The snackbar offers Undo.
import { formatTime } from "../../domain/dates.ts";
import type { Occurrence, TaskEntry } from "../../domain/schedule.ts";
import { isRecurring, type Item } from "../../domain/types.ts";
import { deleteForever, saveItem, saveSeriesEdit } from "../../store/store.ts";
import { showSnackbar } from "./m3.tsx";
import { moveKeepingLength } from "./wheelMath.ts";

/** Saves [patch] on [item] as it is on [day] (that day only, for a repeating one), with Undo. */
function change(item: Item, day: number, patch: Partial<Item>, text: string) {
  let undo: () => void;
  if (!isRecurring(item)) {
    saveItem({ ...item, ...patch });
    undo = () => saveItem(item);
  } else {
    const id = saveSeriesEdit("THIS", item, day, { ...item, ...patch });
    undo = () => { deleteForever(id); saveItem(item); };
  }
  showSnackbar(text, "Undo", undo);
}

/** Whether this event's times can be held (timed, within one day). */
export const canHoldEvent = (o: Occurrence) => o.timed && !o.multiDay && o.startMin !== null;

/** The event starting at [t] instead, keeping its length. */
export function moveEvent(o: Occurrence, t: number) {
  if (t === o.startMin) return;
  change(o.item, o.day, moveKeepingLength(t, o.startMin!, o.endMin), `Moved to ${formatTime(t)}`);
}

/** The event ending at [t] instead (after its start). */
export function setEventEnd(o: Occurrence, t: number) {
  if (t === o.endMin) return;
  if (t <= o.startMin!) { showSnackbar("The end must be after the start"); return; }
  change(o.item, o.day, { endMin: t }, `Ends at ${formatTime(t)}`);
}

/** The task due at [t] instead. */
export function moveTask(e: TaskEntry, t: number) {
  if (t === e.item.startMin || e.day === null) return;
  change(e.item, e.day, { startMin: t }, `Moved to ${formatTime(t)}`);
}
