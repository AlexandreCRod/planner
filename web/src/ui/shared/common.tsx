// Small shared pieces: the hash router, task and event rows and their few icons.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { describe } from "../../domain/recurrence.ts";
import { type Occurrence, type Streak, type TaskEntry, completionDay, dueAt } from "../../domain/schedule.ts";
import { dueCountdown, formatTime, relativeDay } from "../../domain/dates.ts";
import { type AlertType, PRIORITIES, isRecurring, type Item, priorityColor } from "../../domain/types.ts";
import { reminderKind } from "../../domain/reminders.ts";
import { type Snapshot, toggleCompletion } from "../../store/store.ts";
import { streakSymbol } from "../../store/routines.ts";
import { feel } from "../phone/haptics.ts";

// Material Symbols paths (24 px viewBox).
const PATHS: Record<string, string> = {
  flag: "M5 21V4h9l.4 2H20v10h-7l-.4-2H7v7Z",
  alarm: "M12 22q-1.875 0-3.512-.712-1.638-.713-2.85-1.926-1.213-1.212-1.926-2.85Q3 14.875 3 13t.712-3.513q.713-1.637 1.926-2.85 1.212-1.212 2.85-1.925Q10.125 4 12 4t3.513.712q1.637.713 2.85 1.925 1.212 1.213 1.925 2.85Q21 11.125 21 13t-.712 3.512q-.713 1.638-1.925 2.85-1.213 1.213-2.85 1.926Q13.875 22 12 22Zm2.8-4.8 1.4-1.4-3.2-3.2V8h-2v5.4ZM5.6 2.35 7 3.75 2.75 8 1.35 6.6Zm12.8 0 4.25 4.25-1.4 1.4L17 3.75Z",
  link: "M11 17H7q-2.075 0-3.537-1.463Q2 14.075 2 12t1.463-3.538Q4.925 7 7 7h4v2H7q-1.25 0-2.125.875T4 12q0 1.25.875 2.125T7 15h4Zm-3-4v-2h8v2Zm5 4v-2h4q1.25 0 2.125-.875T20 12q0-1.25-.875-2.125T17 9h-4V7h4q2.075 0 3.538 1.462Q22 9.925 22 12q0 2.075-1.462 3.537Q19.075 17 17 17Z",
  repeat: "M7 22 3 18l4-4 1.4 1.45L6.85 17H17v-4h2v6H6.85l1.55 1.55Zm-2-11V5h12.15L15.6 3.45 17 2l4 4-4 4-1.4-1.45L17.15 7H7v4Z",
  fire: "M12 23q-3.75 0-6.375-2.625T3 14q0-3.4 2.112-6.638Q7.225 4.125 10.5 1.5v5.15q0 1.05.725 1.775.725.725 1.775.725.525 0 .963-.225.437-.225.787-.675L15 7.75q2.025 1.2 3.013 3.288Q19 13.125 19 14q0 3.75-2.625 6.375T12 23Z",
  bellOff: "M20 18.69L7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03zM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2zm6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.15.03-.29.08-.42.12-.1.03-.2.07-.3.11h-.01c-.01 0-.01 0-.02.01-.23.09-.46.2-.68.31 0 0-.01 0-.01.01L18 14.68z",
  bell: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z",
};

