// A row or tile that isn't a real button, opened by a tap, a click, Enter or Space (Progress, Training).
import type React from "react";

/**
 * Opens on a tap, a click, Enter or Space. [stop]: the row sits inside another one that opens too (a session in
 * Training's week, inside its day), so neither its click nor its key reaches that one (review of 2.10.3,
 * finding 6: Enter on a session opened it, then its day's week page on top).
 */
export const tapProps = (open: () => void, o: { stop?: boolean } = {}) => ({
  role: "button", tabIndex: 0,
  onClick: (e: React.MouseEvent) => { if (o.stop) e.stopPropagation(); open(); },
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (o.stop) e.stopPropagation();
    open();
  },
});
