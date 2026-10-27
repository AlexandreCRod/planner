// The Training page's week bar (item 207): one segment per session or futsal game on the week's days, filled
// when done, with how many are done and the km run so far. A done run counts the distance of the run
// matched to it in runs.json, else the km its plan text starts with ("10 km easy"); intervals ("3×2 km")
// and times ("40'") count nothing.
import type { WeekItem } from "./training.ts";
import type { Run } from "./trends.ts";

/** The kinds with a colour of their own; anything else looks as before. */
export type ColourKind = "run" | "gym" | "futsal";

export interface WeekBar {
  /** In the page's order: by day, sessions then futsal. Skipped sessions are left out. */
  segments: { kind: ColourKind | null; done: boolean }[];
  done: number;
  /** Km of the done runs. */
  km: number;
}

export function colourKind(it: WeekItem): ColourKind | null {
  if (!it.session) return "futsal";
  return it.session.kind === "run" || it.session.kind === "gym" ? it.session.kind : null;
}

/** "10 km easy", "11 km: 9 easy + …" → 10, 11; anything not starting with a distance → null. */
export function plannedKm(detail: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*km\b/i.exec(detail);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** The run in runs.json matched to session [sessionId], the latest if more than one. */
export function runOf(runs: readonly Run[], sessionId: string): Run | null {
  for (let i = runs.length - 1; i >= 0; i--) if (runs[i].sessionId === sessionId) return runs[i];
  return null;
}

export function weekBar(days: readonly { items: readonly WeekItem[] }[], runs: readonly Run[]): WeekBar {
  const out: WeekBar = { segments: [], done: 0, km: 0 };
  for (const { items } of days) {
    for (const it of items) {
      if (it.entry.status === "skipped") continue;
      const done = it.entry.status === "done";
      out.segments.push({ kind: colourKind(it), done });
      if (!done) continue;
      out.done++;
      const s = it.session;
      if (s?.kind === "run") out.km += runOf(runs, s.id)?.distanceKm ?? plannedKm(s.detail) ?? 0;
    }
  }
  return out;
}

/** The phase's summary when it's only a distance ("~22–26 km"): the bar shows it, not the date line. */
export function summaryKm(summary: string): string | null {
  return /^~?\s*\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*km$/.test(summary.trim()) ? summary.trim() : null;
}

/** 8.44 → "8.4", 13 → "13". */
export function fmtKm(km: number): string {
  const r = Math.round(km * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * A done run's row subtitle (item 209): "8.4 km · 5:02 /km · 158 bpm", leaving out what the run doesn't
 * have. The pace is the run's own, else its time over its distance. "" when there's nothing to show.
 */
export function runLine(run: Run): string {
  const km = run.distanceKm !== null && run.distanceKm > 0 ? run.distanceKm : null;
  const pace = run.paceSPerKm ?? (km !== null && run.durationS ? run.durationS / km : null);
  const s = pace !== null && pace > 0 ? Math.round(pace) : null;
  return [
    km !== null ? `${fmtKm(km)} km` : "",
    s !== null ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km` : "",
    run.avgHr ? `${Math.round(run.avgHr)} bpm` : "",
  ].filter(Boolean).join(" · ");
}
