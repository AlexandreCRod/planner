// The phone's Settings, Categories and Trash pages, laid out like SettingsScreen.kt and
// TrashCategories.kt: section headers, Material 3 list rows with switches or a menu of choices, and
// dialogs. Settings this build can't act on (backups, the widget, calendar import, wallpaper colours) are
// left out. Values are the same local keys the PC settings use.
import { useEffect, useState } from "react";
import { type ClockFormat, DATE_STYLES, type DateStyle, clockFormat, dateStyle, formatDateTime } from "../../domain/dates.ts";
import { RETENTION_TEXT, TRASH_DAYS } from "../../domain/retention.ts";
import { type AlertType, type Category, cssColor } from "../../domain/types.ts";
import { changed, deleteCategory, deleteForever, emptyTrash, restore, saveCategory, useSnapshot } from "../../store/store.ts";
import { resetLocal, signOut, syncNow } from "../../store/sync.ts";
import { STREAK_STYLES, type StreakStyle, setStreakStyle, streakStyle } from "../../store/routines.ts";
import { carryOver } from "../../store/prefs.ts";
import { getServer, isNative, setServer } from "../../platform.ts";
import { typeLabel } from "../LinksSection.tsx";
import { checkedLinger, go, showDoneOnToday } from "../common.tsx";
import { applyTheme, useSyncStatus } from "../SettingsView.tsx";
import { Dialog, DropdownMenu, EmptyHint, IconButton, MIcon, Scaffold, SectionHeader, Segmented } from "./chrome.tsx";
import { BAR_REVERSED_KEY, barSwipeReversed } from "./pager.ts";
import { ColorGrid, ListItem, OutlinedButton, OutlinedTextField, PALETTE, Switch, TextButton, TextFieldDialog, showSnackbar } from "./m3.tsx";
import { checkForUpdate, installedVersion } from "./update.ts";
import { applyPureBlack } from "./theme.ts";
import { TimePickerDialog } from "./pickers.tsx";
import { ensureNotifications } from "./PhoneAlarms.tsx";
import { act, hasAlarms, native, useAlarmState } from "../../alarms/native.ts";
import { ALARM_RING_CHOICES, CLOCK_RING_CHOICES, SNOOZE_CHOICES, setAlarmSettings, useAlarmSettings } from "../../alarms/settings.ts";
import { formatTime } from "../../domain/dates.ts";
import { count } from "../../domain/plural.ts";

/** The native accents (Theme.kt `accents`), in the native order, by their light colour. */
const ACCENTS: [string, string][] = [
  ["Blue", "#1a73e8"], ["Teal", "#00796b"], ["Rose", "#b0285a"], ["Amber", "#8b5000"], ["Forest", "#2e7d32"],
  ["Violet", "#6a3db8"], ["Ocean", "#0061a4"], ["Slate", "#4f5b66"], ["Indigo", "#3f51b5"],
];
const CLOCKS: [ClockFormat, string][] = [["system", "Phone setting"], ["24", "24-hour (15:30)"], ["12", "12-hour (3:30 PM)"]];
const LINGER: [string, string][] = [["-1", "Stay until you leave the page"], ["10", "Move away after 10 seconds"], ["5", "Move away after 5 seconds"], ["3", "Move away after 3 seconds"], ["1", "Move away after 1 second"], ["0", "Move away right away"]];

const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** A row that opens a menu of choices under it (DropdownRow). */
function ChoiceRow<T extends string>({ title, value, options, onPick }: { title: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-menu-anchor start wide">
      <ListItem headline={title} supporting={options.find(([k]) => k === value)?.[1] ?? ""} onClick={() => setOpen(true)} />
      <DropdownMenu open={open} onClose={() => setOpen(false)} items={options.map(([k, l]) => ({ label: l, checked: k === value, onClick: () => onPick(k) }))} />
    </div>
  );
}

function SwitchRow({ title, checked, onChange, supporting }: { title: string; checked: boolean; onChange: (v: boolean) => void; supporting?: string }) {
  return <ListItem headline={title} supporting={supporting} trailing={<Switch checked={checked} onChange={onChange} label={title} />} onClick={() => onChange(!checked)} />;
}

