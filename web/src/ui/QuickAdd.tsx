import { useMemo, useState } from "react";
import { describe } from "../domain/recurrence.ts";
import { formatTime, offsetLabel, relativeDay, today } from "../domain/dates.ts";
import { parseQuickAdd } from "../domain/quickadd.ts";
import { PRIORITIES, PRIORITY_COLORS_MUTED, newItem, type ItemType } from "../domain/types.ts";
import { saveItem } from "../store/store.ts";
import { go } from "./common.tsx";

/** One-line entry in the top bar: "Dentist tue 3pm remind 1h before !alarm #health". */
export function QuickAdd({ defaultDay }: { defaultDay?: number }) {
  const [text, setText] = useState("");
  const [type, setType] = useState<ItemType>("TASK");
  const p = useMemo(() => parseQuickAdd(text), [text]);

  const build = () => {
    const day = p.day ?? (type === "EVENT" ? defaultDay ?? today() : null);
    const start = p.startMin;
    return newItem({
      type,
      title: p.title || text.trim(),
      startDay: day ?? (p.freq !== "NONE" ? today() : null),
      startMin: start,
      endDay: type === "EVENT" ? day : null,
      endMin: type === "EVENT" ? p.endMin : null,
      allDay: type === "EVENT" && start === null,
      freq: p.freq, interval: p.interval, weekDays: p.weekDays,
      priority: type === "TASK" ? p.priority : 0,
    });
  };

  const submit = () => {
    if (!text.trim()) return;
    if (type === "NOTE") {
      const id = saveItem(newItem({ type: "NOTE", title: text.trim() }));
      go(`note/${id}`);
    } else {
      saveItem(build(), { reminders: p.alerts.map(([offsetMin, t]) => ({ id: 0, itemId: 0, offsetMin, type: t, soundUri: null })), tags: p.tags });
    }
    setText("");
  };

  const item = text.trim() && type !== "NOTE" ? build() : null;
  return (
    <div className="quick">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setText(""); }}
        placeholder={'Add… e.g. "Dentist tue 3pm remind 1h before !alarm #health"'}
        aria-label="Quick add"
      />
      {text.trim() && (
        <div className="chips">
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="seg">
              {(["TASK", "EVENT", "NOTE"] as ItemType[]).map((t) => (
                <button key={t} className={type === t ? "on" : ""} onClick={() => setType(t)}>{t[0] + t.slice(1).toLowerCase()}</button>
              ))}
            </div>
            <span className="grow" />
            <button className="btn primary small" onClick={submit}>Add ↵</button>
          </div>
          {item && (
            <div className="chips-row" style={{ margin: 0 }}>
              <span className="chip"><b>{item.title || "…"}</b></span>
              {item.startDay !== null && <span className="chip">📅 {relativeDay(item.startDay)}</span>}
              {item.startMin !== null && <span className="chip">🕒 {formatTime(item.startMin)}{item.endMin !== null ? `–${formatTime(item.endMin)}` : ""}</span>}
              {item.freq !== "NONE" && <span className="chip">🔁 {describe(item)}</span>}
              {p.alerts.map(([o, t], i) => <span key={i} className="chip">{t === "ALARM" ? "⏰ Alarm" : t === "REMINDER" ? "🔔 Reminder" : "🔕 Silent"} · {offsetLabel(o)}</span>)}
              {item.priority > 0 && <span className="chip" style={{ color: PRIORITY_COLORS_MUTED[item.priority] }}>⚑ {PRIORITIES[item.priority]}</span>}
              {p.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
            </div>
          )}
          <div className="hint" style={{ marginTop: 8, fontSize: 12 }}>
            dates: tomorrow, fri, 12/3 · times: 3pm, 15:30 · repeat: every mon, wed · remind 30m before · !alarm · !high · #tag
          </div>
        </div>
      )}
    </div>
  );
}
