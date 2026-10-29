// Placement rules (item 214): which of a phase's rules (planner.json "placement", read in training.ts) a
// session or a futsal game breaks on a day. Nothing is ever blocked: the page asks before placing it
// anyway, and marks what breaks a rule now.
// - Only what's on a day counts: a session on the day it was done, else the day it's placed, never if
//   skipped (countedDay); futsal the same way (futsalDay), its games being the calendar's futsal events as
//   trainingEntries gives them (item 240). Unplaced sessions, optional or not, never count.
// - A rule is its phase's. Rules between two items (the day before, the same day, days before) count when
//   either item's day is in a phase with the rule, so they see across a phase's edge. gap, max_count,
//   rest_days, weekdays, not_after and none look at the phase's own days. max_in_a_row counts days in a
//   row across phases, each day held to the max of the phase it's in.
// - When a and b pick the same things (runs-same-day), they mean two different items.
// - Notes (same_day_note) are hints, never breaches: brokenRules lists them, brokenNow and dayFit don't.
import { weekday } from "./dates.ts";
import { count } from "./plural.ts";
import {
  type Entry, type Plan, type PlacementRule, type Selector, type Session, countedDay, entryId, futsalDay, sessionsOf,
} from "./training.ts";

/** A session (by its id), or a futsal game (by its entry id, futsalLogId(event, day); null for a new one). */
export type ItemRef = { session: string } | { futsal: string | null };

/** A session or a futsal game on a day. */
export interface PlacedItem {
  /** The session's id, or the futsal entry's id ("" for a new one). */
  key: string;
  /** Null for futsal. */
  session: Session | null;
  /** Its entry, when there is one. */
  entry: Entry | null;
  /** The day it counts on. */
  day: number;
  /** "Long run", "Futsal". */
  title: string;
}

/** A rule broken (or a note that applies). */
export interface Breach {
  rule: PlacementRule;
  /** The phase whose rule it is. */
  phase: number;
  /**
   * The other items it's about, by day ("the long run on Sat 7 Nov"). Empty for the rules about one item
   * (weekdays, not_after, none) and about whole days (rest_days, max_in_a_row: see [span]).
   */
  others: PlacedItem[];
  /** For rest_days, the phase's days; for max_in_a_row, the days in a row. */
  span: [number, number] | null;
}

/** The worst level a placement breaks. */
export type Fit = "none" | "ideally" | "avoid";

/** A breach as found: every item it's about, the ones to mark, and whether to list them as [Breach.others]. */
interface Found { rule: PlacementRule; phase: number; items: PlacedItem[]; mark: PlacedItem[]; listed: boolean; span: [number, number] | null }

const phaseAt = (plan: Plan, day: number) => plan.phases.findIndex((p) => day >= p.start && day <= p.end);

function matches(sel: Selector, it: PlacedItem): boolean {
  const s = it.session;
  // Another sport (267) isn't futsal: only the rules about every day (rest days, days in a row) count it.
  if ("kind" in sel) return s ? s.kind === sel.kind : sel.kind === "futsal" && !it.entry?.sport;
  if (!s) return false;
  if ("dayType" in sel) return s.dayType === sel.dayType;
  if ("tag" in sel) return s.tags.includes(sel.tag);
  return sel.sessions.includes(s.id);
}

/** Everything of the plan that counts on a day: sessions in the plan's order, then futsal. */
export function placedItems(plan: Plan, entries: ReadonlyMap<string, Entry>): PlacedItem[] {
  const out: PlacedItem[] = [];
  for (const s of sessionsOf(plan)) {
    const e = entries.get(entryId(plan.id, s.id));
    const day = countedDay(s, e);
    if (day !== null) out.push({ key: s.id, session: s, entry: e ?? null, day, title: s.title });
  }
  for (const e of entries.values()) {
    const day = e.planId === plan.id ? futsalDay(e) : null;
    if (day !== null) out.push({ key: e.id, session: null, entry: e, day, title: e.sport ? e.title : "Futsal" });
  }
  return out;
}

