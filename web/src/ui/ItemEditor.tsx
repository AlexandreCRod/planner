// Side panel for tasks and events: a simple view when opened, the full editor after Edit (same fields as the phone's).
import { useEffect, useRef, useState } from "react";
import { searchNominatim } from "./phone/device.ts";
import { epochOf, formatDate, formatTime, offsetText, today as todayEpoch, weekday, ymd } from "../domain/dates.ts";
import { LAST_DAY_OF_MONTH, dayBit, describe, hasMonth, hasWeekDay, occurrences, occursOn, parseIntList } from "../domain/recurrence.ts";
import { currentEntry, streak } from "../domain/schedule.ts";
import { canBeRoutine, isRoutineItem } from "../domain/routines.ts";
import { defaultOffset, firstReminders } from "../domain/reminders.ts";
import { preview } from "../domain/text.ts";
import {
  type AlertType, type Freq, type Item, type OverduePolicy, type Reminder,
  NO_DAY, PRIORITIES, PRIORITY_COLORS_MUTED, argbOf, cssColor, isRecurring,
} from "../domain/types.ts";
import { type EditScope, deleteForever, deleteOccurrence, saveItem, saveSeriesEdit, toggleCompletion, trash, useSnapshot } from "../store/store.ts";
import { Icon, go } from "./common.tsx";
import { LinksSection } from "./LinksSection.tsx";
import { RichEditor, type RichEditorHandle, sanitize } from "./RichEditor.tsx";

