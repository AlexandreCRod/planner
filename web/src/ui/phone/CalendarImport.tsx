// Settings → Import from Google Calendar (272): every event ahead in the phone's calendars, grouped by
// calendar (Birthdays, Holidays, then the user's own), with a box per calendar and per event, and Import
// in the top bar. Birthdays come in as yearly all-day events (in Personal), holidays as all-day events,
// the rest with their times; importing again updates what came in before. The phone's calendars are
// asked for only here (Android's dialog), and only read.
import { useEffect, useMemo, useState } from "react";
import { formatDate, formatTime } from "../../domain/dates.ts";
import { type ImportEntry, type ImportGroup, importGroups, importedBySource } from "../../domain/phoneCalendar.ts";
import { describe } from "../../domain/recurrence.ts";
import { cssColor } from "../../domain/types.ts";
import { count } from "../../domain/plural.ts";
import { useSnapshot } from "../../store/store.ts";
import { calendarAccess, canImportCalendars, importEntries, openCalendarSettings, readPhoneCalendars } from "../../store/phoneCalendar.ts";
import { Checkbox, EmptyHint, MIcon, Scaffold } from "./chrome.tsx";
import { OutlinedButton, TextButton, showSnackbar } from "./m3.tsx";

type State = { at: "loading" } | { at: "denied" } | { at: "error"; message: string } | { at: "ready"; groups: ImportGroup[] };

/** The calendar's name as the phone shows it: Google names a user's main calendar after the address. */
const calendarName = (g: ImportGroup) => (g.kind === "birthdays" ? "Birthdays" : g.calendar.name || "Calendar");

function when(e: ImportEntry): string {
  const i = e.item;
  const parts = [formatDate(i.startDay!)];
  if (!i.allDay && i.startMin !== null) parts.push(formatTime(i.startMin));
  if (i.endDay !== null && i.endDay > i.startDay!) parts.push(`to ${formatDate(i.endDay)}`);
  if (i.freq !== "NONE") parts.push(describe(i));
  return parts.join(" · ");
}

export function PhoneCalendarImport() {
  const s = useSnapshot();
  const [state, setState] = useState<State>({ at: "loading" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const known = useMemo(() => importedBySource(s.items), [s]);

  const load = async (ask: boolean) => {
    setState({ at: "loading" });
    try {
      if (!(await calendarAccess(ask))) { setState({ at: "denied" }); return; }
      const { calendars, events } = await readPhoneCalendars();
      const groups = importGroups(calendars, events);
      // Ones imported before start ticked, so Import brings them up to date; small calendars start open.
      const imported = importedBySource(s.items);
      setPicked(new Set(groups.flatMap((g) => g.entries).filter((e) => imported.has(e.source)).map((e) => e.source)));
      setOpen(new Set(groups.filter((g) => g.entries.length <= 5).map((g) => g.calendar.id)));
      setState({ at: "ready", groups });
    } catch (e) {
      setState({ at: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  useEffect(() => { if (canImportCalendars) void load(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = state.at === "ready" ? state.groups : [];
  const toggle = (sources: string[], on: boolean) => setPicked((p) => {
    const n = new Set(p);
    for (const k of sources) if (on) n.add(k); else n.delete(k);
    return n;
  });
  const flip = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doImport = () => {
    const chosen = groups.flatMap((g) => g.entries).filter((e) => picked.has(e.source));
    const { added, updated } = importEntries(chosen);
    const said = [added ? `${count(added, "event")} added` : "", updated ? `${updated} updated` : ""].filter(Boolean).join(", ");
    showSnackbar(said ? `Imported: ${said}` : "Already up to date");
    history.back();
  };

  return (
    <Scaffold title="Import from Google Calendar" back flush
      actions={state.at === "ready" ? <TextButton disabled={picked.size === 0} onClick={doImport}>{picked.size ? `Import ${picked.size}` : "Import"}</TextButton> : undefined}>
      <div className="p-content ps pci">
        {!canImportCalendars && <EmptyHint>Importing reads the phone's calendars, so it's in the app on the phone.</EmptyHint>}
        {canImportCalendars && state.at === "loading" && <div className="ps-empty">Reading the phone's calendars…</div>}
        {state.at === "denied" && <>
          <div className="ps-empty">Planner needs to read the phone's calendars to import from them. Google Calendar keeps them there; nothing is changed in them.</div>
          <div className="ps-buttons">
            <OutlinedButton onClick={() => void load(true)}>Allow</OutlinedButton>
            <OutlinedButton onClick={openCalendarSettings}>Open settings</OutlinedButton>
          </div>
        </>}
        {state.at === "error" && <div className="ps-empty">The calendars couldn't be read ({state.message}).</div>}
        {state.at === "ready" && <>
          <div className="pe-small ps-note">Birthdays come in as yearly all-day events in Personal, holidays as all-day events, the rest with their times. Importing again updates them.</div>
          {groups.length === 0 && <div className="ps-empty">No events ahead in the phone's calendars.</div>}
          {groups.map((g) => {
            const sources = g.entries.map((e) => e.source);
            const n = sources.filter((k) => picked.has(k)).length;
            const isOpen = open.has(g.calendar.id);
            const dot = g.calendar.color !== null ? cssColor(g.calendar.color) : undefined;
            return (
              <section key={g.calendar.id} className="pci-cal">
                <div className="pci-head" role="button" aria-expanded={isOpen} onClick={() => flip(g.calendar.id)}>
                  <span className={`pci-all ${n > 0 && n < sources.length ? "some" : ""}`}>
                    <Checkbox checked={n === sources.length} onChange={(v) => toggle(sources, v)} />
                  </span>
                  <span className="pci-dot" style={dot ? { background: dot } : undefined} />
                  <span className="pci-text">
                    <span className="pci-name">{calendarName(g)}</span>
                    <span className="pci-sub">{[g.calendar.account, count(g.entries.length, "event"), n ? `${n} picked` : ""].filter(Boolean).join(" · ")}</span>
                  </span>
                  <MIcon name={isOpen ? "fExpandLess" : "fExpandMore"} />
                </div>
                {isOpen && g.entries.map((e) => (
                  <label key={e.source} className="pci-row">
                    <Checkbox checked={picked.has(e.source)} onChange={(v) => toggle([e.source], v)} />
                    <span className="pci-text">
                      <span className="pci-title">{e.item.title || "Untitled"}</span>
                      <span className="pci-sub">{when(e)}{known.has(e.source) ? " · Imported" : ""}</span>
                    </span>
                  </label>
                ))}
              </section>
            );
          })}
        </>}
        <div className="p-endspace" />
      </div>
    </Scaffold>
  );
}