/** Every rule broken by [items] as they lie, and every note that applies. */
function evaluate(plan: Plan, items: PlacedItem[]): Found[] {
  const out: Found[] = [];
  const seen = new Set<string>();
  // The same pair can come up from both phases at an edge, and a same-selector pair both ways round.
  const add = (f: Found) => {
    const k = `${f.rule.id}|${f.span ?? ""}|${f.items.map((it) => it.key).sort().join(",")}`;
    if (!seen.has(k)) { seen.add(k); out.push(f); }
  };
  plan.phases.forEach((ph, phase) => {
    const inPhase = (it: PlacedItem) => it.day >= ph.start && it.day <= ph.end;
    const own = items.filter(inPhase);
    for (const rule of ph.placement) {
      const c = rule.check;
      const found = (its: PlacedItem[], mark = its) => add({ rule, phase, items: its, mark, listed: true, span: null });
      const of = (sel: Selector, list = own) => list.filter((it) => matches(sel, it));
      switch (c.type) {
        case "not_day_before": case "not_same_day": case "same_day_note": case "min_days_before":
          for (const x of of(c.a, items)) for (const y of of(c.b, items)) {
            if (x === y || (!inPhase(x) && !inPhase(y))) continue;
            const ahead = y.day - x.day;
            // min_days_before: a b too soon after an a. A b before the a is another week's matter.
            if (c.type === "not_day_before" ? ahead === 1 : c.type === "min_days_before" ? ahead >= 0 && ahead < c.days : ahead === 0) found([x, y]);
          }
          break;
        case "gap": {
          const list = of(c.a).sort((x, y) => x.day - y.day);
          for (let i = 1; i < list.length; i++) {
            const g = list[i].day - list[i - 1].day;
            if ((c.minDays !== null && g < c.minDays) || (c.maxDays !== null && g > c.maxDays)) found([list[i - 1], list[i]]);
          }
          break;
        }
        case "rest_days": {
          // About the whole phase: every item in it is involved and marked, none listed.
          const busy = new Set(own.map((it) => it.day));
          if (ph.end - ph.start + 1 - busy.size < c.min) add({ rule, phase, items: own, mark: own, listed: false, span: [ph.start, ph.end] });
          break;
        }
        case "weekdays":
          for (const x of of(c.a)) if (!c.days.includes(weekday(x.day))) found([x]);
          break;
        case "max_count": {
          // All of them are involved (placing any of them breaks it); the ones past the max, by day, are marked.
          const list = of(c.a).sort((x, y) => x.day - y.day);
          if (list.length > c.max) found(list, list.slice(c.max));
          break;
        }
        case "not_after":
          for (const x of of(c.a)) if (x.day > c.day) found([x]);
          break;
        case "none":
          for (const x of of(c.a)) found([x]);
          break;
        case "max_in_a_row":
          break; // below, across phases
      }
    }
  });

  // Days in a row with something on them, across phases. Each day past the max of its own phase's rule
  // breaks it; the items on those days are marked, and every item in the row is involved.
  const busy = [...new Set(items.map((it) => it.day))].sort((a, b) => a - b);
  for (let i = 0; i < busy.length; i++) {
    const start = busy[i];
    while (i + 1 < busy.length && busy[i + 1] === busy[i] + 1) i++;
    const end = busy[i];
    const late = new Map<string, { rule: PlacementRule; phase: number; days: Set<number> }>();
    for (let d = start; d <= end; d++) {
      const phase = phaseAt(plan, d);
      if (phase < 0) continue;
      for (const rule of plan.phases[phase].placement) {
        if (rule.check.type !== "max_in_a_row" || d - start + 1 <= rule.check.max) continue;
        if (!late.has(rule.id)) late.set(rule.id, { rule, phase, days: new Set() });
        late.get(rule.id)!.days.add(d);
      }
    }
    const row = items.filter((it) => it.day >= start && it.day <= end);
    for (const { rule, phase, days } of late.values()) {
      add({ rule, phase, items: row, mark: row.filter((it) => days.has(it.day)), listed: false, span: [start, end] });
    }
  }
  return out;
}

const LEVEL_ORDER = ["avoid", "ideally", "note"];

