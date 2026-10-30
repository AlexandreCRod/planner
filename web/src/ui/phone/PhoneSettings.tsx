// The phone's Settings, Categories and Trash pages, laid out like SettingsScreen.kt and
// TrashCategories.kt: section headers, Material 3 list rows with switches or a menu of choices, and
// dialogs. Settings this build can't act on (the widget, wallpaper colours) are
// left out. Values are the same local keys the PC settings use.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useKeep, useKeptScroll } from "./keep.ts";
import { type ClockFormat, DATE_STYLES, type DateStyle, clockFormat, dateStyle, formatClock, formatDate, formatDateTime } from "../../domain/dates.ts";
import { RETENTION_TEXT, TRASH_DAYS } from "../../domain/retention.ts";
import { type AlertType, type Category, cssColor } from "../../domain/types.ts";
import { changed, deleteCategory, deleteForever, emptyTrash, restore, saveCategory, useSnapshot } from "../../store/store.ts";
import { confirmDeletes, resetLocal, restoreDeletes, serverStorageBytes, signOut, syncNow } from "../../store/sync.ts";
import { sizeText, STORAGE_LIMIT, storageUse } from "../../domain/storage.ts";
import { type Problem, clearProblems, onProblems, problems, problemsText } from "../../problems.ts";
import { STREAK_STYLES, type StreakStyle, setStreakStyle, streakStyle } from "../../store/routines.ts";
import { carryOver } from "../../store/prefs.ts";
import { getServer, isNative, isTestApp, setServer, useWide } from "../../platform.ts";
import { resetSample } from "../../store/sample.ts";
import { type BackupFile, applyRestore, backUpNow, lastBackupAt, listBackups, planRestore, readBackup, readBackupFile } from "../../store/backup.ts";
import type { Backup, RestorePlan } from "../../domain/backup.ts";
import { notificationsEnabled, setNotificationsEnabled } from "../../notify.ts";
import { typeLabel } from "../shared/kinds.ts";
import { checkedLinger, go, showDoneOnToday } from "../shared/common.tsx";
import { applyTheme, useSyncStatus } from "../shared/settings.ts";
import { Dialog, DropdownMenu, EmptyHint, IconButton, MIcon, Scaffold, SectionHeader, Segmented } from "./chrome.tsx";
import { BAR_REVERSED_KEY, barSwipeReversed, setKeepTasksTab, useKeepTasksTab } from "./pager.ts";
import { ColorGrid, ListItem, OutlinedButton, OutlinedTextField, PALETTE, Switch, TextButton, TextFieldDialog, showSnackbar } from "./m3.tsx";
import { checkForUpdate, installedVersion } from "./update.ts";
import { applyPureBlack } from "./theme.ts";
import { TimePickerDialog } from "./pickers.tsx";
import { ensureNotifications } from "./PhoneAlarms.tsx";
import { act, hasAlarms, native, useAlarmState } from "../../alarms/native.ts";
import { ALARM_RING_CHOICES, CLOCK_RING_CHOICES, SNOOZE_CHOICES, setAlarmSettings, useAlarmSettings } from "../../alarms/settings.ts";
import { formatTime } from "../../domain/dates.ts";
import { count } from "../../domain/plural.ts";
import { StreaksSheet } from "./StreaksSheet.tsx";
import { canUseHealth, connect, disconnect, healthFound, readNow, useHealth } from "../../health/healthConnect.ts";
import { watchStatus } from "../../domain/healthRead.ts";
import { LOOKS, type LookKey, look, setLook, useLooks } from "./looks.ts";
import { canImportCalendars } from "../../store/phoneCalendar.ts";
import { isSportsCategory } from "../../domain/training.ts";

/** The native accents (Theme.kt `accents`), in the native order, by their light colour. */
const ACCENTS: [string, string][] = [
  ["Blue", "#1a73e8"], ["Teal", "#00796b"], ["Rose", "#b0285a"], ["Amber", "#8b5000"], ["Forest", "#2e7d32"],
  ["Violet", "#6a3db8"], ["Ocean", "#0061a4"], ["Slate", "#4f5b66"], ["Indigo", "#3f51b5"],
];
const CLOCKS: [ClockFormat, string][] = [["system", "Phone setting"], ["24", "24-hour (15:30)"], ["12", "12-hour (3:30 PM)"]];
const LINGER: [string, string][] = [["-1", "Stay until you leave the page"], ["10", "Move away after 10 seconds"], ["5", "Move away after 5 seconds"], ["3", "Move away after 3 seconds"], ["1", "Move away after 1 second"], ["0", "Move away right away"]];

