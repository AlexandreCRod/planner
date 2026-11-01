// What Training's overview says (301, mockup 2.8.6 section 2, option C): the row for today, in its five states
// (a session to start or log, a game, done, rest, nothing placed), what's next on a rest day, the weekly km for the
// Runs tile, and which lift the Lifts tile follows. Days are epoch-day numbers (domain/dates.ts).
import { dayShort, startOfWeek, weekday } from "./dates.ts";
import { type Entry, type Plan, type Session, dayOfSession, entryId, leftToPlace, sessionsOf, sessionsOnDay } from "./training.ts";
import type { Run } from "./trends.ts";

export type TodayCard =
  /** A session to start or log; [more]: the others still open today. */
  | { kind: "session"; session: Session; entry: Entry; more: number }
  /** A game still to play or log. */
  | { kind: "game"; game: Entry }
  /** Everything on today is done: the first of it (a session, or the game). */
  | { kind: "done"; session: Session | null; entry: Entry }
  /** Nothing today: what's next, if anything. */
  | { kind: "rest"; next: NextUp | null }
  /** Sessions still have no day this week. */
  | { kind: "place"; left: number };

export interface NextUp { title: string; day: number }

/** The day's game (futsal, or another sport by its own title, 267). */
export const gameOn = (plan: Plan, day: number, entries: ReadonlyMap<string, Entry>): Entry | undefined =>
  [...entries.values()].find((e) => e.planId === plan.id && e.kind === "futsal" && e.deletedAt === null && e.day === day);

/** The first session or game after [t] not done or skipped, the session first on a day that has both. */
export function nextUp(plan: Plan, entries: ReadonlyMap<string, Entry>, t: number): NextUp | null {
  const ahead: NextUp[] = [];
  for (const s of sessionsOf(plan)) {
    const e = entries.get(entryId(plan.id, s.id)), day = dayOfSession(s, e);
    if (day !== null && day > t && (e?.status ?? "planned") === "planned") ahead.push({ title: s.title, day });
  }
  const games = [...entries.values()].filter((e) => e.planId === plan.id && e.kind === "futsal" && e.deletedAt === null && e.day !== null && e.day > t && e.status === "planned");
  for (const g of games) ahead.push({ title: g.title, day: g.day! });
  return ahead.reduce<NextUp | null>((a, b) => (!a || b.day < a.day ? b : a), null);
}

/** The row for today: a session waiting comes first, then a game, then done; a free day says what's to place, else rest. */
export function todayCard(plan: Plan, entries: ReadonlyMap<string, Entry>, t: number): TodayCard {
  const on = sessionsOnDay(plan, t, entries).filter((x) => x.entry.status !== "skipped");
  const game = gameOn(plan, t, entries);
  const open = on.filter((x) => x.entry.status === "planned");
  if (open.length) return { kind: "session", session: open[0].session, entry: open[0].entry, more: open.length - 1 };
  if (game && game.status !== "done") return { kind: "game", game };
  if (on.length) return { kind: "done", session: on[0].session, entry: on[0].entry };
  if (game) return { kind: "done", session: null, entry: game };
  const left = leftToPlace(plan, t, entries).length;
  return left ? { kind: "place", left } : { kind: "rest", next: nextUp(plan, entries, t) };
}

/** "tomorrow", "Fri" within the week, else [far] writes it. */
export const dayWord = (day: number, t: number, far: (day: number) => string) =>
  (day === t + 1 ? "tomorrow" : day - t < 7 ? dayShort(weekday(day)) : far(day));

/** The km run in each of the [n] Monday weeks to this one, oldest first; this week's is still filling. */
export function weeklyKm(runs: readonly Pick<Run, "day" | "distanceKm">[], t: number, n = 8): number[] {
  const end = startOfWeek(t, true) + 7, out = new Array<number>(n).fill(0);
  for (const r of runs) {
    const i = n - 1 - Math.floor((end - 1 - r.day) / 7);
    if (r.day < end && i >= 0 && i < n) out[i] += r.distanceKm ?? 0;
  }
  return out;
}

/** The average of the finished weeks that had any km; null with none. */
export function usualWeekKm(weeks: readonly number[]): number | null {
  const done = weeks.slice(0, -1).filter((k) => k > 0);
  return done.length ? done.reduce((a, b) => a + b, 0) / done.length : null;
}

/** The lift the tile follows: the one done most often since [since], else the one done last; the plan's order breaks ties. */
export function leadLift<L extends { pts: readonly { day: number }[] }>(lifts: readonly L[], since: number): L | null {
  let best: L | null = null, score = -1, last = -Infinity;
  for (const l of lifts) {
    const n = l.pts.filter((p) => p.day >= since).length, d = l.pts[l.pts.length - 1]?.day ?? -Infinity;
    if (n > score || (n === score && n === 0 && d > last)) { best = l; score = n; last = d; }
  }
  return best;
}
