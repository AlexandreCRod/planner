// What Training opens on (301, mockup 2.8.6 section 2, option C): a compact row for today, the week's bar that
// leads to the week plan, and small chart tiles for Runs, Futsal, Body and Lifts that lead to Progress. The tiles
// are the shape only, as Body's: a tap opens, a swipe turns the tab. The numbers come from domain/trainingToday.ts.
import { type ReactNode, useMemo } from "react";
import { shortWhen } from "../../domain/body.ts";
import { gameStats, playedGames } from "../../domain/cardio.ts";
import { formatDate, formatTime } from "../../domain/dates.ts";
import { type TodayCard, dayWord, leadLift, usualWeekKm, weeklyKm } from "../../domain/trainingToday.ts";
import { type WeekBar, colourKind, fmtKm, runLine, runOf } from "../../domain/trainingWeek.ts";
import { fmtSleep, hasRecord } from "../../domain/sleep.ts";
import { sessionStats, statLine, venueOf } from "../../domain/watchActivities.ts";
import { estimateLine, runEstimate } from "../../domain/estimate.ts";
import type { Training } from "../../store/training.ts";
import { snapshot } from "../../store/store.ts";
import { rangeStart } from "./chartMath.ts";
import { MIcon } from "./chrome.tsx";
import { FUTSAL, GYM, MiniChart, RUN, WEIGHT } from "./ProgressChart.tsx";
import { join, signed1, tapProps } from "./progressParts.tsx";
import { byMax, liftsShown, weightData } from "./TrainingProgress.tsx";
import { gameIcon, kindIcon, sessionIcon } from "./trainingParts.tsx";
import { showCardio } from "./TrainingCardio.tsx";

/**
 * Under the week's title: a short bar per session or futsal game on its days, filling in its kind's colour
 * when done, then how many are done and the km run so far (of the week's planned km, when it has one).
 */
export function WeekBarView({ bar, totalKm }: { bar: WeekBar; totalKm: string | null }) {
  const km = totalKm ? `${fmtKm(bar.km)} of ${totalKm}` : bar.km > 0 ? `${fmtKm(bar.km)} km` : "";
  return <>
    <div className="tr-bar" aria-hidden="true">
      {bar.segments.map((g, i) => <i key={i} className={`${g.kind ? `k-${g.kind}` : ""} ${g.done ? "done" : ""}`} />)}
    </div>
    <div className="tr-bar-text"><span>{bar.done} of {bar.segments.length} done</span><span>{km}</span></div>
  </>;
}

const Bub = ({ cls, icon }: { cls: string; icon: string }) => <span className={`tr-bub ${cls}`}><MIcon name={icon} size={20} /></span>;

/** The row for today. [onOpen]: where it leads; [onStart], [onLog]: its buttons, when something waits. */
export function TodayRow({ tr, card, t, onOpen, onStart, onLog }: { tr: Training; card: TodayCard; t: number; onOpen: () => void; onStart: () => void; onLog: () => void }) {
  const row = (bub: ReactNode, k: string, title: string, sub: string, label: string) => (
    <div className="tr-today" {...tapProps(onOpen)} aria-label={label}>
      {bub}
      <div className="x"><div className="k">{k}</div><div className="t">{title}</div>{sub && <div className="s">{sub}</div>}</div>
      <MIcon name="fKeyboardArrowRight" size={24} />
    </div>
  );
  const when = `Today · ${formatDate(t)}`;
  if (card.kind === "session") {
    const s = card.session, kind = colourKind({ session: s, entry: card.entry });
    return (
      <div className="tr-today">
        <Bub cls={kind ? `k-${kind}` : ""} icon={sessionIcon(s)} />
        <div className="x" {...tapProps(onOpen)} aria-label={`Open ${s.title}`}>
          <div className="k">{join(when, card.more > 0 && `${card.more} more`)}</div><div className="t">{s.title}</div>
          <div className="s">{s.detail}</div>
        </div>
        <button className="tr-tbtn line" aria-label={`Log ${s.title}`} onClick={onLog}>Log</button>
        <button className="tr-tbtn fill" aria-label={`Start ${s.title}`} onClick={onStart}>Start</button>
      </div>
    );
  }
  if (card.kind === "game") {
    const g = card.game, item = g.itemId !== undefined ? snapshot().byId.get(g.itemId) : undefined;
    const at = item && !item.allDay && item.startMin !== null ? formatTime(item.startMin) : "";
    return (
      <div className="tr-today">
        <Bub cls="k-futsal" icon={gameIcon(g)} />
        <div className="x" {...tapProps(onOpen)} aria-label={`Open ${g.title}`}>
          <div className="k">{at ? `Today · ${at}` : "Today"}</div><div className="t">{g.title}</div><div className="s">Log it after the game</div>
        </div>
        <button className="tr-tbtn line" aria-label={`Log ${g.title}`} onClick={onLog}>Log</button>
      </div>
    );
  }
  if (card.kind === "done") {
    const s = card.session, run = s?.kind === "run" ? runOf(tr.runs, s.id) : null, watch = !s ? tr.watchGames.byGame.get(card.entry.id) : undefined;
    const title = s?.title ?? card.entry.title;
    // Done with no watch data: its estimate (340), each guessed value with "≈".
    const est = run || watch ? null : s ? (s.kind === "run" ? runEstimate(s, card.entry, card.entry.doneDay ?? t, tr.runs, tr.healthSessions) : null) : tr.gameEstimates.get(card.entry.id) ?? null;
    const sub = run ? runLine(run) : watch ? statLine(sessionStats(watch, venueOf(watch, title))) : est ? estimateLine(est) : s?.detail ?? "";
    return row(<Bub cls="tr-dn" icon="fCheck" />, "Today · done", title, sub, `${title}, done. Open its log`);
  }
  if (card.kind === "place") {
    const n = `${card.left} ${card.left === 1 ? "session" : "sessions"} to place`;
    return row(<Bub cls="tr-mu" icon="oCalendarToday" />, "This week", n, "Tap to choose their days", `${n}. Open the week plan`);
  }
  const next = card.next ? `Next: ${card.next.title}, ${dayWord(card.next.day, t, formatDate)}` : "";
  return row(<Bub cls="tr-mu" icon="fDarkMode" />, "Today", "Rest day", next, `Rest day. ${next}. Open the week plan`);
}

