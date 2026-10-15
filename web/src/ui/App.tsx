import { useRef, useState } from "react";
import { formatClock } from "../domain/dates.ts";
import { DEFAULT_SERVER, getServer, isNative, setServer, usePhone } from "../platform.ts";
import { testToken, setToken, startAutoSync, syncNow } from "../store/sync.ts";
import { BrowseView } from "./BrowseView.tsx";
import { CalendarView } from "./CalendarView.tsx";
import { Icon, go, useRoute } from "./common.tsx";
import { GraphView } from "./GraphView.tsx";
import { ItemEditor } from "./ItemEditor.tsx";
import { NoteEditor, NotesView } from "./NotesView.tsx";
import { PhoneApp } from "./phone/PhoneApp.tsx";
import { QuickAdd } from "./QuickAdd.tsx";
import { SettingsView, useSyncStatus } from "./SettingsView.tsx";
import { TasksView } from "./TasksView.tsx";
import { TodayView } from "./TodayView.tsx";

const NAV: [string, string, string][] = [
  ["today", "Today", "today"], ["calendar", "Calendar", "calendar"], ["tasks", "Tasks", "tasks"],
  ["notes", "Notes", "lightbulb"], ["graph", "Links", "graph"], ["browse", "Search", "search"], ["settings", "Settings", "settings"],
];

const SYNC_COLORS: Record<string, string> = { idle: "#43a047", syncing: "#fb8c00", offline: "#9e9e9e", error: "var(--danger)", "needs-confirm": "var(--danger)", "signed-out": "var(--danger)" };

export function App() {
  // Phones (the Capacitor app, or a phone-narrow browser) get their own shell; the PC layout is unchanged.
  const phone = usePhone();
  const sync = useSyncStatus();
  // All phone CSS hangs off html.phone, so the PC layout never sees it. Set while rendering, so the
  // phone pages measure themselves with it already applied.
  document.documentElement.classList.toggle("phone", phone);
  if (sync.state === "signed-out") return <Login message={sync.message} />;
  return phone ? <PhoneApp /> : <DesktopApp />;
}

function DesktopApp() {
  const [path, query] = useRoute();
  const sync = useSyncStatus();
  const lastMain = useRef<string[]>(["today"]);
  const page = path[0] ?? "today";
  const isItem = page === "item";
  if (!isItem) lastMain.current = path.length ? path : ["today"];
  const main = isItem ? lastMain.current : path.length ? path : ["today"];
  const mainPage = main[0];

  if (sync.state === "signed-out") return <Login message={sync.message} />;

  const title = ({ today: "Planner", calendar: "Calendar", tasks: "Tasks", notes: "Notes", graph: "Links", browse: "Search", settings: "Settings", note: "Note" } as Record<string, string>)[mainPage] ?? "Planner";
  const flush = mainPage === "calendar" || mainPage === "graph";

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand"><img src="/icon.svg" alt="" /> Planner</div>
        {NAV.map(([key, label, icon]) => (
          <button key={key} className={`nav ${mainPage === key ? "active" : ""}`} onClick={() => go(key)} title={label}>
            <Icon name={icon} /> <span className="label">{label}</span>
          </button>
        ))}
        <div className="spacer" />
        <div className="sync-pill" title={sync.message}>
          <span className="dot" style={{ background: SYNC_COLORS[sync.state] }} />
          {sync.state === "syncing" ? "Syncing…" : sync.state === "offline" ? "Offline" : sync.state === "idle" ? `Synced${sync.lastSyncAt ? " " + formatClock(sync.lastSyncAt) : ""}` : "Sync problem"}
        </div>
      </nav>
      <div className="main">
        {sync.state === "needs-confirm" && (
          <div className="banner">
            <span className="grow">{sync.message}</span>
            <button className="btn small danger" onClick={() => void syncNow(true)}>Sync anyway</button>
          </div>
        )}
        {sync.state === "error" && <div className="banner"><span className="grow">{sync.message}</span><button className="btn small" onClick={() => void syncNow()}>Retry</button></div>}
        {mainPage !== "note" && (
          <div className="topbar">
            <h1>{title}</h1>
            <QuickAdd />
          </div>
        )}
        <div className={`content ${flush ? "flush" : ""}`} style={mainPage === "note" ? { padding: 0 } : undefined}>
          {mainPage === "today" && <TodayView />}
          {mainPage === "calendar" && <CalendarView />}
          {mainPage === "tasks" && <TasksView />}
          {mainPage === "notes" && <NotesView />}
          {mainPage === "graph" && <GraphView key={query.get("focus") ?? "0"} focusId={Number(query.get("focus") ?? 0)} />}
          {mainPage === "browse" && <BrowseView initialKind={query.get("kind") ?? ""} />}
          {mainPage === "settings" && <SettingsView />}
          {mainPage === "note" && (
            <NoteEditor key={main[1] + (query.get("day") ?? "")} id={main[1] && main[1] !== "new" ? Number(main[1]) : null} day={query.get("day") ? Number(query.get("day")) : null} />
          )}
        </div>
      </div>
      {isItem && path[1] && (
        <ItemEditor key={path[1]} id={Number(path[1])} occurrence={query.get("occ") ? Number(query.get("occ")) : null}
          isNewPlaceholder={query.get("new") === "1"} onClose={() => history.back()} />
      )}
    </div>
  );
}

function Login({ message }: { message: string }) {
  const [token, setTok] = useState("");
  // The phone app isn't served by the Worker, so it asks where the server is.
  const [server, setSrv] = useState(() => getServer() || DEFAULT_SERVER);
  const [error, setError] = useState(message);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      if (isNative) setServer(server);
      const { items } = await testToken(token);
      setToken(token);
      setError("");
      startAutoSync();
      if (!location.hash) go("today");
      void items;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="card">
        <div className="row"><img src="/icon.svg" alt="" width={36} /><b style={{ fontSize: 20 }}>Planner</b></div>
        <div className="hint">Enter the sync password you set with <code>wrangler secret put API_TOKEN</code>. It is kept only in this browser.</div>
        {isNative && <input className="input" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="Server address" aria-label="Server address" value={server} onChange={(e) => setSrv(e.target.value)} />}
        <input className="input" type="password" autoFocus={!isNative} placeholder="Sync password" value={token} onChange={(e) => setTok(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button className="btn primary" disabled={!token || busy} onClick={() => void submit()}>{busy ? "Connecting…" : "Connect"}</button>
      </div>
    </div>
  );
}