const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** A row that opens a menu of choices under it (DropdownRow). */
function ChoiceRow<T extends string>({ title, value, options, onPick, supporting }: {
  title: ReactNode; value: T; options: [T, string][]; onPick: (v: T) => void;
  /** The line under the title (else the chosen option's label). */
  supporting?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-menu-anchor start wide">
      <ListItem headline={title} supporting={supporting ?? options.find(([k]) => k === value)?.[1] ?? ""} onClick={() => setOpen(true)} />
      <DropdownMenu open={open} onClose={() => setOpen(false)} items={options.map(([k, l]) => ({ label: l, checked: k === value, onClick: () => onPick(k) }))} />
    </div>
  );
}

function SwitchRow({ title, checked, onChange, supporting }: { title: string; checked: boolean; onChange: (v: boolean) => void; supporting?: string }) {
  return <ListItem headline={title} supporting={supporting} trailing={<Switch checked={checked} onChange={onChange} label={title} />} onClick={() => onChange(!checked)} />;
}

/**
 * Which categories count as sport on Training (278): a switch for each, one or several. Until the user
 * picks, a category whose name has the word sport is on (isSportsCategory); a pick is kept on the category,
 * so it syncs with it.
 */
function SportsSection() {
  const s = useSnapshot();
  if (!s.categories.length) return null;
  return <>
    <div className="p-hr" />
    <SectionHeader>Training</SectionHeader>
    <div className="pe-small ps-note">Counts as sport on Training: the events of the categories switched on show there as games, futsal when the title says so.</div>
    {s.categories.map((c) => {
      const on = isSportsCategory(c);
      const set = (v: boolean) => saveCategory({ ...c, sport: v });
      return <ListItem key={c.id} headline={c.name} leading={<span className="ps-dot" style={{ background: cssColor(c.color) }} />}
        trailing={<Switch checked={on} onChange={set} label={`${c.name}: counts as sport on Training`} />} onClick={() => set(!on)} />;
    })}
  </>;
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

/** "Server storage": how full the sync server is, with a thin meter, and a warning from 80% (212). Asked again after each sync. */
function StorageRow({ syncedAt }: { syncedAt: number }) {
  const [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => { void serverStorageBytes().then(setBytes); }, [syncedAt]);
  if (bytes === null) return null;
  const use = storageUse(bytes);
  return <ListItem headline="Server storage" supporting={<>
    <span className={use.warn ? "ps-warn" : undefined}>{use.text}</span>
    <span className={`ps-meter${use.warn ? " warn" : ""}`}><i style={{ width: `${Math.max(use.share * 100, 1)}%` }} /></span>
    {use.warn && <span className="ps-pre">{`Almost full. At ${sizeText(STORAGE_LIMIT)} new changes can't be saved; everything already there can still be read.`}</span>}
  </>} />;
}

/**
 * The phone only, with Health Connect: reading the watch's data on or off, what it found last (the last run
 * and night, or how to let Garmin Connect share when nothing came from it), and "Read now" with the last read (253).
 */
function HealthRow() {
  const h = useHealth();
  if (!canUseHealth(h)) return null;
  const last = h.lastRead === null ? "" : new Date(h.lastRead).toDateString() === new Date().toDateString() ? formatClock(h.lastRead) : formatDateTime(h.lastRead);
  const status = watchStatus(healthFound(), formatDate);
  const supporting = !h.on ? "Your watch's runs, sleep and daily data, from Health Connect"
    : h.error ? `Couldn't read: ${h.error}`
    : !h.granted && h.status === "available" && h.lastRead !== null ? "No permission now: turn off and on again to allow"
    : h.lastRead === null ? (h.reading ? "Reading…" : "Not read yet")
    : status.fix ? `${status.text}\n${status.fix}` : status.text;
  return <>
    <SwitchRow title="Watch data (Health Connect)" supporting={supporting} checked={h.on} onChange={(v) => { if (v) void connect(); else disconnect(); }} />
    {h.on && <ListItem headline="Read now" onClick={() => void readNow()}
      supporting={h.reading ? "Reading…" : last ? `Last read ${last}${h.failed ? ", some data still to come" : ""}` : ""} />}
  </>;
}

/** "Check for updates": the installed version; a tap asks GitHub now (update.ts), whatever was dismissed. */
function UpdateRow() {
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => { void installedVersion().then(setVersion); }, []);
  const check = async () => {
    if (checking) return;
    if (isTestApp()) { showSnackbar("Planner Test is updated by hand, not from GitHub"); return; }
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
  const keepTasks = useKeepTasksTab();
  const [monday, setMonday] = useState(localStorage.getItem("weekStartsMonday") !== "false");
  const [clock, setClock] = useState<ClockFormat>(clockFormat());
  const [dates, setDates] = useState<DateStyle>(dateStyle());
  const [linger, setLinger] = useState(String(checkedLinger()));
  const [showDone, setShowDone] = useState(showDoneOnToday());
  const [streaks, setStreaks] = useState<StreakStyle>(streakStyle());
  const [carry, setCarry] = useState(carryOver());
  const [streaksOpen, setStreaksOpen] = useState(false);
  const [dialog, setDialog] = useState<"" | "server" | "signout" | "sample">("");
  const [server, setServerShown] = useState(getServer());
  const [busy, setBusy] = useState(false);
  // The PC: reminders pop up from the page (notify.ts) once the browser may show notifications.
  const [notify, setNotify] = useState(notificationsEnabled);
  const wide = useWide();

  useEffect(() => { store("theme", theme); store("accent", accent); applyTheme(); }, [theme, accent]);
  useEffect(() => { store("pureBlack", String(pureBlack)); applyPureBlack(); }, [pureBlack]);
  // Back from Categories or Trash finds Settings scrolled where it was.
  const keep = useKeep();
  const box = useRef<HTMLDivElement>(null);
  useKeptScroll(keep, "settings", () => box.current);
  /** A display setting: kept, then every page redrawn with it. */
  const redraw = (k: string, v: string) => { store(k, v); changed(true); };

  const status = sync.state === "syncing" ? "Syncing…"
    : sync.state === "signed-out" ? "Signed out"
    : `Last sync: ${sync.lastSyncAt ? formatDateTime(sync.lastSyncAt) : "never"}${sync.message ? `\n${sync.message}` : ""}`;

  return (
    <Scaffold title="Settings" back flush>
      <div className="p-content ps" ref={box}>
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
        {!wide && <SwitchRow title="Reverse bottom bar swipe" supporting={barReversed ? "Sliding right along the bar goes to the page on the left, like swiping the pages"
          : "Sliding right along the bar goes to the page on the right, the indicator under the finger"} checked={barReversed}
          onChange={(v) => { setBarReversed(v); store(BAR_REVERSED_KEY, String(v)); }} />}
        <SwitchRow title={wide ? "Keep Tasks in the side bar" : "Keep Tasks in the bottom bar"}
          supporting={keepTasks ? "Tasks sits beside Training, so a swipe along the bar still reaches it"
            : "Off: to-dos without a date are behind the button on Today, dated tasks in the Calendar's Agenda"} checked={keepTasks}
          onChange={setKeepTasksTab} />
        <ListItem headline="Looks to try" supporting="Other looks for some pages, to try side by side" onClick={() => go("settings/looks")} />

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
        <SwitchRow title="Show completed tasks on Today" supporting="On: ticked tasks fold into one line you can tap to see. Off: they leave today's list once their moment is up" checked={showDone}
          onChange={(v) => { setShowDone(v); redraw("showDoneOnToday", String(v)); }} />
        {/* The days-in-a-row badge by each routine on Today and the task lists (off unless chosen). */}
        <ChoiceRow title="Streak badges" value={streaks} options={STREAK_STYLES} onPick={(v) => { setStreaks(v); setStreakStyle(v); }} />
        <ListItem headline="Streaks" supporting="Each routine's current and best streak, and its last 14 days" onClick={() => setStreaksOpen(true)} />

        <SportsSection />

        {hasAlarms && <AlarmSettingsSection />}
        {!isNative && <>
          <div className="p-hr" />
          <SectionHeader>Reminders</SectionHeader>
          <SwitchRow title="Show reminders on this computer" supporting="As desktop notifications, while Planner is open in a tab. The phone rings them as alarms"
            checked={notify} onChange={(v) => void setNotificationsEnabled(v).then(setNotify)} />
        </>}

        {isTestApp() && <>
          <div className="p-hr" />
          <SectionHeader>Planner Test</SectionHeader>
          <div className="pe-small ps-note">A test copy of Planner, to try new versions first. It has its own data and never syncs, so nothing here reaches your real app.</div>
          <div className="ps-buttons"><OutlinedButton onClick={() => setDialog("sample")}>Reset sample data</OutlinedButton></div>
        </>}
        {!isTestApp() && <>
        <div className="p-hr" />
        <SectionHeader>Cloud sync</SectionHeader>
        {/* The PC is served by the server itself; only the phone build is told where it is. */}
        {isNative && <ListItem headline="Server" supporting={server || "Not set"} onClick={() => setDialog("server")} />}
        <ListItem headline="Status" supporting={<span className="ps-pre">{status}</span>} />
        {sync.state !== "signed-out" && <StorageRow syncedAt={sync.lastSyncAt} />}
        {/* The server held back deletions that would remove most items: the user says which was meant. */}
        {sync.state === "needs-confirm" && (
          <div className="ps-buttons">
            <OutlinedButton disabled={busy} onClick={async () => { setBusy(true); await confirmDeletes(); setBusy(false); }}>Delete them</OutlinedButton>
            <OutlinedButton disabled={busy} onClick={async () => { setBusy(true); await restoreDeletes(); setBusy(false); }}>Restore them</OutlinedButton>
          </div>
        )}
        <div className="ps-buttons">
          <OutlinedButton disabled={busy || sync.state === "signed-out"} onClick={async () => { setBusy(true); await syncNow(); setBusy(false); }}>Sync now</OutlinedButton>
          <OutlinedButton onClick={() => setDialog("signout")}>Sign out</OutlinedButton>
        </div>
        </>}

        <div className="p-hr" />
        <SectionHeader>Data</SectionHeader>
        <HealthRow />
        {/* Phone only: it reads the phone's own calendars (272). */}
        {canImportCalendars && <ListItem headline="Import from Google Calendar" supporting="Birthdays, holidays and events from the phone's calendars" onClick={() => go("settings/import")} />}
        <ListItem headline="Categories" supporting="Names, colors and default reminder types" onClick={() => go("settings/categories")} />
        <ListItem headline="Trash" supporting={<span className="ps-pre">{`Restore or permanently delete items\nKept ${TRASH_DAYS} days`}</span>} onClick={() => go("settings/trash")} />
        <BackupRows />
        <ProblemsRow />
        {isNative && <UpdateRow />}
        <div className="p-endspace" />
      </div>

      {dialog === "server" && (
        <TextFieldDialog title="Server" label="Server URL" initial={server} onClose={() => setDialog("")}
          onSave={(u) => { setServer(u); setServerShown(getServer()); void syncNow(); }} />
      )}
      {dialog === "sample" && (
        <Dialog title="Reset sample data?" onClose={() => setDialog("")} actions={<>
          <TextButton onClick={() => setDialog("")}>Cancel</TextButton>
          <TextButton onClick={() => { resetSample(); setDialog(""); showSnackbar("Sample data put back"); }}>Reset</TextButton>
        </>}>Everything in Planner Test is replaced by the sample week. Your real app isn't touched.</Dialog>
      )}
      {streaksOpen && <StreaksSheet onClose={() => setStreaksOpen(false)} />}
      {dialog === "signout" && (
        <Dialog title="Sign out?" onClose={() => setDialog("")} actions={<>
          <TextButton onClick={() => setDialog("")}>Cancel</TextButton>
          <TextButton onClick={async () => { await resetLocal(); signOut(); location.reload(); }}>Sign out</TextButton>
        </>}>{isNative ? "This removes this phone's copy." : "This removes this browser's copy."} Your data stays on the server and your other devices.</Dialog>
      )}
    </Scaffold>
  );
}

// ---------- Backups (140) ----------

const backupWhen = (at: number) => formatDateTime(at);

/** Settings → Data: "Back up now" and "Restore from backup" (the phone's list, or a file picked on the PC). */
function BackupRows() {
  const [last, setLast] = useState(lastBackupAt);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const backUp = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const f = await backUpNow();
      setLast(f.at);
      showSnackbar(isNative ? `Backed up (${sizeText(f.size)})` : `Downloaded ${f.name}`);
    } catch (e) {
      showSnackbar(`Couldn't back up: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };
  const lastText = last ? `Last ${backupWhen(last)}` : "None yet";
  return <>
    <ListItem headline="Back up now" onClick={() => void backUp()} supporting={<span className="ps-pre">{busy ? "Backing up…"
      : isNative ? `A copy of everything on this phone, made daily too; the last 14 are kept\n${lastText}`
      : `Downloads a copy of everything to this computer\n${lastText}`}</span>} />
    {isNative
      ? <ListItem headline="Restore from backup" supporting="Puts back what's missing or changed; deletes nothing" onClick={() => go("settings/backups")} />
      : <FilePickRow headline="Restore from backup" supporting="Pick a backup file; puts back what's missing or changed, deletes nothing" onPicked={setRestoring} />}
    {restoring && <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} />}
  </>;
}

/** A row that opens the file picker and reads the backup picked. */
function FilePickRow({ headline, supporting, onPicked }: { headline: string; supporting: string; onPicked: (b: Backup) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const picked = async (file: File | undefined) => {
    if (!file) return;
    try { onPicked(await readBackupFile(file)); } catch (e) { showSnackbar(e instanceof Error ? e.message : "Couldn't read the file"); }
  };
  return <>
    <ListItem headline={headline} supporting={supporting} onClick={() => input.current?.click()} />
    <input ref={input} type="file" accept=".gz,.json,application/gzip,application/json" hidden
      onChange={(e) => { void picked(e.target.files?.[0]); e.target.value = ""; }} />
  </>;
}

/** The phone's backups, newest first, with their date and size; one tapped is checked before anything changes. */
export function PhoneBackups() {
  const [files, setFiles] = useState<BackupFile[] | null>(null);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  useEffect(() => { void listBackups().then(setFiles); }, []);
  const open = async (f: BackupFile) => {
    try { setRestoring(await readBackup(f.name)); } catch (e) { showSnackbar(e instanceof Error ? e.message : "Couldn't read the backup"); }
  };
  return (
    <Scaffold title="Restore from backup" back flush>
      <div className="p-content ps">
        <div className="pe-small ps-note">Restoring puts back what's missing here, and can set changed things back to how they were. It never deletes anything. You'll see what it would do first.</div>
        {files !== null && files.length === 0 && <div className="ps-empty">No backups on this phone yet.</div>}
        {(files ?? []).map((f) => (
          <ListItem key={f.name} headline={backupWhen(f.at)} supporting={sizeText(f.size)} leading={<MIcon name="oRestoreFromTrash" />} onClick={() => void open(f)} />
        ))}
        <FilePickRow headline="From a file" supporting="A backup saved elsewhere, or downloaded on the PC" onPicked={setRestoring} />
        <div className="p-endspace" />
      </div>
      {restoring && <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} />}
    </Scaffold>
  );
}

const recordsText = (entries: [string, unknown][]) => {
  const items = entries.filter(([k]) => k.startsWith("items/")).length;
  return `${count(entries.length, "record")}${items ? ` (${count(items, "item")})` : ""}`;
};

/** What a restore would do, said before it happens: how many records come back, and which ones lose edits. */
function RestoreDialog({ backup, onClose }: { backup: Backup; onClose: () => void }) {
  const [plan] = useState<RestorePlan>(() => planRestore(backup));
  const { missing, changed } = plan;
  const done = (withChanged: boolean) => {
    const n = applyRestore(plan, withChanged);
    onClose();
    showSnackbar(`Restored ${count(n, "record")}`);
  };
  const made = backup.device.startsWith("Phone") ? ", made on the phone" : backup.device.startsWith("PC") ? ", made on the PC" : "";
  const from = `The backup from ${backupWhen(backup.createdAt)}${made}.`;
  if (!missing.length && !changed.length) {
    return <Dialog title="Nothing to restore" onClose={onClose} actions={<TextButton onClick={onClose}>OK</TextButton>}>
      {from} Everything in it is already here.
    </Dialog>;
  }
  return (
    <Dialog title={`Restore ${count(missing.length + changed.length, "record")}?`} onClose={onClose} actions={<>
      <TextButton onClick={onClose}>Cancel</TextButton>
      {missing.length > 0 && changed.length > 0 && <TextButton onClick={() => done(false)}>Missing only</TextButton>}
      <TextButton onClick={() => done(true)}>Restore</TextButton>
    </>}>
      <span className="ps-pre">{[
        from,
        missing.length ? `• ${recordsText(missing)} missing here ${missing.length === 1 ? "comes" : "come"} back.` : "",
        changed.length ? `• ${recordsText(changed)} changed since ${changed.length === 1 ? "goes back to how it was" : "go back to how they were"} then: edits made since are lost.` : "",
        "Nothing is deleted. What comes back syncs to your other devices as a new edit.",
      ].filter(Boolean).join("\n")}</span>
    </Dialog>
  );
}

// ---------- Looks to try ----------

/**
 * Every look that can be tried (looks.ts, roadmap 254), grouped by page: a switch of its choices (a menu
 * when there are many), and a line saying what the chosen one is and which is the pick.
 */
export function PhoneLooks() {
  useLooks();
  const keys = Object.keys(LOOKS) as LookKey[];
  const pages = [...new Set(keys.map((k) => LOOKS[k].page))];
  return (
    <Scaffold title="Looks to try" back flush>
      <div className="p-content ps">
        <div className="ps-pad ps-intro">Try other looks for now; the ones you don't keep go later. Each starts on your pick.</div>
        {pages.map((page, i) => <div key={page}>
          {i > 0 && <div className="p-hr" />}
          <SectionHeader>{page}</SectionHeader>
          {keys.filter((k) => LOOKS[k].page === page).map((k) => <LookRow key={k} k={k} />)}
        </div>)}
        <div className="p-endspace" />
      </div>
    </Scaffold>
  );
}

function LookRow({ k }: { k: LookKey }) {
  const l = LOOKS[k];
  const v: string = look(k);
  const choices = l.choices.map(([c, short]) => [c, short] as [string, string]);
  const chosen = l.choices.find(([c]) => c === v);
  const pick = l.choices.find(([c]) => c === l.pick)!;
  const set = (c: string) => setLook(k, c as never);
  const about = <>{chosen?.[2]}<span className="ps-pick">{v === l.pick ? " (your pick)" : ` · your pick is ${pick[1]}`}</span></>;
  if (l.choices.length > 3) {
    return <ChoiceRow title={`${l.title}: ${chosen?.[1] ?? ""}`} value={v} supporting={about} onPick={set}
      options={l.choices.map(([c, short, what]) => [c, `${short}: ${what}${c === l.pick ? " (your pick)" : ""}`] as [string, string])} />;
  }
  return (
    <div className="ps-pad ps-look">
      <div className="ps-label">{l.title}</div>
      <Segmented value={v} options={choices} onChange={set} />
      <div className="ps-about">{about}</div>
    </div>
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

// ---------- Problem log ----------

function useProblems(): Problem[] {
  const [list, setList] = useState(problems);
  useEffect(() => onProblems(() => setList(problems())), []);
  return list;
}

function ProblemsRow() {
  const list = useProblems().filter((p) => !p.note);
  return <ListItem headline="Problem log" supporting={list.length ? `${count(list.length, "problem")} · last ${formatDateTime(list[0].at)}` : "Nothing has gone wrong"}
    onClick={() => go("settings/problems")} />;
}

/** What went wrong on this device, to read or copy into a message (problems.ts). */
export function PhoneProblems() {
  const list = useProblems();
  const copy = () => void navigator.clipboard.writeText(problemsText(list)).then(() => showSnackbar("Copied"), () => showSnackbar("Couldn't copy"));
  return (
    <Scaffold title="Problem log" back flush actions={list.length > 0 ? <>
      <TextButton onClick={copy}>Copy</TextButton>
      <TextButton onClick={clearProblems}>Clear</TextButton>
    </> : undefined}>
      <div className="p-content ps">
        {list.length === 0 && <div className="ps-empty">Nothing has gone wrong on this device.</div>}
        {list.map((p) => (
          <ListItem key={`${p.at}${p.message}`} headline={<span className="ps-pre">{p.message}</span>}
            supporting={<span className="ps-pre">{`${formatDateTime(p.at)} · ${p.kind}${p.detail ? `\n${p.detail.split("\n").slice(0, 4).join("\n")}` : ""}`}</span>} />
        ))}
        <div className="p-endspace" />
      </div>
    </Scaffold>
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