const TILE_H = 52;
const LAST_GAMES = 10, LAST_POINTS = 30, LIFT_POINTS = 10;

/** A tile: its icon and name, the number, the line under it, the shape. */
function Tile({ icon, cls, name, value, unit, sub, chart, onOpen }: { icon: string; cls?: string; name: string; value: string; unit?: string; sub: string; chart: ReactNode; onOpen: () => void }) {
  return (
    <div className="pg-tile pg-btile tr-tile" {...tapProps(onOpen)}>
      <div className="a"><span className={`ic ${cls ?? ""}`}><MIcon name={icon} size={16} /></span>{name}</div>
      <div className="b">{value}{unit && <> <small>{unit}</small></>}</div>
      <div className="c">{sub}</div>
      {chart}
    </div>
  );
}

const shape = (pts: readonly { day: number; v: number }[], color: string, gap = Infinity) =>
  pts.length ? <MiniChart kind="line" pts={pts} domain={[pts[0].day, Math.max(pts[pts.length - 1].day, pts[0].day + 1)]} color={color} height={TILE_H} gap={gap} /> : null;

/** Runs, Futsal, Body and Lifts: where each stands, and the shape of the last while. */
export function OverviewTiles({ tr, t, onOpen }: { tr: Training; t: number; onOpen: (route: string) => void }) {
  const d = useMemo(() => {
    const weeks = weeklyKm(tr.runs, t), usual = usualWeekKm(weeks);
    const played = playedGames(tr.games, t), beat = played.filter((g) => g.session?.avgHr).slice(-LAST_GAMES);
    const { trend } = weightData(tr);
    const sleep = [...tr.sleep].reverse().find((n) => hasRecord(n, "totalMin"));
    const month = rangeStart("1M", t)!;
    const lift = leadLift(liftsShown(tr), rangeStart("3M", t)!);
    const value = lift && (byMax(lift.added, lift.pts) ? (p: typeof lift.pts[number]) => p.e1rm : (p: typeof lift.pts[number]) => p.topKg);
    const liftPts = lift ? lift.pts.flatMap((p) => { const v = value!(p); return v === null ? [] : [{ day: p.day, v }]; }).slice(-LIFT_POINTS) : [];
    return { weeks, usual, played, beat, trend: trend.slice(-LAST_POINTS), sleep, month, lift, liftPts, usualHr: gameStats(played).avgHr };
  }, [tr, t]);
  const week = d.weeks[d.weeks.length - 1], game = d.beat[d.beat.length - 1], kg = d.trend[d.trend.length - 1], top = d.liftPts[d.liftPts.length - 1];
  const earlier = d.liftPts.find((p) => p.day >= d.month);
  const slept = d.sleep && d.sleep.day >= t - 1 ? `slept ${fmtSleep(d.sleep.totalMin!)}` : "";
  return (
    <div className="pg-tiles">
      <Tile icon={kindIcon("run")} cls="k-run" name="Runs" value={week.toFixed(1)} unit="km" sub={join("this week", d.usual !== null && `avg ${Math.round(d.usual)}`)}
        onOpen={() => { showCardio("runs"); onOpen("tab=runs"); }}
        chart={<MiniChart kind="bars" pts={d.weeks.map((v, i) => ({ day: i, v }))} domain={[0, d.weeks.length - 1]} color={RUN} height={TILE_H} dimLast />} />
      <Tile icon={kindIcon("futsal")} cls="k-futsal" name="Futsal" value={game ? String(Math.round(game.session!.avgHr!)) : "–"} unit={game ? "bpm" : ""}
        sub={game ? join(shortWhen(game.day, t), d.usualHr !== null && `usual ${Math.round(d.usualHr)}`) : "No games yet"}
        onOpen={() => { showCardio("futsal"); onOpen("tab=runs"); }}
        chart={shape(d.beat.map((g) => ({ day: g.day, v: g.session!.avgHr! })), FUTSAL)} />
      <Tile icon="fAccessibility" cls="k-body" name="Body" value={kg ? kg.trend.toFixed(1) : "–"} unit={kg ? "kg" : ""} sub={slept || (kg ? shortWhen(kg.day, t) : "No weigh-ins yet")}
        onOpen={() => onOpen("tab=body")} chart={shape(d.trend.map((p) => ({ day: p.day, v: p.trend })), WEIGHT, 14)} />
      <Tile icon={kindIcon("gym")} cls="k-gym" name="Lifts" value={top ? String(Math.round(top.v * 10) / 10) : "–"} unit={top ? "kg" : ""}
        sub={d.lift && top ? join(d.lift.name.toLowerCase(), earlier && earlier !== top ? `${signed1(top.v - earlier.v)} in 1M` : shortWhen(top.day, t)) : "No lifts yet"}
        onOpen={() => onOpen("tab=lifts")} chart={shape(d.liftPts, GYM)} />
    </div>
  );
}