const SNOOZES: [string, string][] = SNOOZE_CHOICES.map((m) => [String(m), `${m} min`]);
const minutesChoice = (m: number): [string, string] => [String(m), m === 1 ? "1 minute" : `${m} minutes`];

/**
 * "Reminders & alarms": whether event and task alarms ring on this phone (on by default), the alarm
 * defaults, quiet hours, the world clock's weather app and the permissions alarms need. Phone build only; kept on this phone, not synced.
 */
function AlarmSettingsSection() {
  const st = useAlarmSettings();
  const { ring, perms, weatherApp } = useAlarmState();
  const [time, setTime] = useState<"" | "task" | "qs" | "qe">("");
  const pickSound = async () => {
    const r = await native.pickSound(st.defaultAlarmSound, "Default alarm sound");
    if (r.picked) setAlarmSettings({ defaultAlarmSound: r.uri ?? null, defaultAlarmSoundName: r.uri ? r.name ?? null : null });
  };
  const ringText = ring.rings ? "Clock alarms, timers and the stopwatch always work"
    : "Off: events and tasks stay silent here. Clock alarms, timers and the stopwatch still work";
  return <>
    <div className="p-hr" />
    <SectionHeader>Reminders &amp; alarms</SectionHeader>
    <SwitchRow title="Ring event and task alarms on this phone" supporting={ringText} checked={ring.rings}
      onChange={(v) => void act(native.setRingEvents(v))} />
    <ListItem headline="Time for untimed reminders" supporting={<span className="ps-pre">{`${formatTime(st.defaultTaskTime)}\nUsed for tasks without a time and all-day events`}</span>} onClick={() => setTime("task")} />
    <ListItem headline="Default alarm sound" supporting={st.defaultAlarmSound == null ? "System alarm" : st.defaultAlarmSoundName ?? "Custom"} onClick={() => void pickSound()} />
    <ChoiceRow title="Snooze length" value={String(st.snoozeMinutes)} options={SNOOZES} onPick={(v) => setAlarmSettings({ snoozeMinutes: Number(v) })} />
    <ChoiceRow title="Event and task alarms ring for" value={String(st.alarmRingMinutes)} options={ALARM_RING_CHOICES.map(minutesChoice)}
      onPick={(v) => setAlarmSettings({ alarmRingMinutes: Number(v) })} />
    <ChoiceRow title="Clock alarms and timers ring for" value={String(st.clockRingMinutes)} options={CLOCK_RING_CHOICES.map(minutesChoice)}
      onPick={(v) => setAlarmSettings({ clockRingMinutes: Number(v) })} />
    <SwitchRow title="Upcoming alarm notice" checked={st.upcomingAlarms} onChange={(v) => setAlarmSettings({ upcomingAlarms: v })}
      supporting="2 hours before an alarm, a notification lets you snooze or stop it. From 23 hours before, the task or event itself has those buttons" />
    <SwitchRow title="Quiet hours" supporting="Reminders arrive silently; alarms still ring" checked={st.quietHoursEnabled} onChange={(v) => setAlarmSettings({ quietHoursEnabled: v })} />
    {st.quietHoursEnabled && <>
      <ListItem headline="Quiet from" supporting={formatTime(st.quietStart)} onClick={() => setTime("qs")} />
      <ListItem headline="Quiet until" supporting={formatTime(st.quietEnd)} onClick={() => setTime("qe")} />
    </>}
    <ListItem headline="Weather app" supporting={weatherApp ? `${weatherApp} — opens from the world clock` : "None — the world clock opens a weather page"}
      onClick={() => void act(native.pickWeatherApp())}
      trailing={weatherApp ? <IconButton icon="fClose" label="Forget the weather app" onClick={() => void act(native.clearWeatherApp())} /> : undefined} />
    <ListItem headline="Notification permission" supporting={perms.notifications ? "Allowed" : "Blocked — tap to fix"}
      onClick={() => void (perms.notifications ? native.openSettings("notifications") : ensureNotifications("Alarms, reminders and timers show and ring through notifications, so this app needs them allowed."))} />
    <ListItem headline="Full-screen alarms" supporting={perms.fullScreen ? "Allowed" : "Not allowed — tap to fix"} onClick={() => void native.openSettings("fullScreen")} />
    {!perms.exact && <ListItem headline="Alarms & reminders" supporting="Not allowed — tap to fix, or alarms may ring late" onClick={() => void native.openSettings("exact")} />}
    <ListItem headline="Battery optimization" supporting={perms.batteryExempt ? "Not optimized: alarms are never delayed" : "Exclude this app so alarms are never delayed"} onClick={() => void native.openSettings("battery")} />
    {time && (
      <TimePickerDialog value={time === "task" ? st.defaultTaskTime : time === "qs" ? st.quietStart : st.quietEnd} onClose={() => setTime("")}
        onPick={(m) => setAlarmSettings(time === "task" ? { defaultTaskTime: m } : time === "qs" ? { quietStart: m } : { quietEnd: m })} />
    )}
  </>;
}

