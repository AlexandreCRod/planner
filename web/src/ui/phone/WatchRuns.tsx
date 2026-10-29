// The watch run on the Training page (items 213 and 217): when Training opens on the phone, a new watch run
// ticks its day's one run session (domain/healthRuns.ts; Health Connect's reads do the same). A day whose
// watch run has no session to tick (none that day, or two) gets a small chip: "Watch run 8.0 km · which
// session?". It opens a short picker: the phase's run sessions not done, nearest days first, and "Not a plan
// run", which hides the run for good.
import { useEffect, useMemo, useState } from "react";
import { formatDate, formatTime } from "../../domain/dates.ts";
import { type WatchRunStep, hiddenRunId, tickedEntry, watchRunSteps } from "../../domain/healthRuns.ts";
import { dayOfSession, entryFor, entryId } from "../../domain/training.ts";
import { fmtKm } from "../../domain/trainingWeek.ts";
import type { HealthSession } from "../../domain/health.ts";
import { type WatchStats, APPROX_NOTE, sessionStats, statItems, statLine, venueOf } from "../../domain/watchActivities.ts";
import { kindIcon } from "./trainingParts.tsx";
import { type LoadedPlan, type Training, applyWatchRuns, saveEntry, saveHidden, training } from "../../store/training.ts";
import { isNative } from "../../platform.ts";
import { MIcon } from "./chrome.tsx";
import { feel } from "./haptics.ts";
import { BottomSheet, showSnackbar } from "./m3.tsx";

/** The phone, once when Training opens (not for an earlier plan): ticks what the watch ran. */
export function useWatchRunTicks(readOnly: boolean) {
  useEffect(() => { if (isNative && !readOnly) applyWatchRuns(); }, [readOnly]);
}

/** The watch runs that ask which session they were, by day. */
export function useWatchRunAsks(tr: Training, lp: LoadedPlan, t: number, readOnly: boolean): Map<number, Extract<WatchRunStep, { kind: "ask" }>[]> {
  return useMemo(() => {
    const out = new Map<number, Extract<WatchRunStep, { kind: "ask" }>[]>();
    if (readOnly) return out;
    for (const x of watchRunSteps(lp.plan, tr.entries, tr.runs, tr.hiddenWatchRuns, t)) {
      if (x.kind !== "ask") continue;
      out.set(x.run.day, [...(out.get(x.run.day) ?? []), x]);
    }
    return out;
  }, [tr, lp, t, readOnly]);
}

/** A day's chips, one per watch run that asks. */
export function WatchRunChips({ lp, asks }: { lp: LoadedPlan; asks: Extract<WatchRunStep, { kind: "ask" }>[] | undefined }) {
  const [open, setOpen] = useState<Extract<WatchRunStep, { kind: "ask" }> | null>(null);
  if (!asks?.length) return null;
  return <>
    {asks.map((a) => (
      <button key={a.run.id} className="tr-watchchip" onClick={(ev) => { ev.stopPropagation(); feel("tick"); setOpen(a); }}>
        <MIcon name="oDirectionsRun" size={14} />
        <span>Watch run{a.run.distanceKm ? ` ${fmtKm(a.run.distanceKm)} km` : ""} · which session?</span>
      </button>
    ))}
    {open && <WatchRunSheet lp={lp} ask={open} onClose={() => setOpen(null)} />}
  </>;
}

