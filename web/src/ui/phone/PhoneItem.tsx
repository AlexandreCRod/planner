// Tasks and events on the phone, after the native ItemViewScreen, ItemEditorScreen, FieldEditors and
// RecurrenceDetails. Opening one shows the view: only what it has, each field changed in place with a
// tap (a picker, a menu or a small sheet, saved at once), and an Edit button for the full editor. The
// full editor is the same one the add panel grows into.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatDate, formatTime, monthShort, offsetLabel, relativeDay, today as todayEpoch, weekday, ymd } from "../../domain/dates.ts";
import { LAST_DAY_OF_MONTH, dayBit, describe, hasMonth, hasWeekDay, occurrences, occursOn, parseIntList } from "../../domain/recurrence.ts";
import { currentEntry, streak } from "../../domain/schedule.ts";
import { preview } from "../../domain/text.ts";
import {
  type AlertType, type Freq, type Item, type ItemType, type OverduePolicy, type Reminder,
  NO_DAY, PRIORITIES, PRIORITY_COLORS, cssColor, isRecurring, newItem,
} from "../../domain/types.ts";
import {
  type EditScope, type Snapshot, addLink, deleteOccurrence, removeLink, restore, saveItem, saveSeriesEdit, snapshot, toggleCompletion, trash, useSnapshot,
} from "../../store/store.ts";
import { go, openItem } from "../common.tsx";
import { typeLabel } from "../LinksSection.tsx";
import { RichEditor, type RichEditorHandle, sanitize } from "../RichEditor.tsx";
import { Checkbox, Dialog, DropdownMenu, FilterChip, IconButton, MIcon, SectionHeader, Segmented, TopAppBar, type MenuItem } from "./chrome.tsx";
import { AssistChip, BottomSheet, ColorPickerDialog, ExtendedFab, SheetButtons, Switch, TextButton, TextFieldDialog, showSnackbar } from "./m3.tsx";
import { openExternal } from "./native.ts";
import { DatePickerDialog, TimePickerDialog } from "./pickers.tsx";
import { RichBar } from "./RichBar.tsx";

// ---------- Shared bits ----------

/** An unsaved item with its alerts and tags: what the editor (and the add panel it grows from) holds. */
export interface Draft { item: Item; reminders: Reminder[]; tags: string }

const OFFSETS = [0, 5, 10, 15, 30, 60, 120, 180, 1440, 2880, 10080];
const DAY_END = 24 * 60 - 1;

/** Notifications follow the kind of item: popping up for an event, silent for a task. */
export const defaultAlert = (type: ItemType): AlertType => (type === "EVENT" ? "REMINDER" : "NOTIFICATION");

/** A new item's first alert, as the native editor gives it. */
export function firstAlerts(item: Item): Reminder[] {
  if (item.startDay === null) return [];
  return [{ id: 0, itemId: 0, offsetMin: item.type === "EVENT" && item.startMin !== null ? 15 : 0, type: defaultAlert(item.type), soundUri: null }];
}

/** Event or task, the way the editor's chips switch it (EditorDraft.switchType). */
export function switchType(d: Draft, t: ItemType): Draft {
  const it = d.item;
  const item = t === "EVENT"
    ? { ...it, type: t, startDay: it.startDay ?? todayEpoch(), endDay: it.startDay ?? todayEpoch(), allDay: it.startMin === null, endMin: it.startMin !== null ? Math.min(it.startMin + 60, DAY_END) : null }
    : { ...it, type: t };
  return { ...d, item, reminders: d.reminders.map((r) => (r.type === "ALARM" ? r : { ...r, type: defaultAlert(t) })) };
}