/** "Check for updates": the installed version; a tap asks GitHub now (update.ts), whatever was dismissed. */
function UpdateRow() {
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => { void installedVersion().then(setVersion); }, []);
  const check = async () => {
    if (checking) return;
    setChecking(true);
    const r = await checkForUpdate(true);
    setChecking(false);
    if (r === "current") showSnackbar("You're up to date");
    else if (r === "failed") showSnackbar("Couldn't check for updates");
  };
  return <>
    <div className="p-hr" />
    <SectionHeader>About</SectionHeader>
    <ListItem headline="Check for updates" supporting={checking ? "Checking…" : version ? `Version ${version}` : ""} onClick={() => void check()} />
  </>;
}

export function PhoneSettings() {
  const sync = useSyncStatus();
  const [theme, setTheme] = useState(localStorage.getItem("theme") ?? "system");
  const [accent, setAccent] = useState((localStorage.getItem("accent") ?? "#1a73e8").toLowerCase());
  const [pureBlack, setPureBlack] = useState(localStorage.getItem("pureBlack") === "true");
  const [barReversed, setBarReversed] = useState(barSwipeReversed());
  const [monday, setMonday] = useState(localStorage.getItem("weekStartsMonday") !== "false");
  const [clock, setClock] = useState<ClockFormat>(clockFormat());
  const [dates, setDates] = useState<DateStyle>(dateStyle());
  const [linger, setLinger] = useState(String(checkedLinger()));
  const [showDone, setShowDone] = useState(showDoneOnToday());
  const [streaks, setStreaks] = useState<StreakStyle>(streakStyle());
  const [carry, setCarry] = useState(carryOver());
  const [dialog, setDialog] = useState<"" | "server" | "signout">("");
  const [server, setServerShown] = useState(getServer());
  const [busy, setBusy] = useState(false);

  useEffect(() => { store("theme", theme); store("accent", accent); applyTheme(); }, [theme, accent]);
  useEffect(() => { store("pureBlack", String(pureBlack)); applyPureBlack(); }, [pureBlack]);
  /** A display setting: kept, then every page redrawn with it. */
  const redraw = (k: string, v: string) => { store(k, v); changed(true); };

  const status = sync.state === "syncing" ? "Syncing…"
    : sync.state === "signed-out" ? "Signed out"
    : `Last sync: ${sync.lastSyncAt ? formatDateTime(sync.lastSyncAt) : "never"}${sync.message ? `\n${sync.message}` : ""}`;

  return (
    <Scaffold title="Settings" back flush>
      <div className="p-content ps">
        <SectionHeader>Appearance</SectionHeader>
        <div className="ps-pad">
          <Segmented value={theme} options={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]} onChange={setTheme} />
          <div className="ps-label">Accent color</div>
          <div className="ps-accents">
            {ACCENTS.map(([name, c]) => (
              <button key={c} className="ps-accent" aria-label={name} aria-pressed={accent === c} onClick={() => setAccent(c)}>
                <span className={`ps-swatch ${accent === c ? "on" : ""}`} style={{ background: c }}>{accent === c && <MIcon name="fCheck" color="#fff" />}</span>
                <span className="ps-name">{name}</span>
              </button>
            ))}
          </div>
        </div>
        <SwitchRow title="Pure black dark mode" supporting="Saves battery on OLED screens" checked={pureBlack} onChange={setPureBlack} />
        <SwitchRow title="Reverse bottom bar swipe" supporting={barReversed ? "Sliding right along the bar goes to the page on the left, like swiping the pages"
          : "Sliding right along the bar goes to the page on the right, the indicator under the finger"} checked={barReversed}
          onChange={(v) => { setBarReversed(v); store(BAR_REVERSED_KEY, String(v)); }} />

        <div className="p-hr" />
        <SectionHeader>Calendar</SectionHeader>
        <SwitchRow title="Week starts on Monday" checked={monday} onChange={(v) => { setMonday(v); redraw("weekStartsMonday", String(v)); }} />
        {/* In the app, times follow the phone's own 24-hour setting (Android's Date & time settings). */}
        {!isNative && <ChoiceRow title="Time format" value={clock} options={CLOCKS} onPick={(v) => { setClock(v); redraw("clockFormat", v); }} />}
        <ChoiceRow title="Date format" value={dates} options={DATE_STYLES} onPick={(v) => { setDates(v); redraw("dateFormat", v); }} />

        <div className="p-hr" />
        <SectionHeader>Tasks</SectionHeader>
        <ChoiceRow title="Checked tasks" value={linger} options={LINGER} onPick={(v) => { setLinger(v); store("checkedLinger", v); }} />
        <SwitchRow title="Carry unfinished tasks over to today" supporting="Off: a missed task stays on its own day. Routines never carry over" checked={carry}
          onChange={(v) => { setCarry(v); redraw("carryOver", String(v)); }} />
        <SwitchRow title="Show completed tasks on Today" supporting="Off: ticked tasks leave today's list once their moment is up" checked={showDone}
          onChange={(v) => { setShowDone(v); redraw("showDoneOnToday", String(v)); }} />
        {/* Each routine's days-in-a-row on Today, the task lists and its history. */}
        <ChoiceRow title="Streaks" value={streaks} options={STREAK_STYLES} onPick={(v) => { setStreaks(v); setStreakStyle(v); }} />

        {hasAlarms && <AlarmSettingsSection />}

        <div className="p-hr" />
        <SectionHeader>Cloud sync</SectionHeader>
        <ListItem headline="Server" supporting={server || "Not set"} onClick={() => setDialog("server")} />
        <ListItem headline="Status" supporting={<span className="ps-pre">{status}</span>} />
        <div className="ps-buttons">
          <OutlinedButton disabled={busy || sync.state === "signed-out"} onClick={async () => { setBusy(true); await syncNow(); setBusy(false); }}>Sync now</OutlinedButton>
          <OutlinedButton onClick={() => setDialog("signout")}>Sign out</OutlinedButton>
        </div>

        <div className="p-hr" />
        <SectionHeader>Data</SectionHeader>
        <ListItem headline="Categories" supporting="Names, colors and default reminder types" onClick={() => go("settings/categories")} />
        <ListItem headline="Trash" supporting={<span className="ps-pre">{`Restore or permanently delete items\nKept ${TRASH_DAYS} days`}</span>} onClick={() => go("settings/trash")} />
        {isNative && <UpdateRow />}
        <div className="p-endspace" />
      </div>

      {dialog === "server" && (
        <TextFieldDialog title="Server" label="Server URL" initial={server} onClose={() => setDialog("")}
          onSave={(u) => { setServer(u); setServerShown(getServer()); void syncNow(); }} />
      )}
      {dialog === "signout" && (
        <Dialog title="Sign out?" onClose={() => setDialog("")} actions={<>
          <TextButton onClick={() => setDialog("")}>Cancel</TextButton>
          <TextButton onClick={async () => { await resetLocal(); signOut(); location.reload(); }}>Sign out</TextButton>
        </>}>This removes this phone's copy. Your data stays on the server and your other devices.</Dialog>
      )}
    </Scaffold>
  );
}

