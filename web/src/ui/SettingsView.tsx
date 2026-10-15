import { useEffect, useState } from "react";
import { type ClockFormat, DATE_STYLES, type DateStyle, clockFormat, dateStyle, formatDateTime } from "../domain/dates.ts";
import { type AlertType, type Category, argbOf, cssColor } from "../domain/types.ts";
import { changed, deleteCategory, deleteForever, emptyTrash, restore, saveCategory, useSnapshot } from "../store/store.ts";
import { type SyncStatus, getStatus, onStatus, resetLocal, signOut, syncNow } from "../store/sync.ts";
import { notificationsEnabled, setNotificationsEnabled } from "../notify.ts";
import { typeLabel } from "./LinksSection.tsx";
import { checkedLinger, showDoneOnToday } from "./common.tsx";

export const ACCENTS: [string, string][] = [["Indigo", "#3f51b5"], ["Teal", "#00796b"], ["Rose", "#b0285a"], ["Amber", "#8b5000"], ["Forest", "#2e7d32"], ["Violet", "#6a3db8"], ["Ocean", "#0061a4"], ["Slate", "#4f5b66"]];

export function applyTheme() {
  const theme = localStorage.getItem("theme") ?? "system";
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.setProperty("--accent", localStorage.getItem("accent") ?? "#3f51b5");
}

export function useSyncStatus(): SyncStatus {
  const [st, setSt] = useState(getStatus());
  useEffect(() => { const off = onStatus(setSt); return () => { off(); }; }, []);
  return st;
}

