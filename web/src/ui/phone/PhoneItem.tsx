// Tasks and events on the phone, after the native ItemViewScreen, ItemEditorScreen, FieldEditors and
// RecurrenceDetails. Opening one shows the view: only what it has, each field changed in place with a
// tap (a picker, a menu or a small sheet, saved at once), and an Edit button for the full editor. The
// full editor is the same one the add panel grows into.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatDate, formatTime, monthShort, offsetLabel, offsetText, relativeDay, today as todayEpoch, weekday, ymd } from "../../domain/dates.ts";
import { LAST_DAY_OF_MONTH, dayBit, describe, hasMonth, hasWeekDay, occurrences, occursOn, parseIntList } from "../../domain/recurrence.ts";
import { currentEntry, streak } from "../../domain/schedule.ts";
import { descriptionText, plainToHtml, preview } from "../../domain/text.ts";
import {
  type Freq, type Item, type ItemType, type OverduePolicy, type Reminder,
  NO_DAY, PRIORITIES, priorityColor, cssColor, isRecurring, newItem,
} from "../../domain/types.ts";
import {
  type EditScope, type Snapshot, addLink, deleteOccurrence, onFlush, removeLink, restore, saveItem, saveSeriesEdit, snapshot, toggleCompletion, trash, useSnapshot,
} from "../../store/store.ts";
import { go, openItem } from "../shared/common.tsx";
import { typeLabel } from "../shared/kinds.ts";
import { Checkbox, Dialog, DropdownMenu, FilterChip, IconButton, MIcon, SectionHeader, Segmented, TopAppBar, type MenuItem } from "./chrome.tsx";
import { findLinks } from "../../domain/links.ts";
import { linkAtCaretOf, linkInTextarea } from "../shared/linkHit.ts";
import { useLinkGesture } from "../shared/linkGesture.ts";
import { useWebLinks } from "./WebLinks.tsx";
import { AssistChip, BottomSheet, ColorPickerDialog, ExtendedFab, SheetButtons, Switch, TextButton, TextFieldDialog, showSnackbar } from "./m3.tsx";
import { feel } from "./haptics.ts";
import { TOUCH_SLOP } from "./press.ts";
import { mouseMenu } from "./desk.ts";
import { openDirections, openInGoogleMaps, searchPlaces } from "./device.ts";
import { fetchPlaceOfLink } from "../../store/preview.ts";
import { NO_PLACE, type Place, locationLink, mapsQuery, mapsShortLink, placeFields, placeKey, placeLines, stableMerge, usualArea } from "../../domain/places.ts";
import { DatePickerDialog, RangeDatePickerDialog, TimePickerDialog } from "./pickers.tsx";
import { HeldTime } from "./TimeWheel.tsx";
import { SlideStepper } from "./SlideStepper.tsx";
import { type Control, hasAlarms, native, onNative, useAlarmState } from "../../alarms/native.ts";
import { openExternal } from "./native.ts";
import { useAlarmSettings } from "../../alarms/settings.ts";
import { DEFAULT_REMINDER_MIN, defaultAlert, firstReminders, followDefaults, isDefaultReminders } from "../../domain/reminders.ts";
import { canBeRoutine, isRoutineItem, isRoutineSeries, routineEntry, routineStreak } from "../../domain/routines.ts";
import { setRoutine, streakSymbol } from "../../store/routines.ts";
import { futsalLogId } from "../../domain/training.ts";
import { sessionStats, statLine, venueOf } from "../../domain/watchActivities.ts";
import { training } from "../../store/training.ts";

// ---------- Shared bits ----------

/** An unsaved item with its alerts and tags: what the editor (and the add panel it grows from) holds. */
export interface Draft { item: Item; reminders: Reminder[]; tags: string }

/** The reminder menu's choices; anything else (after the start, 3 hours before…) is Custom…. */
const OFFSETS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
const DAY_END = 24 * 60 - 1;

export { defaultAlert };

/** A new item's first alert: 30 minutes before a timed task or event, at the day's time for an untimed one. */
export const firstAlerts = firstReminders;

/** Event or task, the way the editor's chips switch it (EditorDraft.switchType). */
export function switchType(d: Draft, t: ItemType): Draft {
  const it = d.item;
  const item = t === "EVENT"
    ? { ...it, type: t, startDay: it.startDay ?? todayEpoch(), endDay: it.startDay ?? todayEpoch(), allDay: it.startMin === null, endMin: it.startMin !== null ? Math.min(it.startMin + 60, DAY_END) : null }
    : { ...it, type: t };
  // Untouched first reminders become the new kind's; changed ones keep their times, in the new kind's style.
  const reminders = isDefaultReminders(d.reminders, it) ? firstReminders(item) : d.reminders.map((r) => (r.type === "ALARM" ? r : { ...r, type: defaultAlert(t) }));
  return { ...d, item, reminders };
}

/** "At the time", "15 minutes before", "1 day before", "10 minutes after"... */
export { offsetText };

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


/** Moves an item to the trash at once; the snackbar can bring it back (vm.trashWithUndo). */
export function trashWithUndo(item: Item) {
  trash(item.id);
  showSnackbar(`“${item.title.trim() || "Untitled"}” moved to trash`, "Undo", () => restore(item.id));
}