// ---------- Categories ----------

export function PhoneCategories() {
  const s = useSnapshot();
  const [editing, setEditing] = useState<Category | null>(null);
  return (
    <Scaffold title="Categories" back flush>
      <div className="p-content ps">
        {s.categories.length === 0 && <EmptyHint>No categories yet.</EmptyHint>}
        {s.categories.map((c) => (
          <ListItem key={c.id} headline={c.name} leading={<span className="ps-dot" style={{ background: cssColor(c.color) }} />}
            supporting={`Default reminder: ${c.defaultAlert.toLowerCase()} · ${count(s.items.filter((i) => i.categoryId === c.id).length, "item")}`}
            onClick={() => setEditing(c)} />
        ))}
        <div className="p-endspace" />
      </div>
      <button className="p-fab ps-fab" aria-label="Add category" onClick={() => setEditing({ id: 0, name: "", color: PALETTE[7], defaultAlert: "REMINDER" })}><MIcon name="fAdd" /></button>
      {editing && <CategoryDialog c={editing} onClose={() => setEditing(null)} />}
    </Scaffold>
  );
}

function CategoryDialog({ c, onClose }: { c: Category; onClose: () => void }) {
  const [name, setName] = useState(c.name);
  const [color, setColor] = useState(c.color);
  const [alert, setAlert] = useState<AlertType>(c.defaultAlert);
  const save = () => { if (!name.trim()) return; saveCategory({ ...c, name: name.trim(), color, defaultAlert: alert }); onClose(); };
  return (
    <Dialog title={c.id === 0 ? "New category" : "Edit category"} onClose={onClose} actions={<>
      {c.id !== 0 ? <TextButton onClick={() => { deleteCategory(c); onClose(); }}>Delete</TextButton> : <TextButton onClick={onClose}>Cancel</TextButton>}
      <TextButton disabled={!name.trim()} onClick={save}>Save</TextButton>
    </>}>
      <div className="ps-catdialog">
        <OutlinedTextField label="Name" value={name} onChange={setName} autoFocus={c.id === 0} onEnter={save} />
        <ColorGrid colors={PALETTE} selected={color} allowNone={false} onPick={(v) => { if (v !== null) setColor(v); }} />
        <div className="ps-label">Default reminder type</div>
        <Segmented value={alert} options={[["NOTIFICATION", "Notification"], ["REMINDER", "Reminder"], ["ALARM", "Alarm"]]} onChange={setAlert} />
      </div>
    </Dialog>
  );
}

