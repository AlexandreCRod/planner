// Small shared pieces: icons, task and event rows, the hash router.
import { useEffect, useState, type ReactNode } from "react";
import { describe } from "../domain/recurrence.ts";
import { type Occurrence, type Streak, type TaskEntry, completionDay, dueAt } from "../domain/schedule.ts";
import { dueCountdown, formatTime, relativeDay } from "../domain/dates.ts";
import { PRIORITY_COLORS, PRIORITIES, isRecurring, type Item } from "../domain/types.ts";
import { type Snapshot, toggleCompletion } from "../store/store.ts";

// Material Symbols paths (24 px viewBox).
const PATHS: Record<string, string> = {
  today: "M5 22q-.825 0-1.412-.587Q3 20.825 3 20V6q0-.825.588-1.412Q4.175 4 5 4h1V2h2v2h8V2h2v2h1q.825 0 1.413.588Q21 5.175 21 6v14q0 .825-.587 1.413Q19.825 22 19 22Zm0-2h14V10H5v10Zm2-6v-2h2v2Z",
  calendar: "M5 22q-.825 0-1.412-.587Q3 20.825 3 20V6q0-.825.588-1.412Q4.175 4 5 4h1V2h2v2h8V2h2v2h1q.825 0 1.413.588Q21 5.175 21 6v14q0 .825-.587 1.413Q19.825 22 19 22Zm0-2h14V10H5Zm7-6q-.425 0-.712-.288Q11 13.425 11 13t.288-.713Q11.575 12 12 12t.713.287Q13 12.575 13 13t-.287.712Q12.425 14 12 14Zm-4 0q-.425 0-.713-.288Q7 13.425 7 13t.287-.713Q7.575 12 8 12t.713.287Q9 12.575 9 13t-.287.712Q8.425 14 8 14Zm8 0q-.425 0-.712-.288Q15 13.425 15 13t.288-.713Q15.575 12 16 12t.712.287Q17 12.575 17 13t-.288.712Q16.425 14 16 14Zm-4 4q-.425 0-.712-.288Q11 17.425 11 17t.288-.712Q11.575 16 12 16t.713.288Q13 16.575 13 17t-.287.712Q12.425 18 12 18Zm-4 0q-.425 0-.713-.288Q7 17.425 7 17t.287-.712Q7.575 16 8 16t.713.288Q9 16.575 9 17t-.287.712Q8.425 18 8 18Zm8 0q-.425 0-.712-.288Q15 17.425 15 17t.288-.712Q15.575 16 16 16t.712.288Q17 16.575 17 17t-.288.712Q16.425 18 16 18Z",
  tasks: "m10.6 16.6 7.05-7.05-1.4-1.4-5.65 5.65-2.85-2.85-1.4 1.4ZM12 22q-2.075 0-3.9-.788-1.825-.787-3.175-2.137-1.35-1.35-2.137-3.175Q2 14.075 2 12t.788-3.9q.787-1.825 2.137-3.175 1.35-1.35 3.175-2.138Q9.925 2 12 2t3.9.787q1.825.788 3.175 2.138 1.35 1.35 2.137 3.175Q22 9.925 22 12t-.788 3.9q-.787 1.825-2.137 3.175-1.35 1.35-3.175 2.137Q14.075 22 12 22Z",
  notes: "M5 21q-.825 0-1.413-.587Q3 19.825 3 19V5q0-.825.587-1.413Q4.175 3 5 3h14q.825 0 1.413.587Q21 4.175 21 5v10l-6 6Zm2-8h5v-2H7Zm0-4h10V7H7Zm7 10.5 5.5-5.5H14Z",
  graph: "M12 22q-1.25 0-2.125-.875T9 19q0-.875.475-1.588Q9.95 16.7 10.7 16.35L10 13.95q-1.15-.175-2.012-.988T6.95 11H4.825q-.35.625-.95 1.012Q3.275 12.4 2.5 12.4q-1.05 0-1.775-.725Q0 10.95 0 9.9t.725-1.775Q1.45 7.4 2.5 7.4q.775 0 1.375.4t.95 1.2h2.1q.25-1.35 1.25-2.262 1-.913 2.375-1.088l.725-2.4q-.75-.35-1.212-1.05Q9.6 1.5 9.6.7h2q0 .425.3.712.3.288.7.288t.7-.288q.3-.287.3-.712h2q0 .8-.462 1.5-.463.7-1.213 1.05l.725 2.4q1.375.175 2.375 1.088 1 .912 1.25 2.262h2.075q.35-.8.95-1.2t1.375-.4q1.05 0 1.775.725Q24 8.85 24 9.9t-.725 1.775q-.725.725-1.775.725-.775 0-1.375-.388-.6-.387-.95-1.012H17.05q-.175 1.15-1.037 1.962-.863.813-2.013.988l-.7 2.4q.75.35 1.225 1.062Q15 17.125 15 18q0 1.25-.875 2.125T12 22Zm0-9q1.25 0 2.125-.875T15 10q0-1.25-.875-2.125T12 7q-1.25 0-2.125.875T9 10q0 1.25.875 2.125T12 13Z",
  search: "M19.6 21 13.3 14.7q-.75.6-1.725.95Q10.6 16 9.5 16q-2.725 0-4.612-1.887Q3 12.225 3 9.5q0-2.725 1.888-4.613Q6.775 3 9.5 3t4.613 1.887Q16 6.775 16 9.5q0 1.1-.35 2.075-.35.975-.95 1.725l6.3 6.3ZM9.5 14q1.875 0 3.188-1.312Q14 11.375 14 9.5q0-1.875-1.312-3.188Q11.375 5 9.5 5 7.625 5 6.312 6.312 5 7.625 5 9.5q0 1.875 1.312 3.188Q7.625 14 9.5 14Z",
  settings: "m9.25 22-.4-3.2q-.325-.125-.612-.3-.288-.175-.563-.375L4.7 19.375l-2.75-4.75 2.575-1.95Q4.5 12.5 4.5 12.338v-.675q0-.163.025-.338L1.95 9.375l2.75-4.75 2.975 1.25q.275-.2.575-.375.3-.175.6-.3l.4-3.2h5.5l.4 3.2q.325.125.613.3.287.175.562.375l2.975-1.25 2.75 4.75-2.575 1.95q.025.175.025.338v.674q0 .163-.05.338l2.575 1.95-2.75 4.75-2.95-1.25q-.275.2-.575.375-.3.175-.6.3l-.4 3.2Zm2.8-6.5q1.45 0 2.475-1.025Q15.55 13.45 15.55 12q0-1.45-1.025-2.475Q13.5 8.5 12.05 8.5q-1.475 0-2.488 1.025Q8.55 10.55 8.55 12q0 1.45 1.012 2.475Q10.575 15.5 12.05 15.5Z",
  add: "M11 19v-6H5v-2h6V5h2v6h6v2h-6v6Z",
  close: "M6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6Z",
  left: "m14 18-6-6 6-6 1.4 1.4-4.6 4.6 4.6 4.6Z",
  right: "M9.4 18 8 16.6l4.6-4.6L8 7.4 9.4 6l6 6Z",
  flag: "M5 21V4h9l.4 2H20v10h-7l-.4-2H7v7Z",
  alarm: "M12 22q-1.875 0-3.512-.712-1.638-.713-2.85-1.926-1.213-1.212-1.926-2.85Q3 14.875 3 13t.712-3.513q.713-1.637 1.926-2.85 1.212-1.212 2.85-1.925Q10.125 4 12 4t3.513.712q1.637.713 2.85 1.925 1.212 1.213 1.925 2.85Q21 11.125 21 13t-.712 3.512q-.713 1.638-1.925 2.85-1.213 1.213-2.85 1.926Q13.875 22 12 22Zm2.8-4.8 1.4-1.4-3.2-3.2V8h-2v5.4ZM5.6 2.35 7 3.75 2.75 8 1.35 6.6Zm12.8 0 4.25 4.25-1.4 1.4L17 3.75Z",
  link: "M11 17H7q-2.075 0-3.537-1.463Q2 14.075 2 12t1.463-3.538Q4.925 7 7 7h4v2H7q-1.25 0-2.125.875T4 12q0 1.25.875 2.125T7 15h4Zm-3-4v-2h8v2Zm5 4v-2h4q1.25 0 2.125-.875T20 12q0-1.25-.875-2.125T17 9h-4V7h4q2.075 0 3.538 1.462Q22 9.925 22 12q0 2.075-1.462 3.537Q19.075 17 17 17Z",
  repeat: "M7 22 3 18l4-4 1.4 1.45L6.85 17H17v-4h2v6H6.85l1.55 1.55Zm-2-11V5h12.15L15.6 3.45 17 2l4 4-4 4-1.4-1.45L17.15 7H7v4Z",
  fire: "M12 23q-3.75 0-6.375-2.625T3 14q0-3.4 2.112-6.638Q7.225 4.125 10.5 1.5v5.15q0 1.05.725 1.775.725.725 1.775.725.525 0 .963-.225.437-.225.787-.675L15 7.75q2.025 1.2 3.013 3.288Q19 13.125 19 14q0 3.75-2.625 6.375T12 23Z",
  trash: "M7 21q-.825 0-1.412-.587Q5 19.825 5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413Q17.825 21 17 21Zm2-4h2V8H9Zm4 0h2V8h-2Z",
  pin: "m16 12 2 2v2h-5v6l-1 1-1-1v-6H6v-2l2-2V5H7V3h10v2h-1Z",
  undo: "M7 19v-2h7.1q1.575 0 2.738-1Q18 15 18 13.5T16.837 11q-1.162-1-2.737-1H7.8l2.6 2.6L9 14 4 9l5-5 1.4 1.4L7.8 8h6.3q2.425 0 4.163 1.575Q20 11.15 20 13.5q0 2.35-1.737 3.925Q16.525 19 14.1 19Z",
  redo: "M9.9 19q-2.425 0-4.163-1.575Q4 15.85 4 13.5q0-2.35 1.737-3.925Q7.475 8 9.9 8h6.3l-2.6-2.6L15 4l5 5-5 5-1.4-1.4 2.6-2.6H9.9q-1.575 0-2.737 1Q6 11 6 12.5T7.163 15q1.162 1 2.737 1H17v2Z",
  zoomIn: "M19.6 21 13.3 14.7q-.75.6-1.725.95Q10.6 16 9.5 16q-2.725 0-4.612-1.887Q3 12.225 3 9.5q0-2.725 1.888-4.613Q6.775 3 9.5 3t4.613 1.887Q16 6.775 16 9.5q0 1.1-.35 2.075-.35.975-.95 1.725l6.3 6.3ZM8.5 13v-2.5H6v-2h2.5V6h2v2.5H13v2h-2.5V13Z",
  image: "M5 21q-.825 0-1.412-.587Q3 19.825 3 19V5q0-.825.588-1.413Q4.175 3 5 3h14q.825 0 1.413.587Q21 4.175 21 5v14q0 .825-.587 1.413Q19.825 21 19 21Zm0-2h14V5H5Zm1-2h12l-3.75-5-3 4L9 13Z",
  place: "M12 12q.825 0 1.413-.588Q14 10.825 14 10t-.587-1.413Q12.825 8 12 8q-.825 0-1.412.587Q10 9.175 10 10q0 .825.588 1.412Q11.175 12 12 12Zm0 10q-4.025-3.425-6.012-6.362Q4 12.7 4 10.2q0-3.75 2.413-5.975Q8.825 2 12 2t5.587 2.225Q20 6.45 20 10.2q0 2.5-1.987 5.438Q16.025 18.575 12 22Z",
  myLocation: "M11 23v-2.05q-3.125-.35-5.363-2.587Q3.4 16.125 3.05 13H1v-2h2.05q.35-3.125 2.587-5.363Q7.875 3.4 11 3.05V1h2v2.05q3.125.35 5.363 2.587Q20.6 7.875 20.95 11H23v2h-2.05q-.35 3.125-2.587 5.363Q16.125 20.6 13 20.95V23Zm1-4q2.9 0 4.95-2.05Q19 14.9 19 12q0-2.9-2.05-4.95Q14.9 5 12 5 9.1 5 7.05 7.05 5 9.1 5 12q0 2.9 2.05 4.95Q9.1 19 12 19Zm0-3q-1.65 0-2.825-1.175Q8 13.65 8 12q0-1.65 1.175-2.825Q10.35 8 12 8q1.65 0 2.825 1.175Q16 10.35 16 12q0 1.65-1.175 2.825Q13.65 16 12 16Z",
  map: "m15 21-6-2.1-4.65 1.8q-.5.2-.925-.113Q3 20.275 3 19.75V5.75q0-.325.188-.575.187-.25.512-.375L9 3l6 2.1 4.65-1.8q.5-.2.925.112.425.313.425.838v14q0 .325-.187.575-.188.25-.513.375Zm-1-2.45V6.85l-4-1.4v11.7Z",
  fit: "M3 21v-6h2v2.6l3.1-3.1 1.4 1.4L6.4 19H9v2Zm12 0v-2h2.6l-3.05-3.05 1.4-1.4L19 17.6V15h2v6ZM8.05 9.5 5 6.4V9H3V3h6v2H6.4l3.05 3.05Zm7.9 0-1.4-1.4L17.6 5H15V3h6v6h-2V6.4Z",
};

