// Futsal games as calendar events (item 240, domain/training.ts): what Training does to them. A game is a
// futsal event's day; ticking it is the event's Completion that day; what was logged is the game's log
// entry (futsalLogId). The old futsal entries convert once, after a sync (convertOldFutsal).
import { type Entry, convertFutsal, futsalLogId, isSportsCategory, newEntry } from "../domain/training.ts";
import { type Category, type Item, isRecurring, newItem } from "../domain/types.ts";
import {
  deleteOccurrence, listOf, putRecords, removeRecords, saveItem, saveSeriesEdit, snapshot, toggleCompletion, trash,
} from "./store.ts";

const DAY_END = 24 * 60 - 1;

/** A game: its event and day. */
export interface GameRef { itemId: number; day: number }

/**
 * Converts the old futsal entries (convertFutsal): run after each sync that finished, never before the
 * first (a fresh install has nothing yet, and a stale copy mustn't write over what another device did since).
 * The same on every device, so it's safe on the phone and the PC; returns how many entries it marked.
 */
export function convertOldFutsal(): number {
  const c = convertFutsal(listOf<Entry>("trainingEntries"), listOf<Item>("items"));
  if (!c.entries.length) return 0;
  if (c.items.length) putRecords("items", c.items);
  if (c.completions.length) putRecords("completions", c.completions);
  putRecords("trainingEntries", c.entries);
  return c.entries.length;
}

/** Ticks a game done, or takes the tick back. */
export function tickGame(g: GameRef, done: boolean) { toggleCompletion(g.itemId, g.day, done); }

const storedLog = (g: GameRef) => listOf<Entry>("trainingEntries").find((e) => e.id === futsalLogId(g.itemId, g.day));

/** Saves what was logged for a game (how long, a note); made only when there's something to keep. */
export function saveGameLog(g: GameRef, planId: string, log: { durationMin: number | null; note: string }) {
  const had = storedLog(g);
  if (!had && log.durationMin === null && !log.note) return;
  if (had && had.durationMin === log.durationMin && had.note === log.note) return;
  const item = snapshot().byId.get(g.itemId);
  const base = had ?? newEntry({ id: futsalLogId(g.itemId, g.day), planId, kind: "futsal", itemId: g.itemId, title: item?.title.trim() || "Futsal" });
  putRecords("trainingEntries", [{ ...base, ...log, updatedAt: Date.now() }]);
}

/** A new game: an untimed event "Futsal" on [day], in the Sports category when there is one (267). */
export function addGame(day: number): GameRef {
  const sports = listOf<Category>("categories").filter(isSportsCategory).sort((a, b) => a.id - b.id)[0];
  const itemId = saveItem(newItem({ type: "EVENT", title: "Futsal", startDay: day, endDay: day, allDay: true, categoryId: sports?.id ?? null }));
  return { itemId, day };
}

/**
 * Moves a game to [to], and to [startMin] when the event has a time (undefined keeps it). A one-off event
 * moves; one day of a repeating one becomes its own event (as editing "this day" in the calendar does).
 * Its tick and log come along. Returns where the game is now.
 */
export function moveGame(g: GameRef, to: number, startMin?: number): GameRef {
  const item = snapshot().byId.get(g.itemId);
  if (!item) return g;
  const timed = item.startMin !== null && !item.allDay;
  const newMin = timed && startMin !== undefined ? startMin : item.startMin;
  if (to === g.day && newMin === item.startMin) return g;
  const span = (item.endDay ?? item.startDay ?? g.day) - (item.startDay ?? g.day);
  const length = item.startMin !== null && item.endMin !== null && span === 0 ? item.endMin - item.startMin : null;
  const edited: Item = {
    ...item, startDay: to, endDay: to + span,
    ...(timed && newMin !== null ? { startMin: newMin, endMin: length !== null ? Math.min(newMin + Math.max(0, length), DAY_END) : item.endMin } : {}),
  };
  const done = snapshot().done.isDone(g.itemId, g.day);
  const log = storedLog(g);
  let now: GameRef;
  if (isRecurring(item)) {
    // The tick comes with it (saveSeriesEdit carries it to the new event).
    now = { itemId: saveSeriesEdit("THIS", item, g.day, edited), day: to };
  } else {
    saveItem(edited);
    now = { itemId: g.itemId, day: to };
    if (done && to !== g.day) { toggleCompletion(g.itemId, g.day, false); toggleCompletion(g.itemId, to, true); }
  }
  if (log && (now.itemId !== g.itemId || now.day !== g.day)) {
    putRecords("trainingEntries", [{ ...log, id: futsalLogId(now.itemId, now.day), itemId: now.itemId, updatedAt: Date.now() }]);
    removeRecords("trainingEntries", [log]);
  }
  return now;
}

/** Takes a game off: that day of a repeating event, else the event (to the trash). */
export function removeGame(g: GameRef) {
  const item = snapshot().byId.get(g.itemId);
  if (!item) return;
  if (isRecurring(item)) deleteOccurrence(item, g.day);
  else trash(item.id);
}