function WatchRunSheet({ lp, ask, onClose }: { lp: LoadedPlan; ask: Extract<WatchRunStep, { kind: "ask" }>; onClose: () => void }) {
  const { plan } = lp;
  const { run } = ask;
  const pick = (sid: string, close: () => void) => {
    const s = ask.choices.find((x) => x.id === sid);
    if (!s) return;
    const entries = training().entries;
    const before = entryFor(plan, s, entries);
    saveEntry(tickedEntry(plan, s, entries, run));
    feel("confirm");
    close();
    showSnackbar(`${s.title} done on ${formatDate(run.day)}`, "Undo", () => saveEntry(before));
  };
  const notPlan = (close: () => void) => {
    const h = { id: hiddenRunId(run.id), kind: "watchRun" as const, pastId: run.id, hiddenAt: Date.now(), updatedAt: 0, deletedAt: null };
    saveHidden(h);
    close();
    showSnackbar("Not a plan run", "Undo", () => saveHidden({ ...h, deletedAt: Date.now() }));
  };
  const entries = training().entries;
  return (
    <BottomSheet onClose={onClose}>{(close) => (
      <div className="tr-move">
        <div className="tr-sheet-title t-title-medium">Watch run{run.distanceKm ? ` ${fmtKm(run.distanceKm)} km` : ""}, {formatDate(run.day)}{run.time ? ` ${run.time}` : ""}</div>
        {ask.choices.map((s) => {
          const day = dayOfSession(s, entries.get(entryId(plan.id, s.id)));
          return (
            <button key={s.id} className="tr-move-day" onClick={() => pick(s.id, close)}>
              <span className="d">{s.title}</span>
              <span className="what">{[day !== null ? formatDate(day) : "To place", s.detail].filter(Boolean).join(" · ")}</span>
            </button>
          );
        })}
        <button className="tr-move-day" onClick={() => notPlan(close)}><span className="d">Not a plan run</span><span className="what">Leave it out of the plan</span></button>
      </div>
    )}</BottomSheet>
  );
}

// ---------- The watch's stats on an activity (item 268) ----------

/** A small grid of the watch's stats (domain/watchActivities.ts statItems), with the "≈" note when the distance is a guess. */
export function WatchStatsGrid({ stats, inset }: { stats: WatchStats; inset?: boolean }) {
  const items = statItems(stats);
  if (!items.length) return null;
  return (
    <div className={`tr-stats ${inset ? "inset" : ""}`}>
      <div className="grid">{items.map((x) => <div key={x.label}><span className="v">{x.value}</span><span className="l">{x.label}</span></div>)}</div>
      {stats.approx && <div className="tr-stats-note">{APPROX_NOTE}</div>}
    </div>
  );
}

/** A session's local "HH:MM" as the app writes times ("7:02 PM" or "19:02"). */
export const hhmm = (t: string) => (/^\d\d:\d\d$/.test(t) ? formatTime(Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))) : t);
/** "From the watch · 7:02 PM – 8:04 PM": the head over a session's stats. */
export const watchHead = (s: HealthSession) => `From the watch · ${hhmm(s.time)}${s.endTime ? ` – ${hhmm(s.endTime)}` : ""}`;

/**
 * A football session from the watch that no game took (268): on its day, with its stats line; a tap opens
 * its stats. Not a plan item, so no ring: a watch mark stands where the ring would be.
 */
export function LooseWatchRow({ s }: { s: HealthSession }) {
  const [open, setOpen] = useState(false);
  const st = sessionStats(s, venueOf(s));
  const title = s.title || "Football";
  return <>
    <div className="tr-row done k-futsal tr-loose" role="button" onClick={() => { feel("tick"); setOpen(true); }}>
      <span className="tr-ring-mark" aria-hidden="true"><MIcon name="oAvTimer" size={18} /></span>
      <span className="tr-bub k-futsal"><MIcon name={kindIcon("futsal")} size={18} /></span>
      <span className="tr-row-text">
        <span className="title">{title}</span>
        <span className="detail">{["From the watch", hhmm(s.time), statLine(st)].filter(Boolean).join(" · ")}</span>
      </span>
    </div>
    {open && <BottomSheet onClose={() => setOpen(false)}>{() => (
      <div className="tr-futsal">
        <div className="tr-sheet-title t-title-medium">{title}</div>
        <div className="tr-label">{watchHead(s)} · no game on the calendar</div>
        <WatchStatsGrid stats={st} inset />
      </div>
    )}</BottomSheet>}
  </>;
}