function Icon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={color ? { flex: "none", color } : { flex: "none" }}>
      <path d={PATHS[name] ?? ""} fill="currentColor" />
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
/** Goes to [path] in place of the page shown (no new step for back). */
export function replaceRoute(path: string) {
  history.replaceState(null, "", "#/" + path);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

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

export function Pill({ children, color, className = "", label }: { children: ReactNode; color: string; className?: string; label?: string }) {
  return <span className={`pill ${className}`} role={label ? "img" : undefined} aria-label={label} data-tip={label ? "" : undefined} style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)`, ["--pc" as string]: color }}>{children}</span>;
}

/** Seconds a ticked task stays where it was (Settings → Checked tasks); -1 until the page is left. */
export function checkedLinger(): number {
  const v = Number(localStorage.getItem("checkedLinger") ?? "3");
  return Number.isFinite(v) ? v : 3;
}

/** Whether ticked tasks stay listed on Today (after the linger); chosen in Settings. */
export const showDoneOnToday = () => localStorage.getItem("showDoneOnToday") !== "false";

/**
 * Keeps ticked tasks where they were for a while, so ticking doesn't make a row jump or vanish under
 * the pointer. Rows are identified by a list name plus a key that `arrange` computes the same way.
 */
export function useCheckedHold() {
  const [held, setHeld] = useState<Map<string, { index: number; entry: TaskEntry }>>(new Map());
  const timers = useRef(new Map<string, number>());
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);
  // The same object until a row is held or let go, so memoised lists can take it as a prop.
  return useMemo(() => {
  const drop = (k: string) => setHeld((prev) => { const n = new Map(prev); n.delete(k); return n; });
  return {
    onToggle(list: string, key: string, entry: TaskEntry, index: number, done: boolean) {
      const k = `${list}|${key}`;
      clearTimeout(timers.current.get(k));
      timers.current.delete(k);
      const secs = checkedLinger();
      if (!done || secs === 0) { drop(k); return; }
      setHeld((prev) => new Map(prev).set(k, { index, entry: { ...entry, status: "DONE" } }));
      if (secs > 0) timers.current.set(k, window.setTimeout(() => { timers.current.delete(k); drop(k); }, secs * 1000));
    },
    /** `real` with the held rows of `list` put back where they were, shown as ticked. */
    arrange(list: string, real: TaskEntry[], key: (e: TaskEntry) => string): TaskEntry[] {
      const prefix = `${list}|`;
      const mine = [...held].filter(([k]) => k.startsWith(prefix)).sort((a, b) => a[1].index - b[1].index);
      if (!mine.length) return real;
      const keys = new Set(mine.map(([k]) => k.slice(prefix.length)));
      const out = real.filter((e) => !keys.has(key(e)));
      for (const [, h] of mine) out.splice(Math.min(h.index, out.length), 0, h.entry);
      return out;
    },
  };
  }, [held]);
}

/** The "repeats" mark in front of a repeating item's title. */
export function RepeatBadge({ color }: { color: string }) {
  return <span className="rep" title="Repeats" style={{ color, background: `color-mix(in srgb, ${color} 20%, transparent)` }}><Icon name="repeat" size={12} /></span>;
}

/** The icon by an item's time for the reminders it has: an alarm clock, a bell, or a silent bell. */
function ReminderIcon({ kind }: { kind: AlertType | null }) {
  if (!kind) return null;
  const [cls, icon, label] = kind === "ALARM" ? ["alarm", "alarm", "Alarm"] : kind === "REMINDER" ? ["bell", "bell", "Notification"] : ["bell-off", "bellOff", "Silent notification"];
  return <span className={`sub-icon ${cls}`} role="img" aria-label={label}><Icon name={icon} size={14} /></span>;
}
const REMINDER_EMOJI: Record<AlertType, string> = { ALARM: "⏰", REMINDER: "🔔", NOTIFICATION: "🔕" };

export function TaskRow({ entry, s, now, streakInfo, showDay, onToggle, priorityTag, heldTime, past, actions, onOpen }: {
  entry: TaskEntry; s: Snapshot; now: number; streakInfo?: Streak; showDay?: boolean;
  /** Instead of opening the task straight away (a sheet closes first: Today's to-dos, 271). */
  onOpen?: () => void;
  /** Buttons shown over the end of the row while the pointer is on it (the wide Today). */
  actions?: ReactNode;
  /** Today's page: behind us now (shown very slightly faded). */
  past?: boolean;
  /** The time, which can be held to change it (Today; other lists pass none). */
  heldTime?: (entry: TaskEntry) => ReactNode;
  /** The phone's task lists: priority as a coloured "High" tag at the end instead of the small flag. */
  priorityTag?: boolean;
  /** Called with the new state before the tick is saved. */
  onToggle?: (done: boolean) => void;
}) {
  const { item, status } = entry;
  const done = status === "DONE";
  const color = s.colorOf(item);
  const due = dueAt(entry);
  // A ticked task's reminders are off (kept for un-ticking), so it shows none.
  const kind = done ? null : reminderKind(s.reminders.get(item.id));
  const linked = s.neighbours(item.id).size > 0;
  const subParts: ReactNode[] = [
    showDay && entry.day !== null ? relativeDay(entry.day) : null,
    item.startMin !== null ? (heldTime?.(entry) || formatTime(item.startMin)) : null,
    isRecurring(item) ? describe(item) : null,
  ].filter(Boolean);
  const sub = subParts.length > 0;
  return (
    <div className={`task ${past ? "past" : ""}`} style={{ ["--c" as string]: color }} onClick={() => (onOpen ? onOpen() : openItem(item, entry.day))}>
      <span className="bar" style={{ background: color }} />
      <input type="checkbox" checked={done} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { if (e.target.checked) feel("confirm"); onToggle?.(e.target.checked); toggleCompletion(item.id, completionDay(entry), e.target.checked); }} />
      <div className="grow">
        <div className={`title ellipsis ${done ? "done" : ""}`}>
          {isRecurring(item) && item.routine !== true && <RepeatBadge color={color} />}
          {item.priority > 0 && !done && !priorityTag && <span title={`${PRIORITIES[item.priority]} priority`} role="img" aria-label={`${PRIORITIES[item.priority]} priority`} data-tip style={{ verticalAlign: "-3px", marginRight: 4 }}><Icon name="flag" size={16} color={priorityColor(item.priority)} /></span>}
          {item.title || "Untitled"}
        </div>
        {sub && <div className="sub ellipsis">
          <span className="sub-text">{subParts.map((p, i) => <Fragment key={i}>{i > 0 && " · "}{p}</Fragment>)}</span>{kind && <span className="rem-emoji"> · {REMINDER_EMOJI[kind]}</span>}
          {/* The phone shows these as small icons after the line, like the native row (hidden on the PC). */}
          <ReminderIcon kind={kind} />
          {linked && <span className="sub-icon link"><Icon name="link" size={14} /></span>}
        </div>}
      </div>
      <span className="pills">
      {/* The flag alone, never the level's name (held, the phone shows it as a tooltip). */}
      {priorityTag && item.priority > 0 && !done && <Pill className="prio" color={priorityColor(item.priority)} label={`${PRIORITIES[item.priority]} priority`}><span className="sub-icon flag"><Icon name="flag" size={16} /></span></Pill>}
      {status === "OVERDUE" && <Pill color="var(--danger)">{entry.missed > 1 ? `${entry.missed} missed` : "Overdue"}</Pill>}
      {status === "CARRIED" && <Pill color="var(--p-tertiary, #7d5260)">Carried over</Pill>}
      {status === "MISSED" && <Pill color="var(--danger)">Missed</Pill>}
      {status === "DUE" && due !== null && <Pill color={due < now ? "var(--danger)" : color}>{dueCountdown(due, now)}</Pill>}
      {status === "UPCOMING" && entry.day !== null && <Pill color="var(--muted)">{relativeDay(entry.day)}</Pill>}
      {streakInfo && streakInfo.current > 0 && (streakSymbol()
        ? <Pill color="#ff7043"><span className="fire-emoji">🔥 </span><span className="sub-icon fire"><Icon name="fire" size={12} /></span>{streakInfo.current}</Pill>
        : <Pill color="#ff7043">{streakInfo.current} in a row</Pill>)}
      </span>
      {actions && <span className="p-quick" onClick={(e) => e.stopPropagation()}>{actions}</span>}
    </div>
  );
}

/** [heldTime]: the start and end times, which can be held to change them (Today; other lists pass none). */
export function EventRow({ o, s, showDay, heldTime, past }: { o: Occurrence; s: Snapshot; showDay?: boolean; heldTime?: (o: Occurrence, which: "start" | "end") => ReactNode; past?: boolean }) {
  const t1 = (o.timed && heldTime?.(o, "start")) || (o.startMin !== null ? formatTime(o.startMin) : "");
  const t2 = (o.timed && o.endMin !== null && heldTime?.(o, "end")) || (o.endMin !== null ? formatTime(o.endMin) : "");
  return (
    <div className={`event ${past ? "past" : ""}`} onClick={() => openItem(o.item, o.day)}>
      <div className="time">{o.timed ? <><span className="t1">{t1}</span>{o.endMin !== null && <><br /><span className="t2">{t2}</span></>}</> : <span className="t0">All day</span>}</div>
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: s.colorOf(o.item) }} />
      <div className="grow">
        <div className="ellipsis" style={o.completed ? { textDecoration: "line-through" } : undefined}>{isRecurring(o.item) && o.item.routine !== true && <RepeatBadge color={s.colorOf(o.item)} />}{o.item.title || "Untitled"}</div>
        <div className="hint ellipsis" style={{ fontSize: 12 }}>
          {[showDay ? relativeDay(o.day) : null, o.multiDay ? `until ${relativeDay(o.endDay)}` : null, isRecurring(o.item) ? describe(o.item) : null].filter(Boolean).join(" · ")}
          {!past && <ReminderIcon kind={reminderKind(s.reminders.get(o.item.id))} />}
        </div>
      </div>
    </div>
  );
}