export function SettingsView() {
  const s = useSnapshot();
  const sync = useSyncStatus();
  const [theme, setTheme] = useState(localStorage.getItem("theme") ?? "system");
  const [accent, setAccent] = useState(localStorage.getItem("accent") ?? "#3f51b5");
  const [monday, setMonday] = useState(localStorage.getItem("weekStartsMonday") !== "false");
  const [notify, setNotify] = useState(notificationsEnabled());
  const [clock, setClock] = useState<ClockFormat>(clockFormat());
  const [dates, setDates] = useState<DateStyle>(dateStyle());
  const [linger, setLinger] = useState(String(checkedLinger()));
  const [showDone, setShowDone] = useState(showDoneOnToday());
  const [editing, setEditing] = useState<Category | null>(null);
  useEffect(() => { localStorage.setItem("theme", theme); localStorage.setItem("accent", accent); applyTheme(); }, [theme, accent]);
  useEffect(() => { localStorage.setItem("weekStartsMonday", String(monday)); }, [monday]);

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="section">Appearance</div>
      <div className="row"><div className="seg">{["system", "light", "dark"].map((t) => <button key={t} className={theme === t ? "on" : ""} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div></div>
      <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
        {ACCENTS.map(([n, c]) => <button key={c} title={n} onClick={() => setAccent(c)} style={{ width: 30, height: 30, borderRadius: "50%", background: c, border: accent === c ? "3px solid var(--text)" : "0" }} />)}
      </div>

      <div className="section">Calendar</div>
      <label className="row"><input type="checkbox" checked={monday} onChange={(e) => setMonday(e.target.checked)} /> Week starts on Monday</label>
      <div className="row" style={{ marginTop: 10 }}>Time format
        <div className="seg">{([["system", "This computer's setting"], ["24", "24-hour (15:30)"], ["12", "12-hour (3:30 PM)"]] as [ClockFormat, string][]).map(([v, l]) => (
          <button key={v} className={clock === v ? "on" : ""} onClick={() => {
            setClock(v);
            localStorage.setItem("clockFormat", v);
            changed(true); // redraw every view with the new format
          }}>{l}</button>
        ))}</div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>Date format
        <div className="seg">{DATE_STYLES.map(([v, l]) => (
          <button key={v} className={dates === v ? "on" : ""} onClick={() => { setDates(v); localStorage.setItem("dateFormat", v); changed(true); }}>{l}</button>
        ))}</div>
      </div>

      <div className="section">Tasks</div>
      <div className="row">Checked tasks
        <select className="input" value={linger} onChange={(e) => { setLinger(e.target.value); localStorage.setItem("checkedLinger", e.target.value); }}>
          {([["-1", "Stay until you leave the page"], ["10", "Move away after 10 seconds"], ["5", "Move away after 5 seconds"], ["3", "Move away after 3 seconds"], ["1", "Move away after 1 second"], ["0", "Move away right away"]]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <label className="row" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={showDone} onChange={(e) => { setShowDone(e.target.checked); localStorage.setItem("showDoneOnToday", String(e.target.checked)); }} />
        Show completed tasks on Today
      </label>

      <div className="section">Notifications on this computer</div>
      <label className="row">
        <input type="checkbox" checked={notify} onChange={async (e) => setNotify(await setNotificationsEnabled(e.target.checked))} />
        Show reminders as desktop notifications while Planner is open
      </label>
      <div className="hint">Alarms and reminders always ring on the phone; this adds a desktop pop-up too.</div>

      <div className="section">Sync</div>
      <div className="card" style={{ padding: 14 }}>
        <div>Server: <code>{location.origin}</code></div>
        <div className="hint" style={{ margin: "6px 0" }}>Last sync: {sync.lastSyncAt ? formatDateTime(sync.lastSyncAt) : "never"} {sync.message && `· ${sync.message}`}</div>
        <div className="row">
          <button className="btn" onClick={() => void syncNow()}>Sync now</button>
          <button className="btn danger" onClick={async () => { if (confirm("Sign out and remove this computer's copy? Your data stays on the server and the phone.")) { await resetLocal(); signOut(); location.reload(); } }}>Sign out</button>
        </div>
      </div>

      <div className="section">Categories <span className="grow" /><button className="btn small" onClick={() => setEditing({ id: 0, name: "", color: argbOf("#42a5f5"), defaultAlert: "REMINDER" })}>+ Add</button></div>
      {s.categories.map((c) => (
        <div key={c.id} className="task" onClick={() => setEditing({ ...c })}>
          <span className="dot" style={{ background: cssColor(c.color), width: 14, height: 14 }} />
          <div className="grow">{c.name}<div className="sub">Default reminder: {c.defaultAlert.toLowerCase()} · {s.items.filter((i) => i.categoryId === c.id).length} item(s)</div></div>
        </div>
      ))}
      {editing && (
        <div className="card" style={{ padding: 14, marginTop: 8, display: "grid", gap: 10 }}>
          <input className="input" placeholder="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <label className="row">Colour <input type="color" value={cssColor(editing.color)} onChange={(e) => setEditing({ ...editing, color: argbOf(e.target.value) })} /></label>
          <div className="row">Default reminder <div className="seg">{(["NOTIFICATION", "REMINDER", "ALARM"] as AlertType[]).map((t) => <button key={t} className={editing.defaultAlert === t ? "on" : ""} onClick={() => setEditing({ ...editing, defaultAlert: t })}>{t === "NOTIFICATION" ? "Silent" : t[0] + t.slice(1).toLowerCase()}</button>)}</div></div>
          <div className="row">
            <button className="btn primary" disabled={!editing.name.trim()} onClick={() => { saveCategory({ ...editing, name: editing.name.trim() }); setEditing(null); }}>Save</button>
            {editing.id !== 0 && <button className="btn danger" onClick={() => { deleteCategory(editing); setEditing(null); }}>Delete</button>}
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="section">Trash <span className="grow" />{s.trash.length > 0 && <button className="btn small danger" onClick={() => { if (confirm(`Permanently delete ${s.trash.length} item(s)?`)) emptyTrash(); }}>Empty trash</button>}</div>
      {s.trash.length === 0 && <div className="hint">Trash is empty.</div>}
      {s.trash.map((i) => (
        <div key={i.id} className="task">
          <div className="grow">{i.title || "Untitled"}<div className="sub">{typeLabel(i)} · deleted {formatDateTime(i.deletedAt!)}</div></div>
          <button className="btn small" onClick={() => restore(i.id)}>Restore</button>
          <button className="btn small danger" onClick={() => { if (confirm("Delete forever?")) deleteForever(i.id); }}>Delete</button>
        </div>
      ))}
    </div>
  );
}