const OFFSETS = [0, 5, 10, 15, 30, 60, 120, 180, 1440, 2880, 10080, -5, -10, -15, -30, -60];
const toInput = (e: number | null) => { if (e === null) return ""; const { y, m, d } = ymd(e); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
const fromInput = (v: string) => { const [y, m, d] = v.split("-").map(Number); return v ? epochOf(y, m, d) : null; };
const timeInput = (min: number | null) => (min === null ? "" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
const fromTime = (v: string) => { if (!v) return null; const [h, m] = v.split(":").map(Number); return h * 60 + m; };

export function ScopeDialog({ title, onPick, onCancel }: { title: string; onPick: (s: EditScope) => void; onCancel: () => void }) {
  return (
    <div className="panel-backdrop" style={{ justifyContent: "center", alignItems: "center" }} onClick={onCancel}>
      <div className="card" style={{ padding: 20, width: 340, display: "flex", flexDirection: "column", gap: 8 }} onClick={(e) => e.stopPropagation()}>
        <b style={{ fontSize: 16 }}>{title}</b>
        <button className="btn" onClick={() => onPick("THIS")}>This occurrence only</button>
        <button className="btn" onClick={() => onPick("FOLLOWING")}>This and following</button>
        <button className="btn" onClick={() => onPick("ALL")}>All occurrences</button>
        <button className="btn" style={{ border: 0 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * An unsaved item edited from outside (the phone's add panel, which grows into this editor): the
 * panel and the editor share it, so whatever is typed in one shows in the other.
 */
export interface Draft { item: Item; reminders: Reminder[]; tags: string }

export function ItemEditor({ id, occurrence, isNewPlaceholder, onClose, draft, onDraft, embedded, saveRef }: {
  id: number; occurrence: number | null; isNewPlaceholder: boolean; onClose: () => void;
  /** Controlled mode (phone add panel): edits an unsaved item (id 0) held by the caller. */
  draft?: Draft; onDraft?: (d: Draft) => void;
  /** Only the panel's content, without the backdrop (it sits inside the phone's growing panel). */
  embedded?: boolean;
  /** Filled with this editor's save, so the small panel's Save keeps what was set here. */
  saveRef?: { current: (() => void) | null };
}) {
  const s = useSnapshot();
  const original = draft ? draft.item : s.byId.get(id) ?? null;
  const [dLocal, setDLocal] = useState<Item | null>(original);
  const d = draft ? draft.item : dLocal;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const setD = (u: Item | null | ((x: Item | null) => Item | null)) => {
    const cur = draftRef.current;
    if (!cur || !onDraft) { setDLocal(u); return; }
    const next = typeof u === "function" ? u(cur.item) : u;
    if (next) emit({ ...cur, item: next });
  };
  // Several changes in one click each build on the last (the prop only updates on the next render).
  const emit = (n: Draft) => { draftRef.current = n; onDraft?.(n); };
  const [remindersLocal, setRemindersLocal] = useState<Reminder[]>(() => {
    const saved = (s.reminders.get(id) ?? []).map((r) => ({ ...r }));
    // A new item starts with one alert (domain/reminders.ts): 30 minutes before a timed one, a
    // reminder for an event, a silent notification for a task.
    if (isNewPlaceholder && !saved.length && original?.startDay != null) return firstReminders(original).map((r) => ({ ...r, itemId: id }));
    return saved;
  });
  const reminders = draft ? draft.reminders : remindersLocal;
  const setReminders = (r: Reminder[]) => { const cur = draftRef.current; if (cur && onDraft) emit({ ...cur, reminders: r }); else setRemindersLocal(r); };
  const [tagsLocal, setTagsLocal] = useState(() => (s.tagsByItem.get(id) ?? []).map((t) => t.name).join(" "));
  const tags = draft ? draft.tags : tagsLocal;
  const setTags = (t: string) => { const cur = draftRef.current; if (cur && onDraft) emit({ ...cur, tags: t }); else setTagsLocal(t); };
  const [scopeFor, setScopeFor] = useState<"save" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rich = useRef<RichEditorHandle>(null);
  const [initialHtml, setInitialHtml] = useState(original?.content ?? "");
  // Opening a task or event shows a simple view; Edit opens the full editor. New items start in it.
  const [editing, setEditing] = useState(isNewPlaceholder);
  // Editor sections opened with the "Add" chips (they also show by themselves once they have content).
  const [added, setAdded] = useState<Set<string>>(new Set());
  // What's being typed as a location (null once a suggestion is picked), and the addresses it matches.
  const [placeQuery, setPlaceQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ name: string; lat: number; lng: number }[]>([]);
  useEffect(() => {
    const q = placeQuery?.trim() ?? "";
    if (q.length < 3) { setSuggestions([]); return; }
    let stop = false;
    const t = setTimeout(() => { void searchPlaces(q).then((r) => { if (!stop) setSuggestions(r); }); }, 500);
    return () => { stop = true; clearTimeout(t); };
  }, [placeQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!d || !original) return null;
  const set = (patch: Partial<Item>) => setD({ ...d, ...patch });
  const isEvent = d.type === "EVENT";
  const category = d.categoryId !== null ? s.categoryById.get(d.categoryId) : undefined;
  const tagList = () => tags.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
  const add = (k: string) => setAdded(new Set([...added, k]));
  const locate = () => {
    if (!navigator.geolocation) { alert("This browser can't tell where you are."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const { latitude: lat, longitude: lng } = pos.coords; setD((x) => x && { ...x, location: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }); },
      () => alert("Couldn't get this computer's location (permission refused or not available)."),
      { timeout: 15000 },
    );
  };

  const finalItem = (): Item => {
    let it: Item = { ...d, title: d.title.trim(), content: rich.current?.html() ?? d.content, location: (d.location ?? "").trim() };
    if (it.type === "EVENT") {
      const sd = it.startDay ?? todayEpoch();
      const ed = Math.max(it.endDay ?? sd, sd);
      let em = it.endMin;
      if (!it.allDay && ed === sd && it.startMin !== null && (em === null || em <= it.startMin)) em = Math.min(it.startMin + 30, 1439);
      it = { ...it, startDay: sd, endDay: ed, endMin: em };
    } else it = { ...it, endDay: null, endMin: null, allDay: false };
    if (it.freq !== "NONE" && it.startDay === null) it.startDay = todayEpoch();
    // Only a repeating task can be a routine.
    if (it.routine && !canBeRoutine(it)) it.routine = false;
    return it;
  };

  // Start editing from what is saved now (it may have synced since the panel opened).
  const startEdit = () => {
    setD(original);
    setReminders((s.reminders.get(id) ?? []).map((r) => ({ ...r })));
    setTags((s.tagsByItem.get(id) ?? []).map((t) => t.name).join(" "));
    setInitialHtml(original.content);
    setAdded(new Set());
    setEditing(true);
  };

  function cancel() {
    if (isNewPlaceholder) { if (!draft) deleteForever(id); onClose(); }
    else if (editing) setEditing(false); // back to the view, changes dropped
    else onClose();
  }

  const save = (scope?: EditScope) => {
    const item = finalItem();
    if (isRecurring(original) && occurrence !== null && !isNewPlaceholder && !scope) { setScopeFor("save"); return; }
    if (scope && occurrence !== null) {
      const edited = scope === "THIS" ? { ...item, startDay: item.startDay !== original.startDay ? item.startDay : occurrence } : item;
      saveSeriesEdit(scope, original, occurrence, edited, { reminders, tags: tagList() });
    } else saveItem(item, { reminders, tags: tagList() });
    if (isNewPlaceholder) onClose(); else setEditing(false);
  };
  if (saveRef) saveRef.current = () => save();

  const deleteDialog = confirmDelete && (
    <div className="panel-backdrop" style={{ justifyContent: "center", alignItems: "center" }} onClick={() => setConfirmDelete(false)}>
      <div className="card" style={{ padding: 20, width: 340, display: "flex", flexDirection: "column", gap: 8 }} onClick={(e) => e.stopPropagation()}>
        <b style={{ fontSize: 16 }}>Delete</b>
        {isRecurring(original) && occurrence !== null && (
          <button className="btn" onClick={() => { deleteOccurrence(original, occurrence); onClose(); }}>Only {formatDate(occurrence)}</button>
        )}
        <button className="btn danger" onClick={() => { trash(original.id); onClose(); }}>{isRecurring(original) ? "Whole series (to trash)" : "Move to trash"}</button>
        <button className="btn" style={{ border: 0 }} onClick={() => setConfirmDelete(false)}>Cancel</button>
      </div>
    </div>
  );

  const st = original.type === "TASK" && isRecurring(original) ? streak(original, s.done, todayEpoch()) : null;
  const hasLinks = s.links.some((l) => (l.sourceId === id && s.byId.has(l.targetId)) || (l.targetId === id && s.byId.has(l.sourceId)));

  if (!editing) {
    const o = original;
    const oEvent = o.type === "EVENT";
    const color = s.colorOf(o);
    const oCategory = o.categoryId !== null ? s.categoryById.get(o.categoryId) : undefined;
    const t = todayEpoch();
    // The occurrence opened (from Today or the calendar), else the one the task list would tick.
    const day = occurrence ?? (oEvent ? o.startDay : currentEntry(o, s.done, t).day);
    const completion = o.startDay === null ? NO_DAY : isRecurring(o) ? (day ?? o.startDay) : o.startDay;
    const done = s.done.isDone(o.id, completion);
    const forDay = isRecurring(o) && day !== null ? ` for ${day === t ? "today" : day === t + 1 ? "tomorrow" : day === t - 1 ? "yesterday" : formatDate(day)}` : "";
    const oReminders = [...(s.reminders.get(o.id) ?? [])].sort((a, b) => b.offsetMin - a.offsetMin);
    const oTags = s.tagsByItem.get(o.id) ?? [];
    const hasNotes = preview(o.content, 10).trim() !== "";
    return (
      <div className="panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="panel">
          <header>
            <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" /></button>
            <b className="grow">{oEvent ? "Event" : "Task"}</b>
            <button className="icon-btn" title="Duplicate" onClick={() => {
              const copyId = saveItem({ ...o, id: 0, deletedAt: null }, {
                reminders: (s.reminders.get(o.id) ?? []).map((r) => ({ ...r, id: 0 })),
                tags: (s.tagsByItem.get(o.id) ?? []).map((t) => t.name),
              });
              go(`item/${copyId}`);
            }}><Icon name="copy" /></button>
            <button className="icon-btn" title="Delete" onClick={() => setConfirmDelete(true)}><Icon name="trash" /></button>
            <button className="btn primary" onClick={startEdit}><Icon name="edit" size={16} /> Edit</button>
          </header>
          <div className="body">
            <div style={{ borderLeft: `4px solid ${color}`, paddingLeft: 12, margin: "14px 0 8px" }}>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{o.title || "Untitled"}</div>
              {oCategory && <div style={{ color, fontSize: 13 }}>{oCategory.name}</div>}
            </div>
            {!oEvent && (
              <label className="row" style={{ padding: "6px 0", fontSize: 15, cursor: "pointer" }}>
                <input type="checkbox" checked={done} style={{ width: 18, height: 18, accentColor: color }}
                  onChange={(e) => toggleCompletion(o.id, completion, e.target.checked)} />
                <span style={{ color: done ? color : undefined }}>{done ? "Done" : "Mark done"}{forDay}</span>
              </label>
            )}
            <Info icon={<Icon name="schedule" size={16} />}>{whenText(o, day)}</Info>
            {(o.location ?? "").trim() && (
              <Info icon={<Icon name="place" size={16} />}>
                <a href={mapsUrl(o)} target="_blank" rel="noreferrer">{o.location}</a>
                <div className="row" style={{ marginTop: 4 }}>
                  <a className="btn small" href={directionsUrl(o, "google")} target="_blank" rel="noreferrer">Directions in Google Maps</a>
                  <a className="btn small" href={directionsUrl(o, "waze")} target="_blank" rel="noreferrer">Waze</a>
                </div>
              </Info>
            )}
            {isRecurring(o) && <Info icon={<Icon name="repeat" size={16} color={color} />}>{describe(o)}{isRoutineItem(o) && <span className="hint"> · Routine</span>}</Info>}
            {!oEvent && o.priority > 0 && <Info icon={<Icon name="flag" size={16} color={PRIORITY_COLORS_MUTED[o.priority]} />}>{PRIORITIES[o.priority]} priority</Info>}
            {!oEvent && o.startDay !== null && o.overduePolicy !== "SHOW_OVERDUE" && (
              <Info icon={<Icon name="update" size={16} />}>{o.overduePolicy === "CARRY_OVER" ? "If missed, it carries over to the next day" : "If missed, it's skipped"}</Info>
            )}
            {oReminders.length > 0 && (
              <Info icon={<Icon name="bell" size={16} />}>{oReminders.map((r, i) => <div key={i}>{r.type === "ALARM" ? "Alarm" : r.type === "REMINDER" ? "Reminder" : "Notification (silent)"} · {offsetText(r.offsetMin).toLowerCase()}</div>)}</Info>
            )}
            {oTags.length > 0 && <Info icon={<Icon name="label" size={16} />}>{oTags.map((x) => `#${x.name}`).join("  ")}</Info>}
            {hasNotes && <Info icon={<Icon name="subject" size={16} />}><div className="view-notes rich" dangerouslySetInnerHTML={{ __html: sanitize(o.content) }} /></Info>}
            {st && (
              <div className="field">
                <label>History</label>
                <div className="row hint" style={{ gap: 16 }}><span>🔥 {st.current} current</span><span>Best {st.best}</span><span>{Math.round(st.rate30 * 100)}% recent</span><span>{st.total} total</span></div>
                <Heatmap item={o} done={s.done.days(o.id)} />
              </div>
            )}
            {hasLinks && <LinksSection id={id} s={s} ensureSaved={() => id} />}
          </div>
        </div>
        {deleteDialog}
      </div>
    );
  }

  const mask = d.weekDays || (d.startDay !== null ? dayBit(weekday(d.startDay)) : 0);
  const monthDays = new Set(parseIntList(d.monthDays).length ? parseIntList(d.monthDays) : d.startDay !== null ? [ymd(d.startDay).d] : []);
  const monthMask = d.months || (d.startDay !== null ? 1 << (ymd(d.startDay).m - 1) : 0);
  const upcoming = d.freq !== "NONE" ? occurrences(d, todayEpoch(), todayEpoch() + 400).slice(0, 4) : [];

  const showRepeat = d.freq !== "NONE" || added.has("repeat");
  // Alerts follow the kind: reminders for events, silent notifications for tasks (the alarm button makes one ring).
  const kindAlert = (type: Item["type"]): AlertType => (type === "EVENT" ? "REMINDER" : "NOTIFICATION");
  const newAlert = () => setReminders([...reminders, { id: 0, itemId: id, offsetMin: defaultOffset(d), type: kindAlert(d.type), soundUri: null }]);
  const untimed = d.allDay || d.startMin === null;

  const form = (
      <div className={`panel ${embedded ? "embedded" : ""}`}>
        <header>
          <button className="icon-btn" onClick={cancel} title={isNewPlaceholder ? "Close without saving" : "Back without saving"}><Icon name={isNewPlaceholder ? "close" : "left"} /></button>
          <b className="grow">{isNewPlaceholder ? `New ${isEvent ? "event" : "task"}` : `Edit ${isEvent ? "event" : "task"}`}</b>
          {!isNewPlaceholder && <button className="icon-btn" title="Delete" onClick={() => setConfirmDelete(true)}><Icon name="trash" /></button>}
          <button className="btn primary" disabled={!d.title.trim()} onClick={() => save()}>Save</button>
        </header>
        {/* Laid out like Google Calendar's editor: one row per field, each with its icon, all visible. */}
        <div className="body gform">
          {isNewPlaceholder && (
            <div className="frow"><span />
              <div className="row">
                {(["EVENT", "TASK"] as const).map((t) => (
                  <button key={t} className={`chip ${d.type === t ? "on" : ""}`} onClick={() => {
                    set(t === "EVENT"
                      ? { type: t, startDay: d.startDay ?? todayEpoch(), endDay: d.startDay ?? todayEpoch(), allDay: d.startMin === null, endMin: d.startMin !== null ? Math.min(d.startMin + 60, 1439) : null }
                      : { type: t });
                    setReminders(reminders.map((r) => (r.type === "ALARM" ? r : { ...r, type: kindAlert(t) })));
                  }}>{t === "TASK" ? "Task" : "Event"}</button>
                ))}
              </div>
            </div>
          )}
          <div className="frow"><span className="swatch" style={{ background: d.color !== null ? cssColor(d.color) : category ? cssColor(category.color) : s.colorOf(d) }} />
            <input className="title-input" autoFocus={!embedded} placeholder="Add title" value={d.title} onChange={(e) => set({ title: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && d.title.trim()) save(); }} />
          </div>
          <hr />

          {isEvent ? <>
            <div className="frow"><Icon name="schedule" size={20} /><label className="row grow">All-day <span className="grow" /><input type="checkbox" checked={d.allDay} onChange={(e) => set({ allDay: e.target.checked, startMin: e.target.checked ? null : d.startMin ?? 540, endMin: e.target.checked ? null : d.endMin ?? 600 })} /></label></div>
            <div className="frow"><span />
              <div className="row"><input type="date" className="input" value={toInput(d.startDay)} onChange={(e) => { const v = fromInput(e.target.value); if (v !== null) set({ startDay: v, endDay: v + ((d.endDay ?? d.startDay ?? v) - (d.startDay ?? v)) }); }} />
                {!d.allDay && <input type="time" className="input" value={timeInput(d.startMin)} onChange={(e) => { const v = fromTime(e.target.value); const dur = d.startMin !== null && d.endMin !== null ? d.endMin - d.startMin : 60; set({ startMin: v, endMin: v !== null ? Math.min(v + Math.max(15, dur), 1439) : null }); }} />}
                <span className="hint">to</span>
                <input type="date" className="input" value={toInput(d.endDay ?? d.startDay)} onChange={(e) => { const v = fromInput(e.target.value); if (v !== null) set({ endDay: Math.max(v, d.startDay ?? v) }); }} />
                {!d.allDay && <input type="time" className="input" value={timeInput(d.endMin)} onChange={(e) => set({ endMin: fromTime(e.target.value) })} />}
              </div>
            </div>
          </> : (
            <div className="frow"><Icon name="schedule" size={20} />
              <div className="row">
                <input type="date" className="input" value={toInput(d.startDay)} onChange={(e) => set({ startDay: fromInput(e.target.value) })} />
                {d.startDay !== null && <input type="time" className="input" value={timeInput(d.startMin)} onChange={(e) => set({ startMin: fromTime(e.target.value) })} />}
                {d.startDay !== null && <button className="btn small" onClick={() => set({ startDay: null, startMin: null, freq: "NONE" })}>No date</button>}
              </div>
            </div>
          )}

          <div className="frow"><Icon name="repeat" size={20} />
            <div className="grow">
              {/* "Does not repeat" stays one line until clicked. */}
              <div style={{ cursor: showRepeat ? undefined : "pointer", padding: "4px 0" }} onClick={() => { if (!showRepeat) add("repeat"); }}>{describe(d)}</div>
              {showRepeat && <div className="seg">
                {(["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as Freq[]).map((f) => (
                  <button key={f} className={d.freq === f ? "on" : ""} onClick={() => set({ freq: f, startDay: f === "NONE" ? d.startDay : d.startDay ?? todayEpoch(), weekDays: 0, monthDays: "", months: 0, interval: 1 })}>
                    {f === "NONE" ? "Once" : f[0] + f.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>}
              {d.freq !== "NONE" && <>
                <div className="row">Every <input type="number" min={1} max={99} className="input" style={{ width: 64 }} value={d.interval} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} />
                  {({ DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" } as Record<string, string>)[d.freq]}{d.interval > 1 ? "s" : ""}</div>
                {d.freq === "WEEKLY" && <div className="daydots">
                  {[1, 2, 3, 4, 5, 6, 7].map((w) => <button key={w} title={["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][w - 1]} className={hasWeekDay(mask, w) ? "on" : ""} onClick={() => { const n = mask ^ dayBit(w); if (n) set({ weekDays: n }); }}>{"MTWTFSS"[w - 1]}</button>)}
                  <button className="chip" style={{ width: "auto" }} onClick={() => set({ weekDays: 0b0011111 })}>Weekdays</button>
                  <button className="chip" style={{ width: "auto" }} onClick={() => set({ weekDays: 0b1100000 })}>Weekends</button>
                </div>}
                {d.freq === "YEARLY" && <div className="daydots">
                  {"JFMAMJJASOND".split("").map((l, i) => <button key={i} className={hasMonth(monthMask, i + 1) ? "on" : ""} onClick={() => { const n = monthMask ^ (1 << i); if (n) set({ months: n }); }} title={String(i + 1)}>{l}</button>)}
                </div>}
                {(d.freq === "MONTHLY" || d.freq === "YEARLY") && <div className="daydots">
                  {[...Array.from({ length: 31 }, (_, i) => i + 1), LAST_DAY_OF_MONTH].map((md) => (
                    <button key={md} className={monthDays.has(md) ? "on" : ""} style={md === LAST_DAY_OF_MONTH ? { width: 48, borderRadius: 16 } : undefined}
                      onClick={() => { const n = new Set(monthDays); if (n.has(md)) n.delete(md); else n.add(md); if (n.size) set({ monthDays: [...n].sort((a, b) => a - b).join(",") }); }}>
                      {md === LAST_DAY_OF_MONTH ? "Last" : md}
                    </button>
                  ))}
                </div>}
                <div className="row">Ends <input type="date" className="input" value={toInput(d.untilDay)} onChange={(e) => set({ untilDay: fromInput(e.target.value) })} />
                  {d.untilDay !== null && <button className="btn small" onClick={() => set({ untilDay: null })}>Never</button>}</div>
                {upcoming.length > 0 && <div className="hint">Next: {upcoming.map(formatDate).join(", ")}</div>}
                {!isEvent && (
                  <label className="row routine-switch" title="Routines get their own checklist on Today; a missed day ends the streak instead of piling up as overdue.">
                    <input type="checkbox" checked={d.routine === true} onChange={(e) => set({ routine: e.target.checked })} />
                    <span>Routine <span className="hint">— its own checklist on Today, with a streak</span></span>
                  </label>
                )}
              </>}
            </div>
          </div>
          <hr />

          <div className="frow"><Icon name="place" size={20} />
            {/* A typed place has no coordinates; only "my location" sets them. */}
            <input className="plain grow" placeholder="Add location" value={d.location ?? ""} onChange={(e) => { set({ location: e.target.value, lat: null, lng: null }); setPlaceQuery(e.target.value); }} />
            <button className="icon-btn" title="Use this computer's location" onClick={locate}><Icon name="myLocation" size={18} /></button>
            {(d.location ?? "").trim() && <a className="icon-btn" title="Directions in Google Maps" href={directionsUrl(d, "google")} target="_blank" rel="noreferrer"><Icon name="directions" size={18} /></a>}
          </div>
          {/* Addresses matching what's typed (OpenStreetMap search); picking one fills in its coordinates. */}
          {suggestions.map((p) => (
            <div key={p.name} className="frow clickable suggestion" onClick={() => { set({ location: p.name, lat: p.lat, lng: p.lng }); setSuggestions([]); setPlaceQuery(null); }}>
              <span /><Icon name="place" size={16} /><span className="grow">{p.name}</span>
            </div>
          ))}
          <hr />

          {/* Alerts: a plain list of "15 minutes before" lines, like Google Calendar's notifications. */}
          {reminders.map((r, i) => (
            <div key={i} className="frow">{i === 0 ? <Icon name="bell" size={20} /> : <span />}
              <select className="plain grow" value={r.offsetMin} onChange={(e) => setReminders(reminders.map((x, j) => j === i ? { ...x, offsetMin: Number(e.target.value) } : x))}>
                {OFFSETS.map((o) => <option key={o} value={o}>{offsetText(o)}{untimed ? "" : ""}</option>)}
              </select>
              <button className={`icon-btn ${r.type === "ALARM" ? "on" : ""}`} title={r.type === "ALARM" ? "Rings as an alarm on the phone (click for a notification)" : "Ring as an alarm on the phone"}
                onClick={() => setReminders(reminders.map((x, j) => j === i ? { ...x, type: x.type === "ALARM" ? kindAlert(d.type) : "ALARM" } : x))}><Icon name="alarm" size={18} /></button>
              <button className="icon-btn" title="Remove" onClick={() => setReminders(reminders.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            </div>
          ))}
          <div className="frow clickable" onClick={newAlert}>{reminders.length === 0 ? <Icon name="bell" size={20} /> : <span />}
            <span className="hint" style={{ fontSize: 14 }}>{isEvent ? "Add notification" : "Add notification (silent)"}</span>
          </div>
          <hr />

          <div className="frow"><Icon name="palette" size={20} />
            <select className="plain" value={d.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No category</option>
              {s.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="grow" />
            <label className="row hint" title="Own colour (overrides the category)">
              Colour <input type="color" value={d.color !== null ? cssColor(d.color) : category ? cssColor(category.color) : "#1a73e8"} onChange={(e) => set({ color: argbOf(e.target.value) })} />
            </label>
            {d.color !== null && <button className="btn small" onClick={() => set({ color: null })}>Use category colour</button>}
          </div>
          {!isEvent && <>
            <div className="frow"><Icon name="flag" size={20} />
              <select className="plain" value={d.priority} onChange={(e) => set({ priority: Number(e.target.value) })}>
                {PRIORITIES.map((p, i) => <option key={p} value={i}>{i ? `${p} priority` : "No priority"}</option>)}
              </select>
            </div>
            {d.startDay !== null && (
              <div className="frow"><Icon name="update" size={20} />
                <select className="plain" value={d.overduePolicy} onChange={(e) => set({ overduePolicy: e.target.value as OverduePolicy })}>
                  <option value="SHOW_OVERDUE">If missed: stays overdue</option>
                  <option value="CARRY_OVER">If missed: moves to the next day</option>
                  <option value="SKIP">If missed: skip it</option>
                </select>
              </div>
            )}
          </>}
          <hr />

          {/* Notes: always there, a plain box until you click into it; then the formatting buttons appear. */}
          <div className="frow top"><Icon name="subject" size={20} />
            <div className="grow notes-box">
              <RichEditor ref={rich} initialHtml={initialHtml} onChange={() => {}} minHeight={24} compact toolbarOnFocus placeholder="Add description" />
            </div>
          </div>
          <hr />

          <div className="frow"><Icon name="label" size={20} />
            <input className="plain grow" placeholder="Add tags (space separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <hr />

          {!draft && <LinksSection id={id} s={s} ensureSaved={() => id} />}
        </div>
      </div>
  );
  if (embedded) return <>{form}{deleteDialog}</>;
  return (
    <div className="panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      {form}
      {scopeFor && <ScopeDialog title="Save changes to" onCancel={() => setScopeFor(null)} onPick={(sc) => { setScopeFor(null); save(sc); }} />}
      {deleteDialog}
    </div>
  );
}


/** "Thu, 15 Oct · 15:00–16:00", "All day, 3 Aug – 10 Aug", "Due Fri, 16 Oct at 09:00"... */
function whenText(item: Item, day: number | null): string {
  const start = day ?? item.startDay;
  if (start === null) return "No date";
  if (item.type !== "EVENT") return `Due ${formatDate(start)}${item.startMin !== null ? ` at ${formatTime(item.startMin)}` : ""}`;
  const span = Math.max(0, (item.endDay ?? item.startDay ?? 0) - (item.startDay ?? 0));
  const end = start + span;
  const time = (m: number | null) => (m !== null ? formatTime(m) : "");
  if (item.allDay) return span ? `All day, ${formatDate(start)} – ${formatDate(end)}` : `${formatDate(start)} · all day`;
  return span ? `${formatDate(start)} ${time(item.startMin)} – ${formatDate(end)} ${time(item.endMin)}` : `${formatDate(start)} · ${time(item.startMin)}–${time(item.endMin)}`;
}

/** Directions to the place in Google Maps or Waze. */
const directionsUrl = (i: Item, app: "google" | "waze") => {
  const hasPoint = i.lat !== null && i.lng !== null;
  if (app === "waze") return hasPoint ? `https://waze.com/ul?ll=${i.lat},${i.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent((i.location ?? "").trim())}&navigate=yes`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(hasPoint ? `${i.lat},${i.lng}` : (i.location ?? "").trim())}`;
};

/** Address suggestions from OpenStreetMap's search (Nominatim), at most 5 (see phone/device.ts). */
const searchPlaces = (q: string) => searchNominatim(q, 5);

const mapsUrl = (i: Item) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(i.lat !== null && i.lng !== null ? `${i.lat},${i.lng}` : (i.location ?? "").trim())}`;

function Info({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="info-row"><span className="ico">{icon}</span><div className="grow">{children}</div></div>;
}

function Heatmap({ item, done }: { item: Item; done: Set<number> }) {
  const t = todayEpoch();
  const start = t - 7 * 15 - (weekday(t) - 1);
  return (
    <div className="heat">
      {Array.from({ length: 16 * 7 }, (_, i) => {
        const day = start + i;
        const bg = day > t ? "transparent" : done.has(day) ? "var(--acc)" : occursOn(item, day) ? "color-mix(in srgb, var(--danger) 35%, transparent)" : undefined;
        return <span key={i} title={formatDate(day)} style={{ background: bg }} />;
      })}
    </div>
  );
}
