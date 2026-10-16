import { useState } from "react";
import { today as todayEpoch } from "../domain/dates.ts";
import { currentEntry, streak, type TaskEntry } from "../domain/schedule.ts";
import { NO_DAY, isRecurring, newItem } from "../domain/types.ts";
import { isRoutineItem, routineEntry } from "../domain/routines.ts";
import { showStreaks } from "../store/routines.ts";
import { saveItem, toggleCompletion, useSnapshot } from "../store/store.ts";
import { Icon, TaskRow, go, useCheckedHold, useNow } from "./common.tsx";

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
  const streaks = showStreaks();
  // Scheduled tasks, or the to-do list: tasks with no date or time.
  const [todo, setTodo] = useState(() => localStorage.getItem("tasksTab") === "todo");
  const showTab = (v: boolean) => { setTodo(v); localStorage.setItem("tasksTab", v ? "todo" : "scheduled"); };

  const entries = s.items
    .filter((i) => i.type === "TASK" && i.startDay !== null && (category === null || i.categoryId === category))
    // A routine shows today's occurrence or its next one, never a missed day (that only ends its streak).
    .map((i) => (isRoutineItem(i) ? routineEntry(i, s.done, t) : currentEntry(i, s.done, t)))
    .filter((e) => showDone || e.status !== "DONE" || isRecurring(e.item));
  const sorted = (list: TaskEntry[]) => [...list].sort((a, b) =>
    Number(a.status === "DONE") - Number(b.status === "DONE") || b.item.priority - a.item.priority ||
    (a.day ?? 1e9) - (b.day ?? 1e9) || (a.item.startMin ?? 1e9) - (b.item.startMin ?? 1e9) || a.item.title.localeCompare(b.item.title));

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={!todo ? "on" : ""} onClick={() => showTab(false)}>Scheduled</button>
        <button className={todo ? "on" : ""} onClick={() => showTab(true)}>To-do</button>
      </div>
      {todo ? <TodoList /> : <>
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
              <TaskRow key={e.item.id} entry={e} s={s} now={now} showDay streakInfo={streaks && isRoutineItem(e.item) ? streak(e.item, s.done, t) : undefined}
                onToggle={(done) => hold.onToggle(g, String(e.item.id), e, index, done)} />
            ))}
          </div>
        );
      })}
      </>}
    </div>
  );
}

/** The to-do list: tasks with no date or time, Google Tasks style, with a line to add one straight away. */
function TodoList() {
  const s = useSnapshot();
  const now = useNow();
  const hold = useCheckedHold();
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const undated = s.items.filter((i) => i.type === "TASK" && i.startDay === null);
  const open = undated.filter((i) => !s.done.isDone(i.id, NO_DAY))
    .sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt)
    .map((item): TaskEntry => ({ item, day: null, status: "ANYTIME", missed: 0 }));
  const shown = hold.arrange("todo", open, (e) => String(e.item.id));
  const done = undated.filter((i) => s.done.isDone(i.id, NO_DAY)).sort((a, b) => b.updatedAt - a.updatedAt);
  const add = () => {
    const title = text.trim();
    if (!title) return;
    saveItem(newItem({ type: "TASK", title }));
    setText("");
  };
  return (
    <div>
      <div className="row todo-add">
        <Icon name="add" />
        <input className="plain grow" placeholder="Add a to-do" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        {text.trim() && <button className="btn small primary" onClick={add}>Add</button>}
      </div>
      {!shown.length && !done.length && <div className="hint">Nothing to do. Type above to add a task with no date.</div>}
      {shown.map((e, index) => (
        <TaskRow key={e.item.id} entry={e} s={s} now={now} onToggle={(isDone) => hold.onToggle("todo", String(e.item.id), e, index, isDone)} />
      ))}
      {done.length > 0 && <>
        <div className="section" style={{ cursor: "pointer" }} onClick={() => setShowDone(!showDone)}>{showDone ? "▾" : "▸"} Completed ({done.length})</div>
        {showDone && done.map((item) => (
          <div key={item.id} className="task" onClick={() => go(`item/${item.id}`)}>
            <span className="bar" style={{ background: s.colorOf(item) }} />
            <input type="checkbox" checked onClick={(e) => e.stopPropagation()} onChange={() => toggleCompletion(item.id, NO_DAY, false)} />
            <div className="grow"><div className="title done ellipsis">{item.title || "Untitled"}</div></div>
          </div>
        ))}
      </>}
    </div>
  );
}