/** [found] as [subject] sees them: one breach per rule, listing the other items, worst first. */
function breachesOf(found: Found[], subject: PlacedItem): Breach[] {
  const by = new Map<string, Breach>();
  for (const f of found) {
    const k = `${f.rule.id}|${f.phase}|${f.span ?? ""}`;
    const b = by.get(k) ?? { rule: f.rule, phase: f.phase, others: [], span: f.span };
    by.set(k, b);
    if (f.listed) for (const it of f.items) if (it !== subject && !b.others.includes(it)) b.others.push(it);
  }
  const out = [...by.values()];
  for (const b of out) b.others.sort((x, y) => x.day - y.day);
  return out.sort((a, b) => LEVEL_ORDER.indexOf(a.rule.level) - LEVEL_ORDER.indexOf(b.rule.level));
}

/**
 * The rules [item] would break on [day], and the notes that would apply, for the popup. The item is taken
 * as moved: its old day no longer counts. A rule already broken by others without it isn't its concern,
 * but a week-level one it would be part of (no rest day in its new week) is.
 */
export function brokenRules(plan: Plan, entries: ReadonlyMap<string, Entry>, item: ItemRef, day: number): Breach[] {
  const items = placedItems(plan, entries);
  let moved: PlacedItem;
  if ("session" in item) {
    const s = sessionsOf(plan).find((x) => x.id === item.session);
    if (!s) return [];
    moved = { key: s.id, session: s, entry: entries.get(entryId(plan.id, s.id)) ?? null, day, title: s.title };
  } else {
    moved = { key: item.futsal ?? "", session: null, entry: (item.futsal && entries.get(item.futsal)) || null, day, title: "Futsal" };
    if (moved.entry?.sport) moved.title = moved.entry.title;
  }
  const rest = items.filter((it) => it.key !== moved.key || !!it.session !== !!moved.session);
  const all = [...rest, moved];
  return breachesOf(evaluate(plan, all).filter((f) => f.items.includes(moved)), moved);
}

/**
 * For the marker: the placed items (by [PlacedItem.key]) that break an avoid or ideally rule now, with
 * the rules. Between two items both are marked; max_count marks the ones past the max by day; rest_days
 * the whole phase; max_in_a_row the items on the days past the max.
 */
export function brokenNow(plan: Plan, entries: ReadonlyMap<string, Entry>): Map<string, Breach[]> {
  const items = placedItems(plan, entries);
  const found = evaluate(plan, items).filter((f) => f.rule.level !== "note");
  const out = new Map<string, Breach[]>();
  for (const it of items) {
    const mine = found.filter((f) => f.mark.includes(it));
    if (mine.length) out.set(it.key, breachesOf(mine, it));
  }
  return out;
}

/** The worst level among [breaches]; notes don't count. */
export function worstLevel(breaches: readonly Breach[]): Fit {
  if (breaches.some((b) => b.rule.level === "avoid")) return "avoid";
  return breaches.some((b) => b.rule.level === "ideally") ? "ideally" : "none";
}

/** For the popup's row of days: the worst level [item] would break on each of [days]. */
export function dayFit(plan: Plan, entries: ReadonlyMap<string, Entry>, item: ItemRef, days: Iterable<number>): Map<number, Fit> {
  return new Map([...days].map((d) => [d, worstLevel(brokenRules(plan, entries, item, d))]));
}

/** Only the rules broken: notes left out. */
export const breachesOnly = (breaches: readonly Breach[]) => breaches.filter((b) => b.rule.level !== "note");

/** The sheet's subtitle: "breaks 1 rule, and 1 it ideally shouldn't"; "breaks 2 rules it ideally shouldn't". */
export function breachSummary(breaches: readonly Breach[]): string {
  const avoid = breaches.filter((b) => b.rule.level === "avoid").length;
  const ideally = breaches.filter((b) => b.rule.level === "ideally").length;
  if (avoid && ideally) return `breaks ${count(avoid, "rule")}, and ${ideally} it ideally shouldn't`;
  if (avoid) return `breaks ${count(avoid, "rule")}`;
  return ideally ? `breaks ${count(ideally, "rule")} it ideally shouldn't` : "";
}
