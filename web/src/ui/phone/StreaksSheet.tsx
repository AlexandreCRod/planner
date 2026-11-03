// The Streaks sheet (from the Tasks page's menu and Settings): every routine, tasks and repeating events,
// with its current streak, its best one and its last 14 days as a row of small dots (221: green = done on
// time, amber = done late, a grey gap = missed, a ring = today still open, a speck = not one of its
// days). Late keeps the streak; missed ends it. A tap opens the routine.
// It shows whatever the Streak badges setting says, since it was opened to see them, and holds that setting
// (341, 286's "Streaks in one place": it was in Settings). A routine's own page draws its days the same way.
import { useState } from "react";
import { createPortal } from "react-dom";
import { today as todayEpoch } from "../../domain/dates.ts";
import { type DayMark, streakRows } from "../../domain/routines.ts";
import { useSnapshot } from "../../store/store.ts";
import { STREAK_STYLES, setStreakStyle, streakStyle, streakSymbol } from "../../store/routines.ts";
import { openItem } from "../shared/common.tsx";
import { DropdownMenu, EmptyState, MIcon } from "./chrome.tsx";
import { BottomSheet, ListItem } from "./m3.tsx";

export const STREAK_DAYS = 14;
const DAYS = STREAK_DAYS;
const MARK_LABEL = { done: "on time", late: "late", missed: "missed", open: "today, still open", off: "not one of its days" } as const;

/** A routine's last days as a row of dots (221's colours: green on time, amber late, a grey gap missed). */
export function StreakDays({ days }: { days: DayMark[] }) {
  return (
    <span className="p-streak-days" role="img" aria-label={`Last ${days.length} days: ${days.filter((d) => d === "done").length} on time, ${days.filter((d) => d === "late").length} late, ${days.filter((d) => d === "missed").length} missed`}>
      {days.map((d, i) => <span key={i} className={d} title={MARK_LABEL[d]} />)}
    </span>
  );
}

/** What the dots mean, under them. */
export function StreakKey({ days, className = "" }: { days: number; className?: string }) {
  return (
    <div className={`p-streak-foot muted ${className}`}>
      <span className="p-streak-key"><span className="done" />On time</span>
      <span className="p-streak-key"><span className="late" />Late</span>
      <span className="p-streak-key"><span className="missed" />Missed</span>
      <span className="grow" />Last {days} days, today on the right
    </div>
  );
}

/** The days-in-a-row badge by each routine on Today and the task lists: off unless chosen. */
function BadgesRow() {
  const [open, setOpen] = useState(false);
  const value = streakStyle();
  return (
    <div className="p-menu-anchor start wide p-streak-badges">
      <ListItem headline="Streak badges" supporting={`On Today and the lists: ${STREAK_STYLES.find(([k]) => k === value)?.[1] ?? ""}`} onClick={() => setOpen(true)} />
      <DropdownMenu open={open} onClose={() => setOpen(false)} items={STREAK_STYLES.map(([k, l]) => ({ label: l, checked: k === value, onClick: () => setStreakStyle(k) }))} />
    </div>
  );
}

export function StreaksSheet({ onClose }: { onClose: () => void }) {
  const s = useSnapshot();
  const t = todayEpoch();
  const rows = streakRows(s.items, s.done, t, DAYS);
  const flame = streakSymbol();
  return createPortal(
    <BottomSheet onClose={onClose} className="p-rlist-sheet">{(close) => (
      <div className="p-rlist">
        <div className="p-rlist-head t-title-medium">Streaks</div>
        {rows.length === 0 && <EmptyState className="compact" icon="fRepeat" title="No routines yet" hint="Turn on Routine in a repeating task or event" />}
        <div className="p-rlist-rows">
          {rows.map((r) => (
            <button key={r.item.id} className="p-streak-row" onClick={() => { close(); window.setTimeout(() => openItem(r.item), 210); }}>
              <span className="text">
                <span className="name">{r.item.title || "Untitled"}</span>
                <span className="sub">{r.repeat} · Best {r.streak.best}</span>
                <StreakDays days={r.days} />
              </span>
              <span className={`p-streak-now ${r.streak.current > 0 ? "on" : ""}`}>
                <span className="n">{flame && <MIcon name="fLocalFireDepartment" size={18} />}{r.streak.current}</span>
                <span className="l">in a row</span>
              </span>
            </button>
          ))}
        </div>
        {rows.length > 0 && <StreakKey days={DAYS} />}
        <BadgesRow />
      </div>
    )}</BottomSheet>,
    document.body,
  );
}
