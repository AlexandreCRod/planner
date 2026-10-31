// Frequent items: tasks and events added again and again under the same title ("Gym", "Swim lesson").
// Worked out from the items already there, so nothing new is stored or synced. Typing on the add line
// offers the ones whose title starts with what's typed; picking one fills in what it usually has
// (category, how long, the time, reminders and place). Pure, checked by test/frequent.test.ts.
import type { Item, ItemType, AlertType } from "./types.ts";

/** What a frequent item usually is, taken from the latest one with that title. */
export interface Frequent {
  title: string;
  type: ItemType;
  /** How many items have had the title. */
  count: number;
  categoryId: number | null;
  color: number | null;
  /** Minutes after midnight, or null when it has no time. */
  startMin: number | null;
  /** How long an event lasts, in minutes (null: no time, or a task). */
  durationMin: number | null;
  allDay: boolean;
  alerts: [number, AlertType][];
  place: Pick<Item, "location" | "placeName" | "address" | "area" | "lat" | "lng"> | null;
  lastAt: number;
}

/** Titles compared without case, accents, extra spaces or a trailing full stop. */
export const titleKey = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").trim();

/**
 * The frequent tasks or events: titles used at least [min] times (a repeating series is one item), the
 * most used first, then the latest. Each one is what its latest item was.
 */
export function frequentItems(items: readonly Item[], reminders: ReadonlyMap<number, readonly { offsetMin: number; type: AlertType; wake?: boolean }[]>,
  type: ItemType, min = 2): Frequent[] {
  const groups = new Map<string, Item[]>();
  for (const i of items) {
    if (i.type !== type || i.deletedAt != null || !i.title.trim()) continue;
    const k = titleKey(i.title);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const out: Frequent[] = [];
  for (const list of groups.values()) {
    if (list.length < min) continue;
    const last = list.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    const timed = last.startMin !== null && !last.allDay;
    const sameDay = last.endDay === null || last.endDay === last.startDay;
    out.push({
      title: last.title.trim(),
      type,
      count: list.length,
      categoryId: last.categoryId,
      color: last.color,
      startMin: timed ? last.startMin : null,
      durationMin: type === "EVENT" && timed && sameDay && last.endMin !== null && last.endMin > last.startMin! ? last.endMin - last.startMin! : null,
      allDay: type === "EVENT" && last.allDay,
      // Wake-up alarms (245) belong to that morning's event, and would come back as plain alarms.
      alerts: (reminders.get(last.id) ?? []).filter((r) => !r.wake).map((r) => [r.offsetMin, r.type] as [number, AlertType]).sort((a, b) => b[0] - a[0]),
      place: (last.location ?? "").trim()
        ? { location: last.location, placeName: last.placeName ?? "", address: last.address ?? "", area: last.area ?? "", lat: last.lat ?? null, lng: last.lng ?? null }
        : null,
      lastAt: last.updatedAt,
    });
  }
  return out.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/**
 * The frequent items to offer for [typed]: those whose title (or one of its words) starts with it,
 * those starting with it first. Nothing for fewer than two letters. One already typed out in full
 * stays offered, so it doesn't vanish just before it would be picked.
 */
export function suggestFrequent(all: readonly Frequent[], typed: string, max = 3): Frequent[] {
  const q = titleKey(typed);
  if (q.length < 2) return [];
  const starts: Frequent[] = [], inside: Frequent[] = [];
  for (const f of all) {
    const k = titleKey(f.title), words = k.split(" ");
    if (k.startsWith(q)) starts.push(f);
    else if (words.some((_, i) => i > 0 && words.slice(i).join(" ").startsWith(q))) inside.push(f);
  }
  return [...starts, ...inside].slice(0, max);
}
