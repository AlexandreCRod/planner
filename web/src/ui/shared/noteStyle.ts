// A note's looks (fonts, page colours) and the templates it can start from.
import { ymd } from "../../domain/dates.ts";

export const FONTS = ["system-ui, sans-serif", "Georgia, 'Times New Roman', serif", "Consolas, 'Courier New', monospace", "'Segoe Print', 'Comic Sans MS', cursive"];
export const FONT_NAMES = ["Sans", "Serif", "Mono", "Handwriting"];
export const PAGE_COLORS = ["#fff8e1", "#ffebee", "#f3e5f5", "#e8eaf6", "#e3f2fd", "#e0f7fa", "#e8f5e9", "#f1f8e9", "#fff3e0", "#efebe9", "#eceff1", "#263238", "#1b2631", "#2e1f27", "#1f2e24"];
export const TEMPLATES: [string, string][] = [
  ["Meeting notes", "<h2>Meeting notes</h2><p><b>Date:</b> </p><p><b>Attendees:</b> </p><h3>Agenda</h3><ul><li></li></ul><h3>Decisions</h3><ul><li></li></ul><h3>Action items</h3><ol><li></li></ol>"],
  ["Daily journal", "<h3>Grateful for</h3><ul><li></li></ul><h3>Top 3 for today</h3><ol><li></li><li></li><li></li></ol><h3>Notes</h3><p></p><h3>Reflection</h3><p></p>"],
  ["Weekly review", "<h2>Weekly review</h2><h3>Wins</h3><ul><li></li></ul><h3>What didn't go well</h3><ul><li></li></ul><h3>Next week's priorities</h3><ol><li></li></ol>"],
  ["Project plan", "<h2>Project</h2><p><b>Goal:</b> </p><p><b>Deadline:</b> </p><h3>Milestones</h3><ol><li></li></ol><h3>Risks</h3><ul><li></li></ul>"],
  ["To-do list", "<p>☐ </p>"],
];

/** A new note's title on a day: 2026-10-23. */
export function isoOf(day: number) {
  const { y, m, d } = ymd(day);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