/** Moves several items to the trash at once (selected notes or search results); one Undo brings them all back. */
export function trashManyWithUndo(items: Item[]) {
  if (items.length === 0) return;
  if (items.length === 1) { trashWithUndo(items[0]); return; }
  for (const i of items) trash(i.id);
  showSnackbar(`${items.length} items moved to trash`, "Undo", () => { for (const i of items) restore(i.id); });
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
function FieldText({ children, onClick, placeholder, grow, label }: { children: ReactNode; onClick: () => void; placeholder?: boolean; grow?: boolean; label?: string }) {
  return <button className={`pe-text ${placeholder ? "ph" : ""} ${grow ? "grow" : ""}`} aria-label={label} onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>;
}

/** A row with a menu under its text. */
function MenuText({ text, items, placeholder, label }: { text: ReactNode; items: MenuItem[]; placeholder?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="p-menu-anchor start">
      <FieldText placeholder={placeholder} label={label} onClick={() => setOpen(true)}>{text}</FieldText>
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

/** A priority's name, for its flag's label (held, it shows as a tooltip): "High priority". */
export const priorityLabel = (p: number) => `${PRIORITIES[p]} priority`;
const priorityItems = (pick: (p: number) => void): MenuItem[] =>
  PRIORITIES.map((p, i) => ({ label: p, icon: "oFlag", iconColor: i ? priorityColor(i) : undefined, onClick: () => pick(i) }));
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
  const setStart = (m: number) => {
    const dur = d.startMin !== null && d.endMin !== null ? d.endMin - d.startMin : 60;
    set({ startMin: m, endMin: isEvent ? Math.min(m + Math.max(15, dur), DAY_END) : d.endMin });
  };
  const setEnd = (m: number) => set({ endMin: m });
  // A time shown can also be held: a drum opens on its hours or minutes (TimeWheel.tsx).
  const held = (m: number, on: (m: number) => void) => <HeldTime min={m} onChange={on} />;
  return <>
    {isEvent ? <>
      <FieldRow icon="oSchedule" onClick={() => set(allDayPatch(d, !d.allDay))}>
        <span className="pe-label grow">All-day</span>
        <Switch checked={d.allDay} onChange={(v) => set(allDayPatch(d, v))} label="All-day" />
      </FieldRow>
      <FieldRow>
        <FieldText grow onClick={() => setPick({ kind: "date", which: "start" })}>{d.startDay !== null ? formatDate(d.startDay) : "Pick date"}</FieldText>
        {!d.allDay && <FieldText onClick={() => setPick({ kind: "time", which: "start" })}>{d.startMin !== null ? held(d.startMin, setStart) : "Time"}</FieldText>}
      </FieldRow>
      <FieldRow>
        <FieldText grow onClick={() => setPick({ kind: "date", which: "end" })}>{dateOf("end") !== null ? formatDate(dateOf("end")!) : "Pick date"}</FieldText>
        {!d.allDay && <FieldText onClick={() => setPick({ kind: "time", which: "end" })}>{d.endMin !== null ? held(d.endMin, setEnd) : "Time"}</FieldText>}
      </FieldRow>
    </> : (
      <FieldRow icon="oSchedule">
        <FieldText grow placeholder={d.startDay === null} onClick={() => setPick({ kind: "date", which: "start" })}>{d.startDay !== null ? formatDate(d.startDay) : "Add date"}</FieldText>
        {d.startDay !== null && <>
          <FieldText placeholder={d.startMin === null} onClick={() => setPick({ kind: "time", which: "start" })}>{d.startMin !== null ? held(d.startMin, setStart) : "Add time"}</FieldText>
          <IconButton icon="fClose" label="Clear date" onClick={() => set({ startDay: null, startMin: null, freq: "NONE" })} />
        </>}
      </FieldRow>
    )}
    {/* An event's days: start and end in one calendar. */}
    {pick?.kind === "date" && isEvent && (
      <RangeDatePickerDialog start={d.startDay ?? todayEpoch()} end={dateOf("end") ?? d.startDay ?? todayEpoch()} next={pick.which === "end" ? "end" : "start"}
        onClose={() => setPick(null)} onPick={(a, b) => set({ startDay: a, endDay: b })} />
    )}
    {pick?.kind === "date" && !isEvent && (
      <DatePickerDialog value={dateOf(pick.which === "end" ? "end" : "start")} onClose={() => setPick(null)} onPick={(e) => {
        if (pick.which === "end") set({ endDay: Math.max(e, d.startDay ?? e) });
        else {
          const span = (d.endDay ?? d.startDay ?? e) - (d.startDay ?? e);
          set({ startDay: e, endDay: isEvent ? e + span : null });
        }
      }} />
    )}
    {pick?.kind === "time" && (
      <TimePickerDialog value={(pick.which === "end" ? d.endMin : d.startMin) ?? 9 * 60} onClose={() => setPick(null)} onPick={(m) => (pick.which === "end" ? setEnd(m) : setStart(m))} />
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
/**
 * An item's alarms or notifications. [onDate]: a task with no date yet, whose reminders can't ring
 * until it has one; its rows say so, with a row to pick the date and time there and then.
 */
function AlertSection({ alarms, all, type, timed, onChange, onDate }: {
  alarms: boolean; all: Reminder[]; type: ItemType; timed: boolean; onChange: (r: Reminder[]) => void; onDate?: (day: number, min: number) => void;
}) {
  const mine = all.map((r, i) => [r, i] as const).filter(([r]) => (r.type === "ALARM") === alarms);
  const [picking, setPicking] = useState<null | "date" | number>(null);
  const [custom, setCustom] = useState<number | null>(null);
  const icon = alarms ? "oAlarm" : "oNotifications";
  const set = (i: number, r: Reminder) => onChange(all.map((x, j) => (j === i ? r : x)));
  const untimed = ` (${formatTime(useAlarmSettings().defaultTaskTime)})`;
  const pickSound = async (i: number, r: Reminder) => {
    const p = await native.pickSound(r.soundUri, "Alarm sound");
    if (p.picked) set(i, { ...r, soundUri: p.uri ?? null });
  };
  return <>
    {mine.map(([r, i], n) => (
      <FieldRow key={i} icon={n === 0 ? icon : null}>
        <span className="grow">
          <MenuText text={onDate ? `${offsetText(r.offsetMin)} · once it has a date` : offsetText(r.offsetMin) + (timed ? "" : untimed)} items={[
            ...OFFSETS.map((o) => ({ label: offsetText(o), checked: o === r.offsetMin, onClick: () => set(i, { ...r, offsetMin: o }) })),
            { label: "Custom…", divider: true, checked: !OFFSETS.includes(r.offsetMin), onClick: () => setCustom(i) },
          ]} />
        </span>
        {alarms && hasAlarms && (
          <IconButton icon="oMusicNote" className={r.soundUri ? "primary" : ""} label={r.soundUri ? "Alarm sound (custom)" : "Alarm sound (default)"}
            onClick={() => void pickSound(i, r)} />
        )}
        {!alarms && (
          <IconButton icon={r.type === "REMINDER" ? "oNotificationsActive" : "oNotificationsNone"} className={r.type === "REMINDER" ? "primary" : ""}
            label={r.type === "REMINDER" ? "Pops up with a sound (tap for silent)" : "Silent (tap to pop up with a sound)"}
            onClick={() => set(i, { ...r, type: r.type === "REMINDER" ? "NOTIFICATION" : "REMINDER" })} />
        )}
        <IconButton icon="fClose" label="Remove" onClick={() => onChange(all.filter((_, j) => j !== i))} />
      </FieldRow>
    ))}
    {onDate && mine.length > 0 && (
      <FieldRow icon={null} onClick={() => setPicking("date")}>
        <span className="pe-label primary-text">Pick date & time</span>
      </FieldRow>
    )}
    <FieldRow icon={mine.length ? null : icon} onClick={() => onChange([...all, { id: 0, itemId: 0, offsetMin: timed ? DEFAULT_REMINDER_MIN : 0, type: alarms ? "ALARM" : defaultAlert(type), soundUri: null }])}>
      <span className="pe-label ph">{alarms ? "Add alarm" : "Add notification"}</span>
    </FieldRow>
    {picking === "date" && <DatePickerDialog value={null} onClose={() => setPicking((p) => (p === "date" ? null : p))} onPick={(d) => setPicking(d)} />}
    {typeof picking === "number" && <TimePickerDialog value={null} onClose={() => setPicking(null)} onPick={(m) => { onDate?.(picking, m); setPicking(null); }} />}
    {custom !== null && all[custom] && (
      <CustomLeadDialog value={all[custom].offsetMin} onSave={(m) => set(custom, { ...all[custom], offsetMin: m })} onClose={() => setCustom(null)} />
    )}
  </>;
}

const LEAD_UNITS: [string, string, number][] = [["min", "Minutes", 1], ["hour", "Hours", 60], ["day", "Days", 1440], ["week", "Weeks", 10080]];
/** The longest custom lead time, either way: 4 weeks. */
const MAX_LEAD = 4 * 10080;

/** A reminder time of one's own: a number, its unit, and before or after the start. */
function CustomLeadDialog({ value, onSave, onClose }: { value: number; onSave: (min: number) => void; onClose: () => void }) {
  const a = Math.abs(value);
  const first = [...LEAD_UNITS].reverse().find(([, , m]) => a > 0 && a % m === 0) ?? LEAD_UNITS[0];
  const [unit, setUnit] = useState(first[0]);
  const [n, setN] = useState(a / first[2]);
  const [after, setAfter] = useState(value < 0);
  const per = LEAD_UNITS.find(([k]) => k === unit)![2];
  const total = n * per;
  // A bigger unit can push the same number past 4 weeks: then it says so, and Save waits.
  const valid = total <= MAX_LEAD;
  const save = () => { if (!valid) return; onSave(after ? -total : total); onClose(); };
  return (
    <Dialog title="Custom reminder" onClose={onClose} actions={<>
      <span className="grow" />
      <TextButton onClick={onClose}>Cancel</TextButton>
      <TextButton disabled={!valid} onClick={save}>Save</TextButton>
    </>}>
      <SlideStepper value={n} onChange={(v) => setN(v ?? 0)} step={1} max={Math.floor(MAX_LEAD / per)} buttons label="How many" />
      <div className="pe-lead-row"><Segmented value={unit} options={LEAD_UNITS.map(([k, l]): [string, string] => [k, l])} onChange={setUnit} /></div>
      <div className="pe-lead-row"><Segmented value={after ? "after" : "before"} options={[["before", "Before"], ["after", "After"]]} onChange={(v) => setAfter(v === "after")} /></div>
      <div className="pe-small pe-lead-sum">{valid ? offsetText(after ? -total : total) : "Up to 4 weeks"}</div>
    </Dialog>
  );
}

/** While one of the item's alarms rings: Snooze and Stop right here (it rings on whatever the screen shows). */
function RingingNow({ itemId }: { itemId: number }) {
  const { ringing } = useAlarmState();
  if (!ringing || ringing.itemId !== itemId) return null;
  return (
    <div className="pe-ringing" role="alert">
      <MIcon name="oAlarm" size={22} />
      <span className="grow">Ringing now</span>
      <TextButton onClick={() => void native.stopRinging("snooze")}>Snooze</TextButton>
      <button className="p-filled-btn" onClick={() => void native.stopRinging("stop")}>Stop</button>
    </div>
  );
}

/** Said once under the alerts: where they ring (this phone, unless turned off; on the PC, the Android app). */
function AlertsHint({ className }: { className: string }) {
  const { ring } = useAlarmState();
  const text = !hasAlarms ? "Alarms and notifications ring from the Planner Android app; this app keeps them with the item."
    : ring.rings ? "Alarms ring on this phone, even with the app closed."
      : "Event and task alarms are off on this phone. To ring them, turn on \"Ring event and task alarms on this phone\" in Settings.";
  return <div className={`pe-small ${className}`}>{text}</div>;
}

/**
 * From 23 hours before each of the item's alarms: when it will ring, with Snooze and Don't ring; and
 * snoozed or skipped times that can be reset (native EarlyAlarmControls). The engine works them out;
 * nothing shows where alarms don't ring on this phone.
 */
function EarlyAlarmControls({ itemId, reminders }: { itemId: number; reminders: Reminder[] }) {
  const { ring } = useAlarmState();
  const { snoozeMinutes } = useAlarmSettings();
  const [list, setList] = useState<Control[]>([]);
  const key = reminders.map((r) => `${r.id}:${r.offsetMin}:${r.type}`).join();
  useEffect(() => {
    if (!hasAlarms || !ring.rings) { setList([]); return; }
    let live = true;
    const load = () => void native.controls(itemId).then((c) => { if (live) setList(c); });
    // A change made on the page reaches the engine a moment later; ask again then.
    load();
    const t1 = window.setTimeout(load, 700);
    const t = window.setInterval(load, 30_000);
    const off = onNative("changed", load);
    return () => { live = false; clearTimeout(t1); clearInterval(t); off(); };
  }, [itemId, key, ring.rings]);
  if (!list.length) return null;
  const atText = (ms: number) => {
    const d = new Date(ms);
    const rel = relativeDay(Math.floor((ms - d.getTimezoneOffset() * 60_000) / 86_400_000));
    return `${["Today", "Tomorrow", "Yesterday"].includes(rel) ? rel.toLowerCase() : rel} at ${formatTime(d.getHours() * 60 + d.getMinutes())}`;
  };
  const minOf = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
  const reload = () => void native.controls(itemId).then(setList);
  const order = { rang: 0, soon: 1, skipped: 2 };
  return <>{[...list].sort((a, b) => order[a.kind] - order[b.kind]).map((c) => {
    let text: string;
    let buttons: ReactNode;
    if (c.kind === "rang") {
      text = `Snoozed: rings again ${atText(c.at)}`;
      buttons = <TextButton onClick={() => void native.resetAlarm(c.reminderId, null).then(reload)}>Reset</TextButton>;
    } else if (c.kind === "skipped") {
      text = `Won't ring ${atText(c.original)}`;
      buttons = <TextButton onClick={() => void native.resetAlarm(c.reminderId, c.original).then(reload)}>Reset</TextButton>;
    } else {
      const snoozed = c.at !== c.original;
      text = `Alarm rings ${atText(c.at)}` + (snoozed ? ` (snoozed from ${formatTime(minOf(c.original))})` : "");
      buttons = <>
        {snoozed && <TextButton onClick={() => void native.resetAlarm(c.reminderId, c.original).then(reload)}>Reset</TextButton>}
        {c.canSnooze
          ? <TextButton onClick={() => void native.earlySnooze(c.reminderId, c.original).then(reload)}>Snooze {snoozeMinutes} min</TextButton>
          : <span className="pe-early-note">No snoozing in the last 15 min</span>}
        <TextButton onClick={() => { void native.earlyStop(c.reminderId, c.original).then(reload); showSnackbar(`It won't ring ${atText(c.at)}`); }}>Don't ring</TextButton>
      </>;
    }
    return (
      <div key={`${c.kind}${c.reminderId}${c.original}`} className="pe-early">
        <div className="pe-early-text"><MIcon name="oAlarm" /><span>{text}</span></div>
        <div className="pe-early-buttons">{buttons}</div>
      </div>
    );
  })}</>;
}

// ---------- Location ----------

/**
 * The place: typed, it searches Photon as the typing pauses (places near the person first) and lists
 * what it finds under the field. A picked suggestion brings its name (the label shown, which can then be
 * changed), address, area and coordinates; the grey line under the field says which place it is. The list
 * only grows or shrinks at its end as more is typed, and never changes while a finger is on it.
 * A pasted Google Maps share link is resolved through the Worker and becomes a picked place; if it can't
 * be, the link stays as the location (and opens when tapped).
 */
function LocationField({ d, set, autoFocus }: { d: Item; set: (patch: Partial<Item>) => void; autoFocus?: boolean }) {
  const loc = d.location ?? "";
  const ref = useRef<HTMLInputElement>(null);
  // What's being typed (null once a place is picked or the field is left), and the places it matches.
  const [query, setQuery] = useState<string | null>(null);
  const [found, setFound] = useState<Place[]>([]);
  const [finding, setFinding] = useState(false);
  const touching = useRef(false);
  const waiting = useRef<Place[] | null>(null);
  // What the shown suggestions were found for: the typed town or area lifts its place to the top.
  const asked = useRef("");
  const show = (next: Place[]) => {
    if (touching.current) { waiting.current = next; return; }
    setFound((shown) => stableMerge(shown, next, 6, asked.current));
  };
  useEffect(() => { if (autoFocus) { const t = window.setTimeout(() => ref.current?.focus(), 80); return () => clearTimeout(t); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const q = query?.trim() ?? "";
    if (q.length < 2 || mapsShortLink(q)) { if (!touching.current) setFound([]); return; }
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      void searchPlaces(q, usualArea(snapshot().items), ctl.signal).then((r) => { if (!ctl.signal.aborted) { asked.current = q; show(r); } });
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const link = mapsShortLink(loc);
  useEffect(() => {
    if (!link) { setFinding(false); return; }
    const ctl = new AbortController();
    setFinding(true);
    void fetchPlaceOfLink(link, ctl.signal).then((p) => {
      if (ctl.signal.aborted) return;
      setFinding(false);
      if (p) { set(placeFields(p)); setQuery(null); setFound([]); }
    });
    return () => ctl.abort();
  }, [link]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (p: Place) => { set(placeFields(p)); setQuery(null); setFound([]); ref.current?.blur(); };
  const { sub } = placeLines(d);
  const release = () => {
    if (!touching.current) return;
    touching.current = false;
    const w = waiting.current;
    waiting.current = null;
    if (w) setFound((shown) => stableMerge(shown, w, 6, asked.current));
  };
  return <>
    <FieldRow icon="oLocationOn">
      <span className={`grow pe-placefield ${sub || finding ? "two" : ""}`}>
        <input ref={ref} className="pe-input" placeholder="Add location" value={loc} enterKeyHint="done" autoCapitalize="words"
          onChange={(e) => { const v = e.target.value; set(v.trim() ? { location: v } : NO_PLACE); setQuery(v); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        {(finding || sub) && <span className="pe-place-sub ellipsis">{finding ? "Finding the place…" : sub}</span>}
      </span>
      {loc && <IconButton icon="fClose" label="Clear location" onClick={() => { set(NO_PLACE); setQuery(null); setFound([]); }} />}
    </FieldRow>
    {query !== null && found.length > 0 && (
      <div className="pe-places" role="listbox" onPointerDown={() => { touching.current = true; }} onPointerUp={release} onPointerCancel={release} onPointerLeave={release}>
        {found.map((p) => (
          <button key={placeKey(p)} className="pe-place" role="option" onPointerDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
            <MIcon name="oLocationOn" size={18} />
            <span className="grow">
              <span className="ellipsis">{p.name}</span>
              {p.address && <span className="pe-place-sub ellipsis">{p.address}</span>}
            </span>
          </button>
        ))}
      </div>
    )}
  </>;
}

// ---------- Links ----------

/** Linked items both ways, with Graph and Link (LinksSection.kt). */
export function PhoneLinks({ id, s, ensureSaved, onLeave }: { id: number; s: Snapshot; ensureSaved?: () => number; onLeave?: () => void }) {
  const [picking, setPicking] = useState(false);
  const rows: { item: Item; label: string; removable: boolean }[] = [];
  const seen = new Set<number>();
  for (const l of s.links) if (l.sourceId === id && s.byId.has(l.targetId)) { seen.add(l.targetId); rows.push({ item: s.byId.get(l.targetId)!, label: l.auto ? "Mentioned" : "Linked", removable: !l.auto }); }
  for (const l of s.links) if (l.targetId === id && l.sourceId !== id && s.byId.has(l.sourceId) && !seen.has(l.sourceId)) rows.push({ item: s.byId.get(l.sourceId)!, label: l.auto ? "Mentions this" : "Links here", removable: !l.auto });
  const typeIcon = (i: Item) => (i.type === "TASK" ? "oTaskAlt" : i.type === "EVENT" ? "fEvent" : "oDescription");
  return (
    <div className="pe-links">
      <div className="pe-links-head">
        <SectionHeader className="grow">Links</SectionHeader>
        {id !== 0 && <TextButton className="icon" onClick={() => { onLeave?.(); go(`graph?focus=${id}`); }}><MIcon name="oConstellation" size={18} />Graph</TextButton>}
        <TextButton className="icon" onClick={() => setPicking(true)}><MIcon name="oAddLink" size={18} />Link</TextButton>
      </div>
      {rows.length === 0 && <div className="pe-small pad">Connect this to other notes, tasks or events with Link.</div>}
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
          <div key={i.id} className="pe-pick" role="button" onClick={() => { onPick(i.id); close(); }}>
            <span className="pe-dot" style={{ background: s.colorOf(i) }} />
            <span className="ellipsis grow">{i.title || "Untitled"}</span>
            <span className="pe-pick-type">{typeLabel(i)}</span>
          </div>
        ))}
      </div>
    </>}</BottomSheet>
  );
}

// ---------- History (routines) ----------

/** A routine's history and streak, on its own page (shown whatever the Streak badges setting). */
function TaskStats({ item, s }: { item: Item; s: Snapshot }) {
  const t = todayEpoch();
  const st = streak(item, s.done, t);
  const rs = routineStreak(item, s.done, t);
  const done = s.done.days(item.id);
  // The last 30 days (today included), in week columns as before.
  const first = t - 29;
  const gridStart = first - (weekday(first) - 1);
  const weeks = Math.ceil((t - gridStart + 1) / 7);
  return (
    <div className="pe-stats">
      <div className="pe-stats-row">
        <span className="fire">{streakSymbol() && <MIcon name="fLocalFireDepartment" size={20} color="var(--muted)" />} {rs.current} current</span>
        <span>Best {rs.best}</span>
        <span>{Math.round(st.rate30 * 100)}% recent</span><span>{st.total} total</span>
      </div>
      {rs.broken && <div className="pe-small">Last one was missed: the streak starts again</div>}
      <div className="pe-heat">
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w}>
            {Array.from({ length: 7 }, (_, di) => {
              const day = gridStart + w * 7 + di;
              // Today, still open, isn't missed yet.
              const cls = day < first ? "out" : day > t ? "future" : done.has(day) ? "done" : day < t && occursOn(item, day) ? "missed" : "";
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

type FieldEdit = "title" | "when" | "repeat" | "location" | "alarms" | "notifications" | "tags" | "color" | null;

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
  const { defaultTaskTime } = useAlarmSettings();
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
  const routine = isRoutineItem(item);
  const t = todayEpoch();
  const timed = !(item.allDay || item.startMin === null);
  // A routine is about today (or its next day); a missed day isn't something to tick any more.
  const day = occ ?? (isEvent && !routine ? item.startDay : (routine ? routineEntry : currentEntry)(item, s.done, t).day);
  // Tasks are ticked off, and events that are routines.
  const completable = !isEvent || routine;
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
  // A ticked task's alarms and notifications are off (the phone cancels them; see AlarmScheduler), so
  // they're out of sight until it's unticked; they stay saved with it all the same.
  const alerts = !completable || !done;
  const forDay = isRecurring(item) && day !== null ? ` for ${(() => { const r = relativeDay(day); return ["Today", "Tomorrow", "Yesterday"].includes(r) ? r.toLowerCase() : r; })()}` : "";
  const alertLines = (list: Reminder[], kind: string | null) => [...list].sort((a, b) => b.offsetMin - a.offsetMin)
    .map((r) => `${kind ?? (r.type === "REMINDER" ? "Notification" : "Notification (silent)")} · ${offsetLabel(r.offsetMin, item.startMin ?? defaultTaskTime).toLowerCase()}`).join("\n");
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
        <RingingNow itemId={id} />
        <div className="pe-head">
          <button className="pe-bar" style={{ background: color }} aria-label="Colour" onClick={() => setEditing("color")} />
          <div className="grow">
            <button className="pe-title" onClick={() => setEditing("title")}>{item.title.trim() || "Untitled"}</button>
            <span className="p-menu-anchor start">
              <button className="pe-cat" onClick={() => setCatMenu(true)}>{category?.name ?? "No category"}</button>
              <DropdownMenu open={catMenu} onClose={() => setCatMenu(false)} items={categoryItems(s, (c) => commit({ ...item, categoryId: c }))} />
            </span>
          </div>
          {/* Priority is its flag alone (hold it for its name); a tap changes it. */}
          {!isEvent && item.priority > 0 && (
            <span className="p-menu-anchor">
              <IconButton label={priorityLabel(item.priority)} onClick={() => setPrioMenu(true)}><MIcon name="fFlag" color={priorityColor(item.priority)} /></IconButton>
              <DropdownMenu open={prioMenu} onClose={() => setPrioMenu(false)} items={priorityItems((p) => commit({ ...item, priority: p }))} />
            </span>
          )}
        </div>

        {completable && (
          <div className="pe-done" role="button" onClick={() => { if (!done) feel("confirm"); toggleCompletion(id, completion, !done); }}>
            <Checkbox checked={done} color={color} onChange={(v) => { if (v) feel("confirm"); toggleCompletion(id, completion, v); }} />
            <span>{done ? "Done" : "Mark done"}{forDay}</span>
          </div>
        )}

        <InfoRow icon="oSchedule" text={whenText(item, day)} onClick={() => setEditing("when")} />
        {/* The place: a tap shows it in Google Maps, Directions offers the navigation apps, a long press changes it. */}
        {(item.location ?? "").trim() && (
          <InfoRow icon="oLocationOn" text={placeLines(item).main} sub={placeLines(item).sub} link onClick={() => { const l = locationLink(item); if (l) openExternal(l); else openInGoogleMaps(mapsQuery(item)); }}
            onLongPress={() => setEditing("location")} trailing={locationLink(item) ? undefined :
              <IconButton icon="oDirections" label="Directions" className="primary"
                onClick={() => openDirections({ name: placeLines(item).main, address: item.address ?? item.location ?? "", lat: item.lat, lng: item.lng })} />
            } />
        )}
        {alerts && alarms.length > 0 && <EarlyAlarmControls itemId={id} reminders={alarms} />}
        {isRecurring(item) && <InfoRow icon="oRepeat" tint={color} text={describe(item)} onClick={() => setEditing("repeat")} />}
        {/* A game the watch recorded (268): its stats in short; a tap opens Training on that day. */}
        {isEvent && day !== null && (() => {
          const w = training().watchGames.byGame.get(futsalLogId(item.id, day));
          return w ? <InfoRow icon="oAvTimer" tint={color} text={`From the watch · ${statLine(sessionStats(w, venueOf(w, item.title)))}`}
            sub={`${w.time}–${w.endTime}`} onClick={() => go(`training?d=${day}`)} /> : null;
        })()}
        {/* A repeating task can be a routine: on Today's own checklist, missed days only end its streak. */}
        {canBeRoutine(item) && (
          <InfoRow icon="oTaskAlt" tint={routine ? color : undefined} text={routine ? "Routine · on Today's checklist" : "Routine"}
            onClick={() => setRoutine(item, !routine)} trailing={<Switch checked={routine} onChange={(v) => setRoutine(item, v)} label="Routine" />} />
        )}
        {!isEvent && !routine && item.startDay !== null && item.overduePolicy !== "SHOW_OVERDUE" && (
          <span className="p-menu-anchor start wide">
            <InfoRow icon="oSkipNext" text={item.overduePolicy === "CARRY_OVER" ? "If missed, it carries over to the next day" : "If missed, it's skipped"} onClick={() => setOverdueMenu(true)} />
            <DropdownMenu open={overdueMenu} onClose={() => setOverdueMenu(false)} items={overdueItems((p) => commit({ ...item, overduePolicy: p }))} />
          </span>
        )}
        {alerts && alarms.length > 0 && <InfoRow icon="oAlarm" text={alertLines(alarms, "Alarm")} onClick={() => setEditing("alarms")} />}
        {alerts && notifications.length > 0 && <InfoRow icon="oNotifications" text={alertLines(notifications, null)} onClick={() => setEditing("notifications")} />}
        {!alerts && reminders.length > 0 && <InfoRow icon="oAlarmOff" placeholder text={`${reminders.length === 1 ? "Its reminder is" : "Its reminders are"} off while it's done`} />}
        {tags.length > 0 && <InfoRow icon="oLabel" text={tags.map((x) => `#${x.name}`).join("  ")} onClick={() => setEditing("tags")} />}
        {/* The description is written where it shows: plain text, no formatting, saved as it's typed. */}
        <div className="pe-info top pe-descrow">
          <MIcon name="oNotes" size={22} />
          <ViewDescription id={id} content={item.content} />
        </div>

        {/* What it doesn't have yet, one tap away. */}
        <div className="pe-flow pad">
          {!(item.location ?? "").trim() && <AssistChip icon="oLocationOn" label="Location" onClick={() => setEditing("location")} />}
          {alerts && alarms.length === 0 && <AssistChip icon="oAlarm" label="Alarm" onClick={() => setEditing("alarms")} />}
          {alerts && notifications.length === 0 && <AssistChip icon="oNotifications" label="Notification" onClick={() => setEditing("notifications")} />}
          {!isRecurring(item) && <AssistChip icon="oRepeat" label="Repeat" onClick={() => setEditing("repeat")} />}
          {tags.length === 0 && <AssistChip icon="oLabel" label="Tags" onClick={() => setEditing("tags")} />}
          {!isEvent && item.priority === 0 && (
            <span className="p-menu-anchor start">
              <AssistChip icon="oFlag" label="Priority" onClick={() => setPrioMenu(true)} />
              <DropdownMenu open={prioMenu} onClose={() => setPrioMenu(false)} items={priorityItems((p) => commit({ ...item, priority: p }))} />
            </span>
          )}
        </div>

        {/* A routine's own streak and history always show here, whatever the Streak badges setting. */}
        {isRoutineSeries(item) && <><SectionHeader>History</SectionHeader><TaskStats item={item} s={s} /></>}
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
      {(editing === "alarms" || editing === "notifications") && (
        <BottomSheet onClose={() => setEditing(null)}>{() => <>
          <div className="p-sheet-title small">{editing === "alarms" ? "Alarms" : "Notifications"}</div>
          <AlertSection alarms={editing === "alarms"} all={reminders} type={item.type} timed={timed} onChange={commitReminders}
            onDate={item.startDay === null ? (day, min) => commit({ ...item, startDay: day, startMin: min, allDay: false }) : undefined} />
          <AlertsHint className="pad" />
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

function InfoRow({ icon, text, sub, tint, placeholder, onClick, onLongPress, trailing, link }: {
  icon: string; text: string; sub?: string; tint?: string; placeholder?: boolean; onClick?: () => void; onLongPress?: () => void; trailing?: ReactNode; link?: boolean;
}) {
  const { fired, ...hold } = useHold(onLongPress);
  return (
    <div className={`pe-info ${trailing ? "trailing" : ""}`} role={onClick ? "button" : undefined} {...hold}
      onClick={() => { if (!fired()) onClick?.(); }}>
      <MIcon name={icon} size={22} color={tint} />
      <span className={`grow ${placeholder ? "ph" : ""} ${link ? "link" : ""} ${sub ? "two" : ""}`}>
        {text}
        {sub && <span className="pe-info-sub">{sub}</span>}
      </span>
      {trailing && <span className="pe-trail" onClick={(e) => e.stopPropagation()}>{trailing}</span>}
    </div>
  );
}

/** A long press (450 ms, the finger kept within the touch slop): a pick-up pulse, then [onLong]; the tap after it is dropped. */
function useHold(onLong?: () => void) {
  const st = useRef<{ timer: number; x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const clear = () => { if (st.current) clearTimeout(st.current.timer); st.current = null; };
  useEffect(() => clear, []);
  const fired = () => { const f = firedRef.current; firedRef.current = false; return f; };
  if (!onLong) return { fired };
  return {
    fired,
    onPointerDown: (e: React.PointerEvent) => {
      clear();
      firedRef.current = false;
      const h = { timer: 0, x: e.clientX, y: e.clientY };
      h.timer = window.setTimeout(() => { firedRef.current = true; st.current = null; feel("pickup"); onLong(); }, 450);
      st.current = h;
    },
    onPointerMove: (e: React.PointerEvent) => { const h = st.current; if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > TOUCH_SLOP) clear(); },
    onPointerUp: clear,
    onPointerCancel: clear,
    // A right-click is the mouse's long press.
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (mouseMenu(e)) { clear(); onLong(); } },
  };
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
      <SheetButtons onCancel={close} onSave={() => { onSave((d.location ?? "").trim() ? { ...d, location: (d.location ?? "").trim() } : { ...d, ...NO_PLACE }); close(); }} />
    </>}</BottomSheet>
  );
}

/**
 * A description box: plain text in an auto-growing field, no formatting tools. A tap puts the cursor
 * after the last character (where one usually carries on writing); once in, taps place it as usual.
 * A tap on a web link in it opens the link, a long press (or right-click) shows its card.
 */
function DescriptionField({ value, onChange, onBlur }: { value: string; onChange: (v: string) => void; onBlur?: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const toEnd = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const end = () => { const el = ref.current; if (el) { const n = el.value.length; el.setSelectionRange(n, n); } };
  const webLinks = useWebLinks();
  const { onLinkClick, onLinkKey, ...linkHandlers } = useLinkGesture(
    (x, y) => (ref.current ? linkInTextarea(ref.current, x, y) : null), () => (ref.current ? linkAtCaretOf(ref.current) : null), webLinks.act);
  // A field can't colour part of its text, so the links are underlined from a copy laid out behind it.
  const links = findLinks(value);
  let at = 0;
  const under = links.flatMap((l) => { const out = [value.slice(at, l.start), <span key={l.start} className="lnk">{l.text}</span>]; at = l.end; return out; });
  return <>
    <div className="grow pe-desc-box">
      {links.length > 0 && <div className="pe-desc-under" aria-hidden="true">{under}{value.slice(at)}</div>}
      <textarea ref={ref} className="grow pe-desc" rows={1} placeholder="Add description" value={value} autoCapitalize="sentences"
        onFocus={() => { toEnd.current = true; end(); window.setTimeout(() => { toEnd.current = false; }, 500); }}
        onClick={(e) => { if (onLinkClick(e)) { toEnd.current = false; return; } if (toEnd.current) { toEnd.current = false; end(); } }}
        onKeyDown={(e) => { onLinkKey(e); }} {...linkHandlers}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </div>
    {webLinks.card}
  </>;
}

/**
 * The view's description, saved shortly after typing stops, on leaving the field or the page, and when
 * the app is put away. Only a changed text is written back, so a rich description that's only looked at
 * keeps its formatting.
 */
function ViewDescription({ id, content }: { id: number; content: string }) {
  const [text, setText] = useState(() => descriptionText(content));
  const base = useRef({ html: content, text });
  const latest = useRef(text);
  latest.current = text;
  const timer = useRef<number>();
  const save = () => {
    clearTimeout(timer.current);
    const t = latest.current;
    if (t === base.current.text) return;
    const cur = snapshot().byId.get(id);
    if (!cur) return;
    const html = plainToHtml(t);
    base.current = { html, text: t };
    if (html !== cur.content) saveItem({ ...cur, content: html });
  };
  // Changed elsewhere (another device) while this one has nothing unsaved: show that.
  useEffect(() => {
    if (content === base.current.html || latest.current !== base.current.text) return;
    const t = descriptionText(content);
    base.current = { html: content, text: t };
    setText(t);
  }, [content]);
  useEffect(() => { const off = onFlush(save); return () => { off(); save(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <DescriptionField value={text} onBlur={save} onChange={(v) => { setText(v); latest.current = v; clearTimeout(timer.current); timer.current = window.setTimeout(save, 700); }} />;
}

// ---------- The full editor ----------

/** The copy "Duplicate" (or an opened invitation) opens the editor with; nothing is saved until Save. */
let duplicateSeed: Draft | null = null;

/** Opens the full editor on a new, unsaved item (a calendar invitation): it's added only on Save. */
export function openNewDraft(draft: Draft) {
  duplicateSeed = draft;
  go(`item/0?edit=1&dup=1&n=${Date.now()}`);
}

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
  const isNew = !original;
  // Several changes in one tap each build on the last (the prop only updates on the next render). On a
  // new item, reminders still as they started follow its date and time (a time added: 30 minutes before).
  const emit = (n: Draft) => {
    const prev = curRef.current;
    if (isNew && n.reminders === prev.reminders) n = { ...n, reminders: followDefaults(prev.reminders, prev.item, n.item) };
    curRef.current = n;
    if (onDraft) onDraft(n); else setLocal(n);
  };
  const d = cur.item;
  const set = (patch: Partial<Item>) => emit({ ...curRef.current, item: { ...curRef.current.item, ...patch } });
  const isEvent = d.type === "EVENT";
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [colorDialog, setColorDialog] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [deleteMenu, setDeleteMenu] = useState(false);
  // The description, edited as plain text; written into the draft only once it's changed.
  const [descStart] = useState(() => ({ html: d.content, text: descriptionText(d.content) }));
  const [notes, setNotes] = useState(descStart.text);
  const [currentId, setCurrentId] = useState(id);
  // The Routine switch: the task's synced `routine` field, saved with it.
  const routine = d.routine === true;
  const setRoutineDraft = (on: boolean) => set({ routine: on });
  const routinable = canBeRoutine(d);
  const category = d.categoryId !== null ? s.categoryById.get(d.categoryId) : undefined;
  const color = d.color !== null ? cssColor(d.color) : category ? cssColor(category.color) : s.colorOf({ ...d, categoryId: null, color: null });
  const tagList = () => cur.tags.split(/[\s,]+/).map((x) => x.replace(/^#/, "")).filter(Boolean);
  const timed = !(d.allDay || d.startMin === null);
  // A to-do without a date: its reminders' rows offer to pick one (they can't ring before).
  const pickWhen = d.type === "TASK" && d.startDay === null ? (day: number, min: number) => set({ startDay: day, startMin: min, allDay: false }) : undefined;
  /** From the panel, going elsewhere in the app means closing the panel first. */
  const leaveTo = () => { if (draft) onClose(); };

  const finalItem = (): Item => {
    const html = d.content;
    let it: Item = { ...d, title: d.title.trim(), content: preview(html, 10).trim() ? html : "", location: (d.location ?? "").trim() };
    it = it.type === "EVENT" ? tidyWhen(it) : { ...it, endDay: null, endMin: null, allDay: false };
    if (it.freq !== "NONE" && it.startDay === null) it.startDay = todayEpoch();
    return it;
  };
  const save = (scope?: EditScope) => {
    const item = finalItem();
    if (original && isRecurring(original) && occ !== null && !scope) { setScopeOpen(true); return; }
    // Only a repeating task (or one day of one) can be a routine; one that stops repeating loses the mark.
    if (item.routine && !canBeRoutine(item)) item.routine = false;
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
        {routinable && (
          <FieldRow icon="oTaskAlt" onClick={() => setRoutineDraft(!routine)}>
            <span className="pe-label grow">Routine<span className="pe-sublabel">On Today's checklist; a missed day ends the streak instead of piling up</span></span>
            <Switch checked={routine} onChange={setRoutineDraft} label="Routine" />
          </FieldRow>
        )}
        <div className="p-divider" />

        <LocationField d={d} set={set} />
        <div className="p-divider" />

        <AlertSection alarms all={cur.reminders} type={d.type} timed={timed} onChange={(r) => emit({ ...curRef.current, reminders: r })} onDate={pickWhen} />
        <div className="p-divider" />
        <AlertSection alarms={false} all={cur.reminders} type={d.type} timed={timed} onChange={(r) => emit({ ...curRef.current, reminders: r })} onDate={pickWhen} />
        <AlertsHint className="indent" />
        <div className="p-divider" />

        <FieldRow icon="oPalette">
          <span className="grow"><MenuText text={category?.name ?? "No category"} items={categoryItems(s, (c) => set({ categoryId: c }), leaveTo)} /></span>
          <TextButton className="icon" onClick={() => setColorDialog(true)}><span className="pe-dot" style={{ background: color }} />{d.color === null ? "Category colour" : "Own colour"}</TextButton>
        </FieldRow>
        {!isEvent && <>
          <FieldRow icon="oFlag">
            <MenuText text={d.priority === 0 ? "No priority" : <MIcon name="fFlag" color={priorityColor(d.priority)} />}
              label={d.priority === 0 ? undefined : priorityLabel(d.priority)} items={priorityItems((p) => set({ priority: p }))} />
          </FieldRow>
          {/* A routine is never overdue (a missed day ends its streak), so it has no "if missed" choice. */}
          {d.startDay !== null && !(routinable && routine) && (
            <FieldRow icon="oUpdate">
              <MenuText text={overdueText(d.overduePolicy)} items={overdueItems((p) => set({ overduePolicy: p }))} />
            </FieldRow>
          )}
        </>}
        <div className="p-divider" />

        {/* The description: one line until written in, growing with the text. */}
        <FieldRow icon="oNotes" top>
          <DescriptionField value={notes} onChange={(v) => { setNotes(v); set({ content: v === descStart.text ? descStart.html : plainToHtml(v) }); }} />
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

