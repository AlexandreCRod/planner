// Settings of this device that the schedule rules read (the rules themselves are in domain/).

/** "Carry unfinished tasks over to today": a missed one-time task moves to today (Today, the calendar, the widgets). On unless turned off. */
export function carryOver(): boolean {
  try { return localStorage.getItem("carryOver") !== "false"; } catch { return true; }
}
