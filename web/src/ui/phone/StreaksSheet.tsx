// The Streaks sheet (from the Tasks page's menu and Settings): every routine, tasks and repeating events,
// with its current streak, its best one and its last 14 days as a row of small dots (filled = done,
// red = missed, a ring = today still open, a speck = not one of its days). A tap opens the routine.
// It shows whatever the Streak badges setting says, since it was opened to see them.
import { createPortal } from "react-dom";
import { today as todayEpoch } from "../../domain/dates.ts";
import { streakRows } from "../../domain/routines.ts";
import { useSnapshot } from "../../store/store.ts";
import { streakSymbol } from "../../store/routines.ts";
import { openItem } from "../shared/common.tsx";
import { MIcon } from "./chrome.tsx";
import { BottomSheet } from "./m3.tsx";

const DAYS = 14;
const MARK_LABEL = { done: "done", missed: "missed", open: "today, still open", off: "not one of its days" } as const;

export function StreaksSheet({ onClose }: { onClose: () => void }) {
  const s = useSnapshot();
  const t = todayEpoch();
  const rows = streakRows(s.items, s.done, t, DAYS);
  const flame = streakSymbol();
  return createPortal(
    <BottomSheet onClose={onClose} className="p-rlist-sheet">{(close) => (
      <div className="p-rlist">
        <div className="p-rlist-head t-title-medium">Streaks</div>
        {rows.length === 0 && <div className="p-rlist-empty muted">No routines yet. Turn on Routine in a repeating task or event.</div>}
        <div className="p-rlist-rows">
          {rows.map((r) => (
            <button key={r.item.id} className="p-streak-row" onClick={() => { close(); window.setTimeout(() => openItem(r.item), 210); }}>
              <span className="text">
                <span className="name">{r.item.title || "Untitled"}</span>
                <span className="sub">{r.repeat} · Best {r.streak.best}</span>
                <span className="p-streak-days" role="img" aria-label={`Last ${DAYS} days: ${r.days.filter((d) => d === "done").length} done, ${r.days.filter((d) => d === "missed").length} missed`}>
                  {r.days.map((d, i) => <span key={i} className={d} title={MARK_LABEL[d]} />)}
                </span>
              </span>
              <span className={`p-streak-now ${r.streak.current > 0 ? "on" : ""}`}>
                <span className="n">{flame && <MIcon name="fLocalFireDepartment" size={18} />}{r.streak.current}</span>
                <span className="l">in a row</span>
              </span>
            </button>
          ))}
        </div>
        {rows.length > 0 && <div className="p-streak-foot muted">Last {DAYS} days, today on the right</div>}
      </div>
    )}</BottomSheet>,
    document.body,
  );
}
