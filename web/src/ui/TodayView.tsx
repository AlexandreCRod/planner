import { formatDate, today as todayEpoch } from "../domain/dates.ts";
import { occurrencesIn, streak, tasksForDay } from "../domain/schedule.ts";
import { preview } from "../domain/text.ts";
import { isRecurring } from "../domain/types.ts";
import { useSnapshot } from "../store/store.ts";
import { EventRow, TaskRow, go, useNow } from "./common.tsx";

export function TodayView() {
  const s = useSnapshot();
  const now = useNow();
  const t = todayEpoch();
  const tasks = tasksForDay(s.items, s.done, t);
  const overdue = tasks.filter((e) => e.status === "OVERDUE");
  const due = tasks.filter((e) => e.status === "DUE" || e.status === "CARRIED" || e.status === "DONE");
  const anytime = tasks.filter((e) => e.status === "ANYTIME");
  const events = occurrencesIn(s.items.filter((i) => i.type === "EVENT"), s.done, t, t + 7);
  const todays = events.filter((o) => o.day <= t && o.endDay >= t);
  const upcoming = events.filter((o) => o.day > t).slice(0, 8);
  const daily = s.items.find((i) => i.type === "NOTE" && i.noteDay === t);
  const doneCount = due.filter((e) => e.status === "DONE").length;

  return (
    <div style={{ maxWidth: 820 }}>
      <h2 style={{ margin: "4px 0 6px", fontWeight: 500 }}>{formatDate(t)}</h2>
      {due.length > 0 && (
        <div style={{ margin: "6px 0 4px" }}>
          <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
            <div style={{ width: `${(doneCount / due.length) * 100}%`, height: "100%", background: "var(--accent)" }} />
          </div>
          <div className="hint" style={{ marginTop: 4 }}>{doneCount} of {due.length} tasks done</div>
        </div>
      )}
      {overdue.length > 0 && <>
        <div className="section">Overdue</div>
        {overdue.map((e) => <TaskRow key={`o${e.item.id}-${e.day}`} entry={e} s={s} now={now} showDay />)}
      </>}
      <div className="section">Tasks</div>
      {due.length === 0 && <div className="hint">No tasks due today. Use the bar at the top to add one.</div>}
      {due.map((e) => <TaskRow key={`t${e.item.id}-${e.day}`} entry={e} s={s} now={now} streakInfo={isRecurring(e.item) ? streak(e.item, s.done, t) : undefined} />)}
      {anytime.length > 0 && <div className="hint" style={{ marginTop: 6 }}>{anytime.length} task(s) without a date — see Tasks</div>}
      <div className="section">Schedule</div>
      {todays.length === 0 && <div className="hint">Nothing scheduled today.</div>}
      {todays.map((o) => <EventRow key={`e${o.item.id}-${o.day}`} o={o} s={s} />)}
      <div className="section">Today's note</div>
      <div className="card" style={{ padding: 14, cursor: "pointer" }} onClick={() => go(daily ? `note/${daily.id}` : `note/new?day=${t}`)}>
        {daily ? preview(daily.content, 200) || "Empty — click to write" : "Start today's journal or notes"}
      </div>
      {upcoming.length > 0 && <>
        <div className="section">Next 7 days</div>
        {upcoming.map((o) => <EventRow key={`u${o.item.id}-${o.day}`} o={o} s={s} showDay />)}
      </>}
    </div>
  );
}
