// The add panel's draft (AddPanel.tsx), kept when the panel is flicked or dragged closed and given back
// the next time it opens, with no question asked. A quick add comes back as it was (the line, its type
// and what its chips changed); one made on a calendar slot comes back on the slot tapped this time, with
// its title, category and the rest. Pure, checked by test/addDraft.test.ts.

/** The times a slot draft moves with. */
export interface Timing { startDay: number | null; endDay: number | null; startMin: number | null; endMin: number | null; allDay: boolean }

/** What a closed panel leaves behind: its mode, and whatever the panel needs to come back as it was. */
export interface KeptAdd<S> { mode: "quick" | "slot"; state: S }

const DAY_END = 24 * 60 - 1;

/**
 * Whether a panel closed with a flick or a drag keeps its draft: only when something was typed (the add
 * line, or the title once it became the editor), and never one already saved (the editor saves a new
 * item first when it's linked; its id is then set).
 */
export function worthKeeping(lineText: string, lineMode: boolean, title: string, savedId: number): boolean {
  if (savedId !== 0) return false;
  return (lineMode ? lineText : title).trim() !== "";
}

/** Takes the kept draft for a panel opening in [mode] (then nothing is kept), or null: one for the other mode stays. */
export function takeKept<S>(kept: KeptAdd<S> | null, mode: "quick" | "slot"): { state: S | null; rest: KeptAdd<S> | null } {
  if (!kept || kept.mode !== mode) return { state: null, rest: kept };
  return { state: kept.state, rest: null };
}

/**
 * A slot draft on the slot tapped now ([day], [min]): the same length and number of days as it had,
 * starting there (never past the end of the day). An all-day one stays all day, on the new day.
 */
export function onSlot<T extends Timing>(item: T, day: number, min: number | null): T {
  // A task has no end: it only moves.
  const days = item.startDay !== null && item.endDay !== null ? Math.max(0, item.endDay - item.startDay) : 0;
  const endDay = item.endDay === null ? null : day + days;
  if (item.allDay || min === null) return { ...item, startDay: day, endDay };
  const len = item.startMin !== null && item.endMin !== null && item.endMin > item.startMin ? item.endMin - item.startMin : 60;
  return { ...item, startDay: day, endDay, startMin: min, endMin: item.endMin === null ? null : Math.min(min + len, DAY_END), allDay: false };
}
