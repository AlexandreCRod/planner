// "Planner Test"'s sample data (roadmap 129): a small, believable week around [today], so a test build
// opens on something to look at. Fixed ids (1-5 for the categories, 9001 and up for the items), so a reset puts
// back the same records. No reminders: the test app's alarm engine stays silent until you add one yourself.
import type { Category, Completion, Item, ItemTag, Tag } from "./types.ts";
import { newItem } from "./types.ts";
import { tagIdFor } from "./ids.ts";

export type SampleKind = "categories" | "items" | "completions" | "tags" | "itemTags";
export interface SampleRecord { kind: SampleKind; rec: Category | Item | Completion | Tag | ItemTag }

/** Monday = bit 0 ... Sunday = bit 6, like Item.weekDays; [day] is local days since 1970-01-01 (a Thursday). */
const weekBit = (day: number) => 1 << ((((day + 3) % 7) + 7) % 7);

export function sampleRecords(today: number, now: number): SampleRecord[] {
  const out: SampleRecord[] = [];
  const cat = (c: Category) => out.push({ kind: "categories", rec: c });
  cat({ id: 1, name: "Personal", color: 0xff42a5f5 | 0, defaultAlert: "REMINDER" });
  cat({ id: 2, name: "Work", color: 0xff5c6bc0 | 0, defaultAlert: "NOTIFICATION" });
  cat({ id: 3, name: "Health", color: 0xffef5350 | 0, defaultAlert: "ALARM" });
  cat({ id: 4, name: "Home", color: 0xff66bb6a | 0, defaultAlert: "REMINDER" });
  cat({ id: 5, name: "Sports", color: 0xffffa726 | 0, defaultAlert: "REMINDER", sport: true });

  let id = 9000;
  const item = (f: Partial<Item> & { type: Item["type"] }) => {
    const it = newItem({ ...f, id: ++id, createdAt: now, updatedAt: now });
    out.push({ kind: "items", rec: it });
    return it;
  };
  const event = (title: string, day: number, from: number | null, to: number | null, categoryId: number | null, more: Partial<Item> = {}) =>
    item({ type: "EVENT", title, startDay: day, endDay: day, startMin: from, endMin: to, allDay: from === null, categoryId, ...more });
  const task = (title: string, day: number | null, at: number | null, categoryId: number | null, more: Partial<Item> = {}) =>
    item({ type: "TASK", title, startDay: day, endDay: day, startMin: at, endMin: null, categoryId, ...more });

  event("Team stand-up", today, 9 * 60 + 30, 10 * 60, 2, { freq: "WEEKLY", weekDays: 0b0011111, startDay: today - 14, endDay: today - 14 });
  event("Lunch with Rita", today, 13 * 60, 14 * 60, 1, { location: "Café Central" });
  event("Futsal", today + 1, 20 * 60, 21 * 60, 5);
  event("Dentist", today + 2, 15 * 60, 15 * 60 + 45, 3);
  event("Long run", today + 3, 8 * 60, 9 * 60 + 30, 5);
  event("Mum's birthday", today + 5, null, null, 1, { freq: "YEARLY" });
  event("Weekend away", today + 8, null, null, 1, { endDay: today + 10 });

  task("Call the bank", today, 11 * 60, 1, { priority: 2 });
  task("Buy groceries", today, null, 4);
  task("Pay the electricity bill", today - 1, null, 4, { priority: 3 });
  task("Send the weekly report", today + 1, 17 * 60, 2);
  const stretch = task("Stretch 10 minutes", today - 10, null, 3, { freq: "DAILY", routine: true });
  task("Water the plants", today - 7, null, 4, { freq: "WEEKLY", weekDays: weekBit(today), routine: true });
  task("Fix the bike light", null, null, 4);
  const flights = task("Book the flights", null, null, 1, { priority: 1 });
  task("Read the new running guide", null, null, 5);

  item({ type: "NOTE", title: "Trip ideas", content: "<p>Places to see:</p><ul><li>Old town walk</li><li>The river market</li><li>Sunset at the castle</li></ul>", pinned: true, categoryId: 1 });
  item({ type: "NOTE", title: "Shopping list", content: "<p>Milk, eggs, oats, bananas, coffee</p>" });
  item({ type: "NOTE", title: "", content: "<p>Slept well. Easy day: a short walk, then work on the report.</p>", noteDay: today });

  // The routine done on most of its past days, so its streak shows.
  for (const back of [1, 2, 3, 5, 6, 7, 8]) {
    out.push({ kind: "completions", rec: { itemId: stretch.id, day: today - back, completedAt: now - back * 86_400_000 } });
  }
  const travel = { id: tagIdFor("travel"), name: "travel" };
  out.push({ kind: "tags", rec: travel });
  out.push({ kind: "itemTags", rec: { itemId: flights.id, tagId: travel.id } });
  return out;
}