/** "At the time", "15 minutes before", "1 day before"... */
export function offsetText(min: number): string {
  const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""} before`;
  if (min === 0) return "At the time";
  if (min % 10080 === 0) return plural(min / 10080, "week");
  if (min % 1440 === 0) return plural(min / 1440, "day");
  if (min % 60 === 0) return plural(min / 60, "hour");
  return `${min} minutes before`;
}

/** "Thu, 15 Oct · 3 PM – 4 PM", "All day, 3 Aug – 10 Aug", "Due Fri, 16 Oct at 9 AM"... */
export function whenText(item: Item, day: number | null): string {
  const start = day ?? item.startDay;
  if (start === null) return "No date";
  if (item.type !== "EVENT") return `Due ${formatDate(start)}${item.startMin !== null ? ` at ${formatTime(item.startMin)}` : ""}`;
  const span = Math.max(0, (item.endDay ?? item.startDay ?? 0) - (item.startDay ?? 0));
  const end = start + span;
  const t = (m: number | null) => (m !== null ? formatTime(m) : "");
  if (item.allDay) return span ? `All day, ${formatDate(start)} – ${formatDate(end)}` : `${formatDate(start)} · all day`;
  return span ? `${formatDate(start)} ${t(item.startMin)} – ${formatDate(end)} ${t(item.endMin)}` : `${formatDate(start)} · ${t(item.startMin)} – ${t(item.endMin)}`;
}

const overdueText = (p: OverduePolicy) => p === "SHOW_OVERDUE" ? "If missed: stays overdue" : p === "CARRY_OVER" ? "If missed: moves to the next day" : "If missed: skip it";

/** The place on a map (Google Maps, or whatever handles map links), and directions to it. Only a link is opened. */
const place = (i: Item) => (i.lat != null && i.lng != null ? `${i.lat},${i.lng}` : (i.location ?? "").trim());
export const mapUrl = (i: Item) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place(i))}`;
export const directionsUrl = (i: Item) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place(i))}`;

/** Moves an item to the trash at once; the snackbar can bring it back (vm.trashWithUndo). */
export function trashWithUndo(item: Item) {
  trash(item.id);
  showSnackbar(`“${item.title.trim() || "Untitled"}” moved to trash`, "Undo", () => restore(item.id));
}

/** Removes one day of a series at once; the snackbar can put it back. */
export function deleteOccurrenceWithUndo(item: Item, day: number) {
  deleteOccurrence(item, day);
  showSnackbar("Occurrence deleted", "Undo", () => {
    const cur = snapshot().byId.get(item.id);
    if (cur) saveItem({ ...cur, excludedDays: parseIntList(cur.excludedDays).filter((d) => d !== day).join(",") });
  });
}

/** One editor row: an icon in the left column (or a gap, to line up with the row above) and its content. */
function FieldRow({ icon, onClick, children, top }: { icon?: string | null; onClick?: () => void; children: ReactNode; top?: boolean }) {
  return (
    <div className={`pe-row ${top ? "top" : ""}`} role={onClick ? "button" : undefined} onClick={onClick}>
      <span className="pe-ico">{icon && <MIcon name={icon} />}</span>
      {children}
    </div>
  );
}

/** Tappable text in a row (a date, a time, a choice); placeholders are greyed. */
function FieldText({ children, onClick, placeholder, grow }: { children: ReactNode; onClick: () => void; placeholder?: boolean; grow?: boolean }) {
  return <button className={`pe-text ${placeholder ? "ph" : ""} ${grow ? "grow" : ""}`} onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>;
}

/** A row with a menu under its text. */
function MenuText({ text, items, placeholder }: { text: string; items: MenuItem[]; placeholder?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="p-menu-anchor start">
      <FieldText placeholder={placeholder} onClick={() => setOpen(true)}>{text}</FieldText>
      <DropdownMenu open={open} onClose={() => setOpen(false)} items={items} />
    </span>
  );
}

export function ScopeDialog({ title, onPick, onCancel }: { title: string; onPick: (s: EditScope) => void; onCancel: () => void }) {
  return (
    <Dialog title={title} onClose={onCancel} actions={<TextButton onClick={onCancel}>Cancel</TextButton>}>
      <div className="pe-scope">
        <TextButton onClick={() => onPick("THIS")}>This occurrence only</TextButton>
        <TextButton onClick={() => onPick("FOLLOWING")}>This and following</TextButton>
        <TextButton onClick={() => onPick("ALL")}>All occurrences</TextButton>
      </div>
    </Dialog>
  );
}

const priorityItems = (pick: (p: number) => void): MenuItem[] =>
  PRIORITIES.map((p, i) => ({ label: p, icon: "oFlag", iconColor: i ? PRIORITY_COLORS[i] : undefined, onClick: () => pick(i) }));
const overdueItems = (pick: (p: OverduePolicy) => void): MenuItem[] =>
  (["SHOW_OVERDUE", "CARRY_OVER", "SKIP"] as OverduePolicy[]).map((p) => ({ label: overdueText(p), onClick: () => pick(p) }));
const categoryItems = (s: Snapshot, pick: (id: number | null) => void, leave?: () => void): MenuItem[] => [
  { label: "No category", onClick: () => pick(null) },
  ...s.categories.map((c) => ({ label: c.name, dot: cssColor(c.color), onClick: () => pick(c.id) })),
  { label: "Edit categories…", icon: "oPalette", divider: true, onClick: () => { leave?.(); go("settings/categories"); } },
];

// ---------- When ----------

type Pick = { kind: "date" | "time"; which: "start" | "end" | "until" } | null;

/** The date (and time) rows of the editor and of the view's "when" sheet. */
function WhenFields({ d, set }: { d: Item; set: (patch: Partial<Item>) => void }) {
  const [pick, setPick] = useState<Pick>(null);
  const isEvent = d.type === "EVENT";
  const dateOf = (which: "start" | "end") => (which === "end" ? d.endDay ?? d.startDay : d.startDay);
  return <>
    {isEvent ? <>
      <FieldRow icon="oSchedule" onClick={() => set(allDayPatch(d, !d.allDay))}>
        <span className="pe-label grow">All-day</span>
        <Switch checked={d.allDay} onChange={(v) => set(allDayPatch(d, v))} label="All-day" />
      </FieldRow>
      <FieldRow>
        <FieldText grow onClick={() => setPick({ kind: "date", which: "start" })}>{d.startDay !== null ? formatDate(d.startDay) : "Pick date"}</FieldText>
        {!d.allDay && <FieldText onClick={() => setPick({ kind: "time", which: "start" })}>{d.startMin !== null ? formatTime(d.startMin) : "Time"}</FieldText>}
      </FieldRow>
      <FieldRow>
        <FieldText grow onClick={() => setPick({ kind: "date", which: "end" })}>{dateOf("end") !== null ? formatDate(dateOf("end")!) : "Pick date"}</FieldText>
        {!d.allDay && <FieldText onClick={() => setPick({ kind: "time", which: "end" })}>{d.endMin !== null ? formatTime(d.endMin) : "Time"}</FieldText>}
      </FieldRow>
    </> : (
      <FieldRow icon="oSchedule">
        <FieldText grow placeholder={d.startDay === null} onClick={() => setPick({ kind: "date", which: "start" })}>{d.startDay !== null ? formatDate(d.startDay) : "Add date"}</FieldText>
        {d.startDay !== null && <>
          <FieldText placeholder={d.startMin === null} onClick={() => setPick({ kind: "time", which: "start" })}>{d.startMin !== null ? formatTime(d.startMin) : "Add time"}</FieldText>
          <IconButton icon="fClose" label="Clear date" onClick={() => set({ startDay: null, startMin: null, freq: "NONE" })} />
        </>}
      </FieldRow>
    )}
    {pick?.kind === "date" && (
      <DatePickerDialog value={dateOf(pick.which === "end" ? "end" : "start")} onClose={() => setPick(null)} onPick={(e) => {
        if (pick.which === "end") set({ endDay: Math.max(e, d.startDay ?? e) });
        else {
          const span = (d.endDay ?? d.startDay ?? e) - (d.startDay ?? e);
          set({ startDay: e, endDay: isEvent ? e + span : null });
        }
      }} />
    )}
    {pick?.kind === "time" && (
      <TimePickerDialog value={(pick.which === "end" ? d.endMin : d.startMin) ?? 9 * 60} onClose={() => setPick(null)} onPick={(m) => {
        if (pick.which === "end") set({ endMin: m });
        else {
          const dur = d.startMin !== null && d.endMin !== null ? d.endMin - d.startMin : 60;
          set({ startMin: m, endMin: isEvent ? Math.min(m + Math.max(15, dur), DAY_END) : d.endMin });
        }
      }} />
    )}
  </>;
}

const allDayPatch = (d: Item, v: boolean): Partial<Item> => ({ allDay: v, startMin: v ? null : d.startMin ?? 540, endMin: v ? null : d.endMin ?? 600 });

/** An event's times put right before saving (as the native finalItem / WhenSheet do). */
function tidyWhen(it: Item): Item {
  if (it.type === "EVENT") {
    const sd = it.startDay ?? todayEpoch();
    const ed = Math.max(it.endDay ?? sd, sd);
    let em = it.endMin;
    if (!it.allDay && ed === sd && it.startMin !== null && (em === null || em <= it.startMin)) em = Math.min(it.startMin + 30, DAY_END);
    return { ...it, startDay: sd, endDay: ed, endMin: em };
  }
  return it;
}

// ---------- Repeat ----------

function RepeatEditor({ d, expanded, onExpand, onChange }: { d: Item; expanded: boolean; onExpand: () => void; onChange: (i: Item) => void }) {
  return <>
    <FieldRow icon="oRepeat" onClick={expanded ? undefined : onExpand}>
      <span className="pe-label">{describe(d)}</span>
    </FieldRow>
    {expanded && (
      <div className="pe-indent">
        <div className="pe-freq">
          <Segmented<Freq> value={d.freq} options={[["NONE", "Once"], ["DAILY", "Daily"], ["WEEKLY", "Weekly"], ["MONTHLY", "Monthly"], ["YEARLY", "Yearly"]]}
            onChange={(f) => onChange({ ...d, freq: f, startDay: f === "NONE" ? d.startDay : d.startDay ?? todayEpoch(), weekDays: 0, monthDays: "", months: 0, interval: 1 })} />
        </div>
        {d.freq !== "NONE" && <RecurrenceDetails d={d} onChange={onChange} />}
      </div>
    )}
  </>;
}

/** Interval, the days (weekdays, days of the month, months) and the end date. */
function RecurrenceDetails({ d, onChange }: { d: Item; onChange: (i: Item) => void }) {
  const [untilPick, setUntilPick] = useState(false);
  const start = d.startDay ?? todayEpoch();
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year", NONE: "" }[d.freq];
  const mask = d.weekDays || dayBit(weekday(start));
  const days = new Set(parseIntList(d.monthDays).length ? parseIntList(d.monthDays) : [ymd(start).d]);
  const mMask = d.months || 1 << (ymd(start).m - 1);
  const toggleDay = (md: number) => {
    const n = new Set(days);
    if (n.has(md)) n.delete(md); else n.add(md);
    if (n.size) onChange({ ...d, monthDays: [...n].sort((a, b) => a - b).join(",") });
  };
  const upcoming = occurrences(d, todayEpoch(), todayEpoch() + 400).slice(0, 4);
  return (
    <div className="pe-rec">
      <div className="pe-rec-row">
        <span>Every</span>
        <IconButton icon="fRemove" label="Less" onClick={() => onChange({ ...d, interval: Math.max(1, d.interval - 1) })} />
        <b>{d.interval}</b>
        <IconButton icon="fAdd" label="More" onClick={() => onChange({ ...d, interval: Math.min(99, d.interval + 1) })} />
        <span>{d.interval === 1 ? unit : `${unit}s`}</span>
      </div>
      {d.freq === "WEEKLY" && <>
        <div className="pe-rec-label">On these days</div>
        <div className="pe-circles">
          {[1, 2, 3, 4, 5, 6, 7].map((w) => (
            <button key={w} className={hasWeekDay(mask, w) ? "on" : ""} onClick={() => { const n = mask ^ dayBit(w); if (n) onChange({ ...d, weekDays: n }); }}>
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"][w - 1]}
            </button>
          ))}
        </div>
        <div className="pe-flow">
          <FilterChip selected={mask === 0b0011111} onClick={() => onChange({ ...d, weekDays: 0b0011111 })}>Weekdays</FilterChip>
          <FilterChip selected={mask === 0b1100000} onClick={() => onChange({ ...d, weekDays: 0b1100000 })}>Weekends</FilterChip>
          <FilterChip selected={mask === 0b1111111} onClick={() => onChange({ ...d, weekDays: 0b1111111 })}>Every day</FilterChip>
        </div>
      </>}
      {d.freq === "YEARLY" && <>
        <div className="pe-rec-label">In these months</div>
        <div className="pe-flow tight">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <FilterChip key={m} selected={hasMonth(mMask, m)} onClick={() => { const n = mMask ^ (1 << (m - 1)); if (n) onChange({ ...d, months: n }); }}>{monthShort(m)}</FilterChip>
          ))}
        </div>
      </>}
      {(d.freq === "MONTHLY" || d.freq === "YEARLY") && <>
        <div className="pe-rec-label">On these days of the month</div>
        <div className="pe-circles wrap">
          {Array.from({ length: 31 }, (_, i) => i + 1).map((md) => <button key={md} className={days.has(md) ? "on" : ""} onClick={() => toggleDay(md)}>{md}</button>)}
          <button className={`wide ${days.has(LAST_DAY_OF_MONTH) ? "on" : ""}`} onClick={() => toggleDay(LAST_DAY_OF_MONTH)}>Last</button>
        </div>
        {[...days].some((x) => x >= 29 && x <= 31) && <div className="pe-small">Months without that day are skipped. Use "Last" for the end of every month.</div>}
      </>}
      <div className="pe-rec-row">
        <span>Ends</span>
        <TextButton onClick={() => setUntilPick(true)}>{d.untilDay !== null ? formatDate(d.untilDay) : "Never"}</TextButton>
        {d.untilDay !== null && <TextButton onClick={() => onChange({ ...d, untilDay: null })}>Clear</TextButton>}
      </div>
      {upcoming.length > 0 && <div className="pe-small">Next: {upcoming.map(formatDate).join(", ")}</div>}
      {untilPick && <DatePickerDialog value={d.untilDay ?? start + 91} onClose={() => setUntilPick(false)} onPick={(e) => onChange({ ...d, untilDay: e })} />}
    </div>
  );
}

// ---------- Alerts ----------

/**
 * One of an item's two alert lists, alarms or notifications: "15 minutes before" lines (each with a
 * menu of offsets), the sound / pop-up toggle and remove, then an "Add" line. [onChange] gets the whole list.
 */
function AlertSection({ alarms, all, type, timed, onChange }: { alarms: boolean; all: Reminder[]; type: ItemType; timed: boolean; onChange: (r: Reminder[]) => void }) {
  const mine = all.map((r, i) => [r, i] as const).filter(([r]) => (r.type === "ALARM") === alarms);
  const icon = alarms ? "oAlarm" : "oNotifications";
  const set = (i: number, r: Reminder) => onChange(all.map((x, j) => (j === i ? r : x)));
  return <>
    {mine.map(([r, i], n) => (
      <FieldRow key={i} icon={n === 0 ? icon : null}>
        <span className="grow">
          <MenuText text={offsetText(r.offsetMin) + (timed ? "" : " (9 AM)")} items={OFFSETS.map((o) => ({ label: offsetText(o), checked: o === r.offsetMin, onClick: () => set(i, { ...r, offsetMin: o }) }))} />
        </span>
        {!alarms && (
          <IconButton icon={r.type === "REMINDER" ? "oNotificationsActive" : "oNotificationsNone"} className={r.type === "REMINDER" ? "primary" : ""}
            label={r.type === "REMINDER" ? "Pops up with a sound (tap for silent)" : "Silent (tap to pop up with a sound)"}
            onClick={() => set(i, { ...r, type: r.type === "REMINDER" ? "NOTIFICATION" : "REMINDER" })} />
        )}
        <IconButton icon="fClose" label="Remove" onClick={() => onChange(all.filter((_, j) => j !== i))} />
      </FieldRow>
    ))}
    <FieldRow icon={mine.length ? null : icon} onClick={() => onChange([...all, { id: 0, itemId: 0, offsetMin: type === "EVENT" && timed ? 15 : 0, type: alarms ? "ALARM" : defaultAlert(type), soundUri: null }])}>
      <span className="pe-label ph">{alarms ? "Add alarm" : "Add notification"}</span>
    </FieldRow>
  </>;
}

/** Said once under the alerts: they are kept with the item, and ring on the Android app. */
const ALERTS_HINT = "Alarms and notifications ring from the Planner Android app; this app keeps them with the item.";

// ---------- Location ----------

function LocationField({ d, set, autoFocus }: { d: Item; set: (patch: Partial<Item>) => void; autoFocus?: boolean }) {
  const loc = d.location ?? "";
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) { const t = window.setTimeout(() => ref.current?.focus(), 80); return () => clearTimeout(t); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <FieldRow icon="oLocationOn">
      {/* A typed place has no coordinates; ones that came with the item stay until the text changes. */}
      <input ref={ref} className="pe-input grow" placeholder="Add location" value={loc} enterKeyHint="done" autoCapitalize="words"
        onChange={(e) => set({ location: e.target.value, lat: null, lng: null })} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      {loc && <IconButton icon="fClose" label="Clear location" onClick={() => set({ location: "", lat: null, lng: null })} />}
      {loc.trim() && <IconButton icon="oDirections" label="Directions" onClick={() => openExternal(directionsUrl(d))} />}
    </FieldRow>
  );
}

// ---------- Links ----------

/** Linked items both ways, with Graph and Link (LinksSection.kt). */
export function PhoneLinks({ id, s, ensureSaved, onLeave }: { id: number; s: Snapshot; ensureSaved?: () => number; onLeave?: () => void }) {
  const [picking, setPicking] = useState(false);
  const rows: { item: Item; label: string; removable: boolean }[] = [];
  const seen = new Set<number>();
  for (const l of s.links) if (l.sourceId === id && s.byId.has(l.targetId)) { seen.add(l.targetId); rows.push({ item: s.byId.get(l.targetId)!, label: l.auto ? "Mentioned with [[ ]]" : "Linked", removable: !l.auto }); }
  for (const l of s.links) if (l.targetId === id && l.sourceId !== id && s.byId.has(l.sourceId) && !seen.has(l.sourceId)) rows.push({ item: s.byId.get(l.sourceId)!, label: l.auto ? "Mentions this" : "Links here", removable: !l.auto });
  const typeIcon = (i: Item) => (i.type === "TASK" ? "oTaskAlt" : i.type === "EVENT" ? "fEvent" : "oDescription");
  return (
    <div className="pe-links">
      <div className="pe-links-head">
        <SectionHeader className="grow">Links</SectionHeader>
        {id !== 0 && <TextButton className="icon" onClick={() => { onLeave?.(); go(`graph?focus=${id}`); }}><MIcon name="oHub" size={18} />Graph</TextButton>}
        <TextButton className="icon" onClick={() => setPicking(true)}><MIcon name="oAddLink" size={18} />Link</TextButton>
      </div>
      {rows.length === 0 && <div className="pe-small pad">Connect this to other notes, tasks or events. You can also type [[Title]] in the text.</div>}
      {rows.map(({ item, label, removable }) => (
        <div key={item.id} className="p-li two" role="button" onClick={() => { onLeave?.(); openItem(item); }}>
          <span className="lead"><MIcon name={typeIcon(item)} color={s.colorOf(item)} /></span>
          <span className="text"><span className="headline ellipsis">{item.title || "Untitled"}</span><span className="supporting small">{typeLabel(item)} · {label}</span></span>
          {removable && <span className="trail"><IconButton icon="fClose" label="Remove link" onClick={() => removeLink(id, item.id)} /></span>}
        </div>
      ))}
      {picking && <ItemPicker s={s} exclude={new Set([id, ...s.neighbours(id)])} onClose={() => setPicking(false)}
        onPick={(target) => { const me = ensureSaved ? ensureSaved() : id; if (me) addLink(me, target); }} />}
    </div>
  );
}

/** Searchable list of items to link to (ItemPickerDialog). */
function ItemPicker({ s, exclude, onPick, onClose }: { s: Snapshot; exclude: Set<number>; onPick: (id: number) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const list = s.items.filter((i) => !exclude.has(i.id) && (!ql || i.title.toLowerCase().includes(ql) || preview(i.content, 400).toLowerCase().includes(ql)))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
  return (
    <BottomSheet onClose={onClose}>{(close) => <>
      <div className="p-sheet-title">Link to…</div>
      <div className="p-sheet-pad"><input className="p-field" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" /></div>
      <div className="pe-pick-list">
        {list.map((i) => (
          <div key={i.id} className="p-li two" role="button" onClick={() => { onPick(i.id); close(); }}>
            <span className="lead"><span className="pe-dot" style={{ background: s.colorOf(i) }} /></span>
            <span className="text"><span className="headline ellipsis">{i.title || "Untitled"}</span><span className="supporting small">{typeLabel(i)}</span></span>
          </div>
        ))}
      </div>
    </>}</BottomSheet>
  );
}

// ---------- History (recurring tasks) ----------

function TaskStats({ item, s }: { item: Item; s: Snapshot }) {
  const t = todayEpoch();
  const st = streak(item, s.done, t);
  const done = s.done.days(item.id);
  const gridStart = t - 7 * 15 - (weekday(t) - 1);
  return (
    <div className="pe-stats">
      <div className="pe-stats-row">
        <span className="fire"><MIcon name="fLocalFireDepartment" size={20} color="#FF7043" /> {st.current} current</span>
        <span>Best {st.best}</span><span>{Math.round(st.rate30 * 100)}% recent</span><span>{st.total} total</span>
      </div>
      <div className="pe-heat">
        {Array.from({ length: 16 }, (_, w) => (
          <div key={w}>
            {Array.from({ length: 7 }, (_, di) => {
              const day = gridStart + w * 7 + di;
              const cls = day > t ? "future" : done.has(day) ? "done" : occursOn(item, day) ? "missed" : "";
              return <span key={di} className={cls} />;
            })}
          </div>
        ))}
      </div>
      <div className="pe-small">Filled = done, red = missed</div>
    </div>
  );
}

// ---------- The view ----------

type FieldEdit = "title" | "when" | "repeat" | "location" | "alarms" | "notifications" | "notes" | "tags" | "color" | null;

export function PhoneItemView({ id, occ }: { id: number; occ: number | null }) {
  const s = useSnapshot();
  const item = s.byId.get(id);
  const left = useRef(false);
  const leave = () => { if (!left.current) { left.current = true; history.back(); } };
  // Deleted (here, from the editor or another device): nothing left to show.
  useEffect(() => { if (!item) leave(); }, [!item]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState<FieldEdit>(null);
  const [deleteMenu, setDeleteMenu] = useState(false);
  const [catMenu, setCatMenu] = useState(false);
  const [prioMenu, setPrioMenu] = useState(false);
  const [overdueMenu, setOverdueMenu] = useState(false);
  const [pendingScope, setPendingScope] = useState<Item | null>(null);
  if (!item) return null;

  const isEvent = item.type === "EVENT";
  const color = s.colorOf(item);
  const category = item.categoryId !== null ? s.categoryById.get(item.categoryId) : undefined;
  const reminders = s.reminders.get(id) ?? [];
  const alarms = reminders.filter((r) => r.type === "ALARM");
  const notifications = reminders.filter((r) => r.type !== "ALARM");
  const tags = s.tagsByItem.get(id) ?? [];
  const hasLinks = s.neighbours(id).size > 0;
  const t = todayEpoch();
  const timed = !(item.allDay || item.startMin === null);
  const day = occ ?? (isEvent ? item.startDay : currentEntry(item, s.done, t).day);
  const shownStart = day ?? item.startDay;
  const commit = (edited: Item) => saveItem(edited);
  const commitReminders = (list: Reminder[]) => saveItem(item, { reminders: list });
  /** A date change made on the shown day of a series, as the same move of the series' first day. */
  const toSeries = (edited: Item): Item => {
    const first = item.startDay, nd = edited.startDay;
    if (!isRecurring(item) || first === null || nd === null || shownStart === null) return edited;
    return { ...edited, startDay: first + (nd - shownStart), endDay: edited.endDay !== null ? edited.endDay - shownStart + first : null };
  };
  const completion = item.startDay === null ? NO_DAY : isRecurring(item) ? (day ?? item.startDay) : item.startDay;
  const done = s.done.isDone(id, completion);
  const forDay = isRecurring(item) && day !== null ? ` for ${(() => { const r = relativeDay(day); return ["Today", "Tomorrow", "Yesterday"].includes(r) ? r.toLowerCase() : r; })()}` : "";
  const hasNotes = preview(item.content, 10).trim() !== "";
  const alertLines = (list: Reminder[], kind: string | null) => [...list].sort((a, b) => b.offsetMin - a.offsetMin)
    .map((r) => `${kind ?? (r.type === "REMINDER" ? "Notification" : "Notification (silent)")} · ${offsetLabel(r.offsetMin).toLowerCase()}`).join("\n");
  const edit = () => go(`item/${id}?edit=1${occ !== null ? `&occ=${occ}` : ""}`);
  const duplicate = () => {
    duplicateSeed = { item: { ...item, id: 0, deletedAt: null }, reminders: reminders.map((r) => ({ ...r, id: 0 })), tags: tags.map((x) => x.name).join(" ") };
    go("item/0?edit=1&dup=1");
  };

  return (
    <div className="p-scaffold pe-view">
      <TopAppBar back title={isEvent ? "Event" : "Task"} actions={<>
        <IconButton icon="oContentCopy" label="Duplicate" onClick={duplicate} />
        <span className="p-menu-anchor">
          <IconButton icon="oDelete" label="Delete" onClick={() => { if (isRecurring(item) && occ !== null) setDeleteMenu(true); else { trashWithUndo(item); leave(); } }} />
          <DropdownMenu open={deleteMenu} onClose={() => setDeleteMenu(false)} items={[
            ...(occ !== null ? [{ label: `Only ${formatDate(occ)}`, icon: "oEventBusy", onClick: () => { deleteOccurrenceWithUndo(item, occ); leave(); } }] : []),
            { label: "Whole series", icon: "oDelete", onClick: () => { trashWithUndo(item); leave(); } },
          ]} />
        </span>
      </>} />
      <div className="p-content pe-body">
        <div className="pe-head">
          <button className="pe-bar" style={{ background: color }} aria-label="Colour" onClick={() => setEditing("color")} />
          <div className="grow">
            <button className="pe-title" onClick={() => setEditing("title")}>{item.title.trim() || "Untitled"}</button>
            <span className="p-menu-anchor start">
              <button className="pe-cat" style={{ color: category ? color : undefined }} onClick={() => setCatMenu(true)}>{category?.name ?? "No category"}</button>
              <DropdownMenu open={catMenu} onClose={() => setCatMenu(false)} items={categoryItems(s, (c) => commit({ ...item, categoryId: c }))} />
            </span>
          </div>
        </div>

        {!isEvent && (
          <div className="pe-done" role="button" onClick={() => toggleCompletion(id, completion, !done)}>
            <Checkbox checked={done} color={color} onChange={(v) => toggleCompletion(id, completion, v)} />
            <span style={{ color: done ? color : undefined }}>{done ? "Done" : "Mark done"}{forDay}</span>
          </div>
        )}

        <InfoRow icon="oSchedule" text={whenText(item, day)} onClick={() => setEditing("when")} />
        {(item.location ?? "").trim() && (
          <InfoRow icon="oLocationOn" text={item.location!} link onClick={() => openExternal(mapUrl(item))} trailing={<>
            <IconButton icon="oDirections" label="Directions" className="primary" onClick={() => openExternal(directionsUrl(item))} />
            <IconButton icon="oEdit" label="Change location" onClick={() => setEditing("location")} />
          </>} />
        )}
        {isRecurring(item) && <InfoRow icon="oRepeat" tint={color} text={describe(item)} onClick={() => setEditing("repeat")} />}
        {!isEvent && item.priority > 0 && (
          <span className="p-menu-anchor start block">
            <InfoRow icon="fFlag" tint={PRIORITY_COLORS[item.priority]} text={`${PRIORITIES[item.priority]} priority`} onClick={() => setPrioMenu(true)} />
            <DropdownMenu open={prioMenu} onClose={() => setPrioMenu(false)} items={priorityItems((p) => commit({ ...item, priority: p }))} />
          </span>
        )}
        {!isEvent && item.startDay !== null && item.overduePolicy !== "SHOW_OVERDUE" && (
          <span className="p-menu-anchor start block">
            <InfoRow icon="oSkipNext" text={item.overduePolicy === "CARRY_OVER" ? "If missed, it carries over to the next day" : "If missed, it's skipped"} onClick={() => setOverdueMenu(true)} />
            <DropdownMenu open={overdueMenu} onClose={() => setOverdueMenu(false)} items={overdueItems((p) => commit({ ...item, overduePolicy: p }))} />
          </span>
        )}
        {alarms.length > 0 && <InfoRow icon="oAlarm" text={alertLines(alarms, "Alarm")} onClick={() => setEditing("alarms")} />}
        {notifications.length > 0 && <InfoRow icon="oNotifications" text={alertLines(notifications, null)} onClick={() => setEditing("notifications")} />}
        {tags.length > 0 && <InfoRow icon="oLabel" text={tags.map((x) => `#${x.name}`).join("  ")} onClick={() => setEditing("tags")} />}
        {hasNotes
          ? <div className="pe-info top" role="button" onClick={() => setEditing("notes")}>
              <MIcon name="oNotes" size={22} />
              <div className="grow rich pe-notes" dangerouslySetInnerHTML={{ __html: sanitize(item.content) }} />
            </div>
          : <InfoRow icon="oNotes" text="Add description" placeholder onClick={() => setEditing("notes")} />}

        {/* What it doesn't have yet, one tap away. */}
        <div className="pe-flow pad">
          {!(item.location ?? "").trim() && <AssistChip icon="oLocationOn" label="Location" onClick={() => setEditing("location")} />}
          {alarms.length === 0 && <AssistChip icon="oAlarm" label="Alarm" onClick={() => setEditing("alarms")} />}
          {notifications.length === 0 && <AssistChip icon="oNotifications" label="Notification" onClick={() => setEditing("notifications")} />}
          {!isRecurring(item) && <AssistChip icon="oRepeat" label="Repeat" onClick={() => setEditing("repeat")} />}
          {tags.length === 0 && <AssistChip icon="oLabel" label="Tags" onClick={() => setEditing("tags")} />}
          {!isEvent && item.priority === 0 && (
            <span className="p-menu-anchor start">
              <AssistChip icon="oFlag" label="Priority" onClick={() => setPrioMenu(true)} />
              <DropdownMenu open={prioMenu} onClose={() => setPrioMenu(false)} items={priorityItems((p) => commit({ ...item, priority: p }))} />
            </span>
          )}
        </div>

        {!isEvent && isRecurring(item) && <><SectionHeader>History</SectionHeader><TaskStats item={item} s={s} /></>}
        {hasLinks && <PhoneLinks id={id} s={s} />}
        <div style={{ height: 96 }} />
      </div>
      <ExtendedFab icon="oEdit" label="Edit" onClick={edit} />

      {editing === "title" && <TextFieldDialog title="Title" label="Title" initial={item.title} onClose={() => setEditing(null)} onSave={(v) => commit({ ...item, title: v.trim() || item.title })} />}
      {editing === "tags" && <TextFieldDialog title="Tags (space separated)" label="Tags" initial={tags.map((x) => x.name).join(" ")} onClose={() => setEditing(null)}
        onSave={(v) => saveItem(item, { tags: v.split(/[\s,]+/).map((x) => x.replace(/^#/, "")).filter(Boolean) })} />}
      {editing === "color" && <ColorPickerDialog title="Colour" selected={item.color} onClose={() => setEditing(null)} onPick={(c) => commit({ ...item, color: c })} />}
      {editing === "when" && <WhenSheet item={item} shownStart={shownStart} onClose={() => setEditing(null)} onSave={(edited) => {
        if (isRecurring(item) && occ !== null) setPendingScope(edited); else commit(toSeries(edited));
      }} />}
      {editing === "repeat" && <RepeatSheet item={item} onClose={() => setEditing(null)} onSave={commit} />}
      {editing === "location" && <LocationSheet item={item} onClose={() => setEditing(null)} onSave={commit} />}
      {editing === "notes" && <NotesSheet item={item} onClose={() => setEditing(null)} onSave={(html) => commit({ ...item, content: preview(html, 10).trim() ? html : "" })} />}
      {(editing === "alarms" || editing === "notifications") && (
        <BottomSheet onClose={() => setEditing(null)}>{() => <>
          <div className="p-sheet-title small">{editing === "alarms" ? "Alarms" : "Notifications"}</div>
          <AlertSection alarms={editing === "alarms"} all={reminders} type={item.type} timed={timed} onChange={commitReminders} />
          <div className="pe-small pad">{ALERTS_HINT}</div>
        </>}</BottomSheet>
      )}
      {pendingScope && <ScopeDialog title="Change" onCancel={() => setPendingScope(null)} onPick={(sc) => {
        const edited = pendingScope;
        setPendingScope(null);
        if (occ === null) return;
        const change = sc === "THIS" ? { ...edited, startDay: edited.startDay ?? occ } : sc === "FOLLOWING" ? edited : toSeries(edited);
        saveSeriesEdit(sc, item, occ, change);
        // "This" and "following" make a new item; this view's occurrence is gone from the series.
        if (sc !== "ALL") leave();
      }} />}
    </div>
  );
}

function InfoRow({ icon, text, tint, placeholder, onClick, trailing, link }: {
  icon: string; text: string; tint?: string; placeholder?: boolean; onClick?: () => void; trailing?: ReactNode; link?: boolean;
}) {
  return (
    <div className={`pe-info ${trailing ? "trailing" : ""}`} role={onClick ? "button" : undefined} onClick={onClick}>
      <MIcon name={icon} size={22} color={tint} />
      <span className={`grow ${placeholder ? "ph" : ""} ${link ? "link" : ""}`}>{text}</span>
      {trailing && <span className="pe-trail" onClick={(e) => e.stopPropagation()}>{trailing}</span>}
    </div>
  );
}

function WhenSheet({ item, shownStart, onClose, onSave }: { item: Item; shownStart: number | null; onClose: () => void; onSave: (i: Item) => void }) {
  // A repeating item opened on one day shows (and changes) that day.
  const shift = (shownStart ?? 0) - (item.startDay ?? 0);
  const [d, setD] = useState<Item>({ ...item, startDay: shownStart, endDay: item.endDay !== null ? item.endDay + shift : null });
  return (
    <BottomSheet onClose={onClose}>{(close) => <>
      <WhenFields d={d} set={(p) => setD({ ...d, ...p })} />
      <SheetButtons onCancel={close} onSave={() => { onSave(tidyWhen(d)); close(); }} />
    </>}</BottomSheet>
  );
}

function RepeatSheet({ item, onClose, onSave }: { item: Item; onClose: () => void; onSave: (i: Item) => void }) {
  const [d, setD] = useState(item);
  return (
    <BottomSheet onClose={onClose}>{(close) => <>
      <RepeatEditor d={d} expanded onExpand={() => {}} onChange={setD} />
      <SheetButtons onCancel={close} onSave={() => { onSave(d.freq !== "NONE" && d.startDay === null ? { ...d, startDay: todayEpoch() } : d); close(); }} />
    </>}</BottomSheet>
  );
}

function LocationSheet({ item, onClose, onSave }: { item: Item; onClose: () => void; onSave: (i: Item) => void }) {
  const [d, setD] = useState(item);
  return (
    <BottomSheet onClose={onClose}>{(close) => <>
      <LocationField d={d} set={(p) => setD({ ...d, ...p })} autoFocus />
      <SheetButtons onCancel={close} onSave={() => { onSave({ ...d, location: (d.location ?? "").trim() }); close(); }} />
    </>}</BottomSheet>
  );
}

function NotesSheet({ item, onClose, onSave }: { item: Item; onClose: () => void; onSave: (html: string) => void }) {
  const rich = useRef<RichEditorHandle>(null);
  useEffect(() => { const t = window.setTimeout(() => rich.current?.focus(), 120); return () => clearTimeout(t); }, []);
  return (
    <BottomSheet onClose={onClose}>{(close) => <>
      <div className="p-sheet-pad">
        <RichBar editor={rich} compact />
        <div className="pe-notes-edit"><RichEditor ref={rich} initialHtml={item.content} onChange={() => {}} minHeight={120} noToolbar placeholder="Add description" /></div>
      </div>
      <SheetButtons onCancel={close} onSave={() => { onSave(rich.current?.html() ?? item.content); close(); }} />
    </>}</BottomSheet>
  );
}

// ---------- The full editor ----------

/** The copy "Duplicate" opens the editor with; nothing is saved until Save. */
let duplicateSeed: Draft | null = null;

/**
 * The full editor, laid out like Google Calendar's: one row per field, each with its icon. Standing
 * alone it edits a saved item (or a duplicate); inside the add panel it edits the panel's draft
 * ([draft] / [onDraft]) and the panel's handle sits above its top bar ([header]).
 */
export function PhoneItemEditor({ id, occ, dup, draft, onDraft, onClose, saveRef, header, newType = "TASK" }: {
  id: number; occ: number | null; dup?: boolean; draft?: Draft; onDraft?: (d: Draft) => void; onClose: () => void;
  saveRef?: { current: (() => void) | null }; header?: ReactNode; newType?: ItemType;
}) {
  const s = useSnapshot();
  const original = id ? s.byId.get(id) ?? null : null;
  const [local, setLocal] = useState<Draft>(() => {
    if (original) return { item: original, reminders: (s.reminders.get(id) ?? []).map((r) => ({ ...r })), tags: (s.tagsByItem.get(id) ?? []).map((x) => x.name).join(" ") };
    if (dup && duplicateSeed) { const d = duplicateSeed; duplicateSeed = null; return d; }
    const item = newItem({ type: newType, startDay: newType === "EVENT" ? todayEpoch() : null });
    return { item, reminders: firstAlerts(item), tags: "" };
  });
  const cur = draft ?? local;
  const curRef = useRef(cur);
  curRef.current = cur;
  // Several changes in one tap each build on the last (the prop only updates on the next render).
  const emit = (n: Draft) => { curRef.current = n; if (onDraft) onDraft(n); else setLocal(n); };
  const d = cur.item;
  const set = (patch: Partial<Item>) => emit({ ...curRef.current, item: { ...curRef.current.item, ...patch } });
  const isNew = !original;
  const isEvent = d.type === "EVENT";
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [colorDialog, setColorDialog] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [deleteMenu, setDeleteMenu] = useState(false);
  const [notesFocused, setNotesFocused] = useState(false);
  const [notesEmpty, setNotesEmpty] = useState(() => !preview(d.content, 10).trim());
  const [currentId, setCurrentId] = useState(id);
  const rich = useRef<RichEditorHandle>(null);
  const [initialHtml] = useState(d.content);
  const category = d.categoryId !== null ? s.categoryById.get(d.categoryId) : undefined;
  const color = d.color !== null ? cssColor(d.color) : category ? cssColor(category.color) : s.colorOf({ ...d, categoryId: null, color: null });
  const tagList = () => cur.tags.split(/[\s,]+/).map((x) => x.replace(/^#/, "")).filter(Boolean);
  const timed = !(d.allDay || d.startMin === null);
  /** From the panel, going elsewhere in the app means closing the panel first. */
  const leaveTo = () => { if (draft) onClose(); };

  const finalItem = (): Item => {
    const html = rich.current?.html() ?? d.content;
    let it: Item = { ...d, title: d.title.trim(), content: preview(html, 10).trim() ? html : "", location: (d.location ?? "").trim() };
    it = it.type === "EVENT" ? tidyWhen(it) : { ...it, endDay: null, endMin: null, allDay: false };
    if (it.freq !== "NONE" && it.startDay === null) it.startDay = todayEpoch();
    return it;
  };
  const save = (scope?: EditScope) => {
    const item = finalItem();
    if (original && isRecurring(original) && occ !== null && !scope) { setScopeOpen(true); return; }
    if (original && scope && occ !== null) {
      const edited = scope === "THIS" ? { ...item, startDay: item.startDay !== original.startDay ? item.startDay : occ } : item;
      saveSeriesEdit(scope, original, occ, edited, { reminders: cur.reminders, tags: tagList() });
    } else saveItem({ ...item, id: currentId }, { reminders: cur.reminders, tags: tagList() });
    onClose();
  };
  if (saveRef) saveRef.current = () => save();
  /** Linking needs the item saved: a new one is saved first (as "Untitled" if it has no title). */
  const ensureSaved = () => {
    if (currentId) return currentId;
    const item = finalItem();
    const nid = saveItem({ ...item, title: item.title || "Untitled" }, { reminders: cur.reminders, tags: tagList() });
    setCurrentId(nid);
    emit({ ...curRef.current, item: { ...curRef.current.item, id: nid, title: item.title || "Untitled" } });
    return nid;
  };

  return (
    <div className="p-scaffold pe-editor">
      {header}
      <TopAppBar className={header ? "nosat" : ""} title={isNew ? `New ${isEvent ? "event" : "task"}` : isEvent ? "Event" : "Task"} actions={<>
        {original && (
          <span className="p-menu-anchor">
            <IconButton icon="oDelete" label="Delete" onClick={() => { if (isRecurring(original) && occ !== null) setDeleteMenu(true); else { trashWithUndo(original); leaveAll(); } }} />
            <DropdownMenu open={deleteMenu} onClose={() => setDeleteMenu(false)} items={[
              ...(occ !== null ? [{ label: `Only ${formatDate(occ)}`, icon: "oEventBusy", onClick: () => { deleteOccurrenceWithUndo(original, occ); leaveAll(); } }] : []),
              { label: "Whole series", icon: "oDelete", onClick: () => { trashWithUndo(original); leaveAll(); } },
            ]} />
          </span>
        )}
        <button className="p-filled-btn pe-save" disabled={!d.title.trim()} onClick={() => save()}>Save</button>
      </>} back={false} navIcon={<IconButton icon="fArrowBack" label="Cancel" onClick={onClose} />} />
      <div className="p-content pe-body">
        {isNew && (
          <div className="pe-types">
            {(["EVENT", "TASK"] as const).map((t) => <FilterChip key={t} selected={d.type === t} onClick={() => emit(switchType(curRef.current, t))}>{t === "EVENT" ? "Event" : "Task"}</FilterChip>)}
          </div>
        )}
        <div className="pe-titlerow">
          <button className="pe-swatch" style={{ background: color }} aria-label="Colour" onClick={() => setColorDialog(true)} />
          <input className="pe-titleinput title-input" placeholder="Add title" value={d.title} autoCapitalize="sentences" enterKeyHint="done"
            onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </div>
        <div className="p-divider" />

        <WhenFields d={d} set={set} />
        <RepeatEditor d={d} expanded={d.freq !== "NONE" || added.has("repeat")} onExpand={() => setAdded(new Set([...added, "repeat"]))} onChange={(i) => emit({ ...curRef.current, item: i })} />
        <div className="p-divider" />

        <LocationField d={d} set={set} />
        <div className="p-divider" />

        <AlertSection alarms all={cur.reminders} type={d.type} timed={timed} onChange={(r) => emit({ ...curRef.current, reminders: r })} />
        <div className="p-divider" />
        <AlertSection alarms={false} all={cur.reminders} type={d.type} timed={timed} onChange={(r) => emit({ ...curRef.current, reminders: r })} />
        <div className="pe-small indent">{ALERTS_HINT}</div>
        <div className="p-divider" />

        <FieldRow icon="oPalette">
          <span className="grow"><MenuText text={category?.name ?? "No category"} items={categoryItems(s, (c) => set({ categoryId: c }), leaveTo)} /></span>
          <TextButton className="icon" onClick={() => setColorDialog(true)}><span className="pe-dot" style={{ background: color }} />{d.color === null ? "Category colour" : "Own colour"}</TextButton>
        </FieldRow>
        {!isEvent && <>
          <FieldRow icon="oFlag">
            <MenuText text={d.priority === 0 ? "No priority" : `${PRIORITIES[d.priority]} priority`} items={priorityItems((p) => set({ priority: p }))} />
          </FieldRow>
          {d.startDay !== null && (
            <FieldRow icon="oUpdate">
              <MenuText text={overdueText(d.overduePolicy)} items={overdueItems((p) => set({ overduePolicy: p }))} />
            </FieldRow>
          )}
        </>}
        <div className="p-divider" />

        {/* Notes: one row ("Add description") until typed into; then the formatting bar and room to write. */}
        <FieldRow icon="oNotes" top>
          <div className="grow pe-notes-edit">
            {notesFocused && <RichBar editor={rich} compact className="inline" />}
            <RichEditor ref={rich} initialHtml={initialHtml} onChange={() => setNotesEmpty(!(rich.current?.html() ?? "").replace(/<[^>]*>/g, "").trim())}
              minHeight={notesFocused || !notesEmpty ? 72 : 24} noToolbar placeholder="Add description" onFocusChange={(f) => { if (f) setNotesFocused(true); }} />
          </div>
        </FieldRow>
        <div className="p-divider" />

        <FieldRow icon="oLabel">
          <input className="pe-input grow" placeholder="Add tags (space separated)" value={cur.tags} autoCapitalize="none" enterKeyHint="done"
            onChange={(e) => emit({ ...curRef.current, tags: e.target.value })} />
        </FieldRow>
        <div className="p-divider" />

        <PhoneLinks id={currentId} s={s} ensureSaved={ensureSaved} onLeave={leaveTo} />
        <div style={{ height: 48 }} />
      </div>

      {colorDialog && <ColorPickerDialog title="Colour" selected={d.color} onClose={() => setColorDialog(false)} onPick={(c) => set({ color: c })} />}
      {scopeOpen && <ScopeDialog title="Save changes to" onCancel={() => setScopeOpen(false)} onPick={(sc) => { setScopeOpen(false); save(sc); }} />}
    </div>
  );

  /** After deleting from the editor (the view under it then closes itself, its item gone). */
  function leaveAll() { onClose(); }
}

/** The editor as a page (Edit from the view, or Duplicate). Back leaves without saving. */
export function PhoneItemEditorPage({ id, occ, dup }: { id: number; occ: number | null; dup: boolean }) {
  const closed = useRef(false);
  const close = () => { if (!closed.current) { closed.current = true; history.back(); } };
  return <PhoneItemEditor id={id} occ={occ} dup={dup} onClose={close} />;
}

