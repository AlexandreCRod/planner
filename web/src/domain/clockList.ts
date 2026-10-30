// The Clock page's alarm list (2.9): its filters (71), bundles of alarms with the same days (73, 110) and
// skipping the next ring or tomorrow's (75). Pure, so it's unit-tested (test/clockList.test.ts). The alarm
// schedule rules themselves are in alarms.ts.
import { type Clockish, WEEKDAYS, WEEKEND, alarmDayMask } from "./alarms.ts";

// ---------- Filters (71) ----------

/** The alarm list's filter chips; none on shows every alarm. */
export type ClockFilter = "on" | "off" | "weekdays" | "weekend";
export const CLOCK_FILTERS: [ClockFilter, string][] = [["on", "Active"], ["off", "Inactive"], ["weekdays", "Weekdays"], ["weekend", "Weekends"]];

/** Whether [a] shows under filter [f] (null: every alarm). Weekdays and weekends go by the days it rings. */
export function shownBy(a: Clockish & { enabled: boolean }, f: ClockFilter | null, now: Date): boolean {
  switch (f) {
    case null: return true;
    case "on": return a.enabled;
    case "off": return !a.enabled;
    case "weekdays": return (alarmDayMask(a, now) & WEEKDAYS) !== 0;
    case "weekend": return (alarmDayMask(a, now) & WEEKEND) !== 0;
  }
}

/** A tap on chip [f]: turns it on, or off again if it was the one on. */
export const toggleFilter = (current: ClockFilter | null, f: ClockFilter) => (current === f ? null : f);
