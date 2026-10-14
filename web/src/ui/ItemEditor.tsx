// Side panel for creating and editing tasks and events (same fields as the phone's editor).
import { useEffect, useRef, useState } from "react";
import { epochOf, formatDate, offsetLabel, today as todayEpoch, weekday, ymd } from "../domain/dates.ts";
import { LAST_DAY_OF_MONTH, dayBit, describe, hasMonth, hasWeekDay, occurrences, occursOn, parseIntList } from "../domain/recurrence.ts";
import { streak } from "../domain/schedule.ts";
import {
  type AlertType, type Freq, type Item, type OverduePolicy, type Reminder,
  PRIORITIES, PRIORITY_COLORS, argbOf, cssColor, isRecurring,
} from "../domain/types.ts";
import { type EditScope, deleteForever, deleteOccurrence, saveItem, saveSeriesEdit, trash, useSnapshot } from "../store/store.ts";
import { Icon } from "./common.tsx";
import { LinksSection } from "./LinksSection.tsx";
import { RichEditor, type RichEditorHandle } from "./RichEditor.tsx";

const OFFSETS = [0, 5, 10, 15, 30, 60, 120, 180, 1440, 2880, 10080];
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

export function ItemEditor({ id, occurrence, isNewPlaceholder, onClose }: { id: number; occurrence: number | null; isNewPlaceholder: boolean; onClose: () => void }) {
  const s = useSnapshot();
  const original = s.byId.get(id) ?? null;
  const [d, setD] = useState<Item | null>(original);
  const [reminders, setReminders] = useState<Reminder[]>(() => (s.reminders.get(id) ?? []).map((r) => ({ ...r })));
  const [tags, setTags] = useState(() => (s.tagsByItem.get(id) ?? []).map((t) => t.name).join(" "));
  const [scopeFor, setScopeFor] = useState<"save" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rich = useRef<RichEditorHandle>(null);
  const [initialHtml] = useState(original?.content ?? "");

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

  const finalItem = (): Item => {
    let it: Item = { ...d, title: d.title.trim(), content: rich.current?.html() ?? d.content };
    if (it.type === "EVENT") {
      const sd = it.startDay ?? todayEpoch();
      const ed = Math.max(it.endDay ?? sd, sd);
      let em = it.endMin;
      if (!it.allDay && ed === sd && it.startMin !== null && (em === null || em <= it.startMin)) em = Math.min(it.startMin + 30, 1439);
      it = { ...it, startDay: sd, endDay: ed, endMin: em };
    } else it = { ...it, endDay: null, endMin: null, allDay: false };
    if (it.freq !== "NONE" && it.startDay === null) it.startDay = todayEpoch();
    return it;
  };

  function cancel() {
    if (isNewPlaceholder) deleteForever(id);
    onClose();
  }

  const save = (scope?: EditScope) => {
    const item = finalItem();
    if (isRecurring(original) && occurrence !== null && !isNewPlaceholder && !scope) { setScopeFor("save"); return; }
    if (scope && occurrence !== null) {
      const edited = scope === "THIS" ? { ...item, startDay: item.startDay !== original.startDay ? item.startDay : occurrence } : item;
      saveSeriesEdit(scope, original, occurrence, edited, { reminders, tags: tagList() });
    } else saveItem(item, { reminders, tags: tagList() });
    onClose();
  };

  const st = !isEvent && isRecurring(original) ? streak(original, s.done, todayEpoch()) : null;
  const mask = d.weekDays || (d.startDay !== null ? dayBit(weekday(d.startDay)) : 0);
  const monthDays = new Set(parseIntList(d.monthDays).length ? parseIntList(d.monthDays) : d.startDay !== null ? [ymd(d.startDay).d] : []);
  const monthMask = d.months || (d.startDay !== null ? 1 << (ymd(d.startDay).m - 1) : 0);
  const upcoming = d.freq !== "NONE" ? occurrences(d, todayEpoch(), todayEpoch() + 400).slice(0, 4) : [];

  return (
    <div className="panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="panel">
        <header>
          <button className="icon-btn" onClick={cancel} title="Close without saving"><Icon name="close" /></button>
          <b className="grow">{isNewPlaceholder ? `New ${isEvent ? "event" : "task"}` : isEvent ? "Event" : "Task"}</b>
          {!isNewPlaceholder && <button className="icon-btn" title="Delete" onClick={() => setConfirmDelete(true)}><Icon name="trash" /></button>}
          <button className="btn primary" disabled={!d.title.trim()} onClick={() => save()}>Save</button>
        </header>
        <div className="body">
          {isNewPlaceholder && (
            <div className="seg" style={{ marginTop: 12 }}>
              {(["TASK", "EVENT"] as const).map((t) => (
                <button key={t} className={d.type === t ? "on" : ""} onClick={() => set(t === "EVENT"
                  ? { type: t, startDay: d.startDay ?? todayEpoch(), endDay: d.startDay ?? todayEpoch(), allDay: d.startMin === null, endMin: d.startMin !== null ? Math.min(d.startMin + 60, 1439) : null }
                  : { type: t })}>{t === "TASK" ? "Task" : "Event"}</button>
              ))}
            </div>
          )}
          <input className="title-input" autoFocus placeholder="Title" value={d.title} onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && d.title.trim()) save(); }} />

          <div className="row" style={{ flexWrap: "wrap" }}>
            <select className="input" value={d.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No category</option>
              {s.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="row hint" title="Own colour (overrides the category)">
              Colour <input type="color" value={d.color !== null ? cssColor(d.color) : category ? cssColor(category.color) : "#26a69a"} onChange={(e) => set({ color: argbOf(e.target.value) })} />
            </label>
            {d.color !== null && <button className="btn small" onClick={() => set({ color: null })}>Use category colour</button>}
          </div>

          <div className="field">
            <label>When</label>
            {isEvent ? <>
              <label className="row"><input type="checkbox" checked={d.allDay} onChange={(e) => set({ allDay: e.target.checked, startMin: e.target.checked ? null : d.startMin ?? 540, endMin: e.target.checked ? null : d.endMin ?? 600 })} /> All day</label>
              <div className="row">Starts <input type="date" className="input" value={toInput(d.startDay)} onChange={(e) => { const v = fromInput(e.target.value); if (v !== null) set({ startDay: v, endDay: v + ((d.endDay ?? d.startDay ?? v) - (d.startDay ?? v)) }); }} />
                {!d.allDay && <input type="time" className="input" value={timeInput(d.startMin)} onChange={(e) => { const v = fromTime(e.target.value); const dur = d.startMin !== null && d.endMin !== null ? d.endMin - d.startMin : 60; set({ startMin: v, endMin: v !== null ? Math.min(v + Math.max(15, dur), 1439) : null }); }} />}</div>
              <div className="row">Ends&nbsp; <input type="date" className="input" value={toInput(d.endDay ?? d.startDay)} onChange={(e) => { const v = fromInput(e.target.value); if (v !== null) set({ endDay: Math.max(v, d.startDay ?? v) }); }} />
                {!d.allDay && <input type="time" className="input" value={timeInput(d.endMin)} onChange={(e) => set({ endMin: fromTime(e.target.value) })} />}</div>
            </> : (
              <div className="row">
                <input type="date" className="input" value={toInput(d.startDay)} onChange={(e) => set({ startDay: fromInput(e.target.value) })} />
                {d.startDay !== null && <input type="time" className="input" value={timeInput(d.startMin)} onChange={(e) => set({ startMin: fromTime(e.target.value) })} />}
                {d.startDay !== null && <button className="btn small" onClick={() => set({ startDay: null, startMin: null, freq: "NONE" })}>No date</button>}
              </div>
            )}
          </div>

          <div className="field">
            <label>Repeat — {describe(d)}</label>
            <div className="seg">
              {(["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as Freq[]).map((f) => (
                <button key={f} className={d.freq === f ? "on" : ""} onClick={() => set({ freq: f, startDay: f === "NONE" ? d.startDay : d.startDay ?? todayEpoch(), weekDays: 0, monthDays: "", months: 0, interval: 1 })}>
                  {f === "NONE" ? "Once" : f[0] + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
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
            </>}
          </div>

          {!isEvent && <>
            <div className="field">
              <label>Priority</label>
              <div className="seg">
                {PRIORITIES.map((p, i) => <button key={p} className={d.priority === i ? "on" : ""} style={{ color: i && d.priority === i ? PRIORITY_COLORS[i] : undefined }} onClick={() => set({ priority: i })}>{i ? "⚑ " : ""}{p}</button>)}
              </div>
            </div>
            <div className="field">
              <label>If missed</label>
              {([["SHOW_OVERDUE", "Show as overdue until done (default)"], ["CARRY_OVER", "Carry over to the next day automatically"], ["SKIP", "Skip it silently (counts as missed)"]] as [OverduePolicy, string][]).map(([p, l]) => (
                <label key={p} className="row"><input type="radio" checked={d.overduePolicy === p} onChange={() => set({ overduePolicy: p })} /> {l}</label>
              ))}
            </div>
          </>}

          <div className="field">
            <label>Reminders <span style={{ textTransform: "none", fontWeight: 400 }}>(they ring on the phone)</span></label>
            <div className="row">
              {([["REMINDER", "🔔 Reminder"], ["ALARM", "⏰ Alarm"], ["NOTIFICATION", "🔕 Silent"]] as [AlertType, string][]).map(([t, l]) => (
                <button key={t} className="btn small" onClick={() => setReminders([...reminders, { id: 0, itemId: id, offsetMin: t === "REMINDER" && isEvent && !d.allDay ? 15 : 0, type: t, soundUri: null }])}>+ {l}</button>
              ))}
            </div>
            {reminders.length === 0 && <div className="hint">{d.startDay === null ? "Set a date to add reminders." : "No reminders."}</div>}
            {reminders.map((r, i) => (
              <div key={i} className="row">
                <select className="input" value={r.offsetMin} onChange={(e) => setReminders(reminders.map((x, j) => j === i ? { ...x, offsetMin: Number(e.target.value) } : x))}>
                  {OFFSETS.map((o) => <option key={o} value={o}>{offsetLabel(o)}</option>)}
                </select>
                <div className="seg">
                  {(["NOTIFICATION", "REMINDER", "ALARM"] as AlertType[]).map((t) => (
                    <button key={t} className={r.type === t ? "on" : ""} onClick={() => setReminders(reminders.map((x, j) => j === i ? { ...x, type: t } : x))}>
                      {t === "NOTIFICATION" ? "Silent" : t[0] + t.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                <button className="icon-btn" title="Remove" onClick={() => setReminders(reminders.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
              </div>
            ))}
          </div>

          <div className="field">
            <label>Tags</label>
            <input className="input" placeholder="tags, space separated" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>

          <div className="field">
            <label>Notes</label>
            <div className="card" style={{ overflow: "hidden" }}>
              <RichEditor ref={rich} initialHtml={initialHtml} onChange={() => {}} minHeight={120} compact />
            </div>
          </div>

          {st && (
            <div className="field">
              <label>History</label>
              <div className="row hint" style={{ gap: 16 }}><span>🔥 {st.current} current</span><span>Best {st.best}</span><span>{Math.round(st.rate30 * 100)}% recent</span><span>{st.total} total</span></div>
              <Heatmap item={original} done={s.done.days(original.id)} />
            </div>
          )}

          <LinksSection id={id} s={s} ensureSaved={() => id} />
        </div>
      </div>
      {scopeFor && <ScopeDialog title="Save changes to" onCancel={() => setScopeFor(null)} onPick={(sc) => { setScopeFor(null); save(sc); }} />}
      {confirmDelete && (
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
      )}
    </div>
  );
}

function Heatmap({ item, done }: { item: Item; done: Set<number> }) {
  const t = todayEpoch();
  const start = t - 7 * 15 - (weekday(t) - 1);
  return (
    <div className="heat">
      {Array.from({ length: 16 * 7 }, (_, i) => {
        const day = start + i;
        const bg = day > t ? "transparent" : done.has(day) ? "var(--accent)" : occursOn(item, day) ? "color-mix(in srgb, var(--danger) 35%, transparent)" : undefined;
        return <span key={i} title={formatDate(day)} style={{ background: bg }} />;
      })}
    </div>
  );
}