// ---------- Trash ----------

export function PhoneTrash() {
  const s = useSnapshot();
  const [confirm, setConfirm] = useState<"all" | number | null>(null);
  const icon = (t: string) => (t === "TASK" ? "oTaskAlt" : t === "EVENT" ? "fEvent" : "oDescription");
  return (
    <Scaffold title="Trash" back flush actions={s.trash.length > 0 ? <TextButton onClick={() => setConfirm("all")}>Empty</TextButton> : undefined}>
      <div className="p-content ps">
        <div className="pe-small ps-note">{RETENTION_TEXT}</div>
        {s.trash.length === 0 && <div className="ps-empty">Trash is empty.</div>}
        {s.trash.map((i) => (
          <ListItem key={i.id} headline={<span className="ellipsis">{i.title || "Untitled"}</span>} leading={<MIcon name={icon(i.type)} />}
            supporting={`${typeLabel(i)} · deleted ${formatDateTime(i.deletedAt ?? 0)}`}
            trailing={<span className="ps-trail">
              <IconButton icon="oRestoreFromTrash" label="Restore" onClick={() => restore(i.id)} />
              <IconButton icon="oDeleteForever" label="Delete forever" onClick={() => setConfirm(i.id)} />
            </span>} />
        ))}
        <div className="p-endspace" />
      </div>
      {confirm === "all" && (
        <Dialog title="Empty trash?" onClose={() => setConfirm(null)} actions={<>
          <TextButton onClick={() => setConfirm(null)}>Cancel</TextButton>
          <TextButton onClick={() => { emptyTrash(); setConfirm(null); }}>Delete forever</TextButton>
        </>}>{count(s.trash.length, "item")} will be permanently deleted. This cannot be undone (except from a backup).</Dialog>
      )}
      {typeof confirm === "number" && (
        <Dialog title="Delete forever?" onClose={() => setConfirm(null)} actions={<>
          <TextButton onClick={() => setConfirm(null)}>Cancel</TextButton>
          <TextButton onClick={() => { deleteForever(confirm); setConfirm(null); }}>Delete</TextButton>
        </>}>This cannot be undone (except from a backup).</Dialog>
      )}
    </Scaffold>
  );
}