export function Icon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none" }}>
      <path d={PATHS[name] ?? ""} fill={color ?? "currentColor"} />
    </svg>
  );
}

/** Hash routes: #/today, #/note/123, #/item/45?occ=20374 ... */
export function useRoute(): [string[], URLSearchParams] {
  const read = () => {
    const h = location.hash.replace(/^#\/?/, "");
    const [path, query = ""] = h.split("?");
    return [path.split("/").filter(Boolean), new URLSearchParams(query)] as [string[], URLSearchParams];
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const go = (path: string) => { location.hash = "#/" + path; };

export function openItem(item: Item, occurrenceDay?: number | null) {
  if (item.type === "NOTE") go(`note/${item.id}`);
  else go(`item/${item.id}${occurrenceDay != null ? `?occ=${occurrenceDay}` : ""}`);
}

/** Current time, refreshed every 30 s, for countdowns. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return now;
}

export function Pill({ children, color }: { children: ReactNode; color: string }) {
  return <span className="pill" style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}>{children}</span>;
}

export function TaskRow({ entry, s, now, streakInfo, showDay }: { entry: TaskEntry; s: Snapshot; now: number; streakInfo?: Streak; showDay?: boolean }) {
  const { item, status } = entry;
  const done = status === "DONE";
  const color = s.colorOf(item);
  const due = dueAt(entry);
  const sub = [
    showDay && entry.day !== null ? relativeDay(entry.day) : null,
    item.startMin !== null ? formatTime(item.startMin) : null,
    isRecurring(item) ? describe(item) : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="task" onClick={() => openItem(item, entry.day)}>
      <span className="bar" style={{ background: color }} />
      <input type="checkbox" checked={done} onClick={(e) => e.stopPropagation()}
        onChange={(e) => toggleCompletion(item.id, completionDay(entry), e.target.checked)} />
      <div className="grow">
        <div className={`title ellipsis ${done ? "done" : ""}`}>
          {item.priority > 0 && !done && <span title={`${PRIORITIES[item.priority]} priority`} style={{ verticalAlign: "-3px", marginRight: 4 }}><Icon name="flag" size={16} color={PRIORITY_COLORS[item.priority]} /></span>}
          {item.title || "Untitled"}
        </div>
        {sub && <div className="sub ellipsis">{sub}{(s.reminders.get(item.id)?.length ?? 0) > 0 && " · ⏰"}</div>}
      </div>
      {status === "OVERDUE" && <Pill color="var(--danger)">{entry.missed > 1 ? `${entry.missed} missed` : "Overdue"}</Pill>}
      {status === "CARRIED" && <Pill color="#7d5260">Carried over</Pill>}
      {status === "DUE" && due !== null && <Pill color={due < now ? "var(--danger)" : color}>{dueCountdown(due, now)}</Pill>}
      {status === "UPCOMING" && entry.day !== null && <Pill color="var(--muted)">{relativeDay(entry.day)}</Pill>}
      {streakInfo && streakInfo.current > 0 && <Pill color="#ff7043">🔥 {streakInfo.current}</Pill>}
    </div>
  );
}

export function EventRow({ o, s, showDay }: { o: Occurrence; s: Snapshot; showDay?: boolean }) {
  return (
    <div className="event" onClick={() => openItem(o.item, o.day)}>
      <div className="time">{o.timed ? <>{formatTime(o.startMin!)}{o.endMin !== null && <><br />{formatTime(o.endMin)}</>}</> : "All day"}</div>
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: s.colorOf(o.item) }} />
      <div className="grow">
        <div className="ellipsis">{o.item.title || "Untitled"}</div>
        <div className="hint ellipsis" style={{ fontSize: 12 }}>
          {[showDay ? relativeDay(o.day) : null, o.multiDay ? `until ${relativeDay(o.endDay)}` : null, isRecurring(o.item) ? describe(o.item) : null].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );
}
