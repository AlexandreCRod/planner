import { useState } from "react";
import { today as todayEpoch } from "../domain/dates.ts";
import { currentEntry, streak, type TaskEntry } from "../domain/schedule.ts";
import { isRecurring } from "../domain/types.ts";
import { useSnapshot } from "../store/store.ts";
import { TaskRow, useCheckedHold, useNow } from "./common.tsx";

const GROUPS = ["Daily", "Weekly", "Monthly", "Yearly", "One-time", "Anytime"] as const;

function groupOf(e: TaskEntry): (typeof GROUPS)[number] {
  switch (e.item.freq) {
    case "DAILY": return "Daily";
    case "WEEKLY": return "Weekly";
    case "MONTHLY": return "Monthly";
    case "YEARLY": return "Yearly";
    default: return e.item.startDay === null ? "Anytime" : "One-time";
  }
}

export function TasksView() {
  const s = useSnapshot();
  const now = useNow();
  const t = todayEpoch();
  const [showDone, setShowDone] = useState(false);
  const [category, setCategory] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hold = useCheckedHold();

  const entries = s.items
    .filter((i) => i.type === "TASK" && (category === null || i.categoryId === category))
    .map((i) => currentEntry(i, s.done, t))
    .filter((e) => showDone || e.status !== "DONE" || isRecurring(e.item));
  const sorted = (list: TaskEntry[]) => [...list].sort((a, b) =>
    Number(a.status === "DONE") - Number(b.status === "DONE") || b.item.priority - a.item.priority ||
    (a.day ?? 1e9) - (b.day ?? 1e9) || (a.item.startMin ?? 1e9) - (b.item.startMin ?? 1e9) || a.item.title.localeCompare(b.item.title));

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="chips-row">
        <button className={`chip ${showDone ? "on" : ""}`} onClick={() => setShowDone(!showDone)}>Show completed</button>
        {s.categories.map((c) => (
          <button key={c.id} className={`chip ${category === c.id ? "on" : ""}`} onClick={() => setCategory(category === c.id ? null : c.id)}>{c.name}</button>
        ))}
      </div>
      {entries.length === 0 && <div className="hint">No tasks yet. Try typing "Stretch every day 7am" in the bar at the top.</div>}
      {GROUPS.map((g) => {
        // A ticked task stays in place for a while instead of jumping or vanishing at once.
        const list = hold.arrange(g, sorted(entries.filter((e) => groupOf(e) === g)), (e) => String(e.item.id));
        if (!list.length) return null;
        const isCollapsed = collapsed.has(g);
        return (
          <div key={g}>
            <div className="section" style={{ cursor: "pointer" }} onClick={() => {
              const n = new Set(collapsed);
              if (isCollapsed) n.delete(g); else n.add(g);
              setCollapsed(n);
            }}>{isCollapsed ? "▸" : "▾"} {g} ({list.length})</div>
            {!isCollapsed && list.map((e, index) => (
              <TaskRow key={e.item.id} entry={e} s={s} now={now} showDay streakInfo={isRecurring(e.item) ? streak(e.item, s.done, t) : undefined}
                onToggle={(done) => hold.onToggle(g, String(e.item.id), e, index, done)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
