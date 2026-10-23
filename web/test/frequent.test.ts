import assert from "node:assert/strict";
import { test } from "node:test";
import { frequentItems, suggestFrequent, titleKey } from "../src/domain/frequent.ts";
import { type Item, newItem } from "../src/domain/types.ts";

let nextId = 1;
const it = (over: Partial<Item>): Item => ({ ...newItem({ type: "EVENT" }), id: nextId++, updatedAt: nextId, ...over } as Item);

const items = [
  it({ title: "Gym", startDay: 1, endDay: 1, startMin: 1080, endMin: 1170, categoryId: 2 }),
  it({ title: "gym.", startDay: 8, endDay: 8, startMin: 1110, endMin: 1200, categoryId: 3, location: "Holmes Place", placeName: "Holmes Place", area: "Saldanha", lat: 38.73, lng: -9.14 }),
  it({ title: "Swim lesson", startDay: 2, endDay: 2, allDay: true }),
  it({ title: "Swim lesson", startDay: 9, endDay: 9, allDay: true }),
  it({ title: "Swim lesson", startDay: 16, endDay: 16, allDay: true }),
  it({ title: "Dentist", startDay: 3, endDay: 3, startMin: 600, endMin: 660 }),
  it({ title: "Gym", type: "TASK" }),
  it({ title: "Gym", deletedAt: 5 }),
];
const reminders = new Map([[items[1].id, [{ offsetMin: 0, type: "REMINDER" as const }, { offsetMin: 30, type: "ALARM" as const }]]]);

test("titles match without case, accents, spaces or a full stop", () => {
  assert.equal(titleKey("  Café   Luso. "), "cafe luso");
  assert.equal(titleKey("GYM!"), "gym");
});

test("frequent events: used twice or more, most used first, each as its latest one was", () => {
  const f = frequentItems(items, reminders, "EVENT");
  assert.deepEqual(f.map((x) => [x.title, x.count]), [["Swim lesson", 3], ["gym.", 2]]);
  const gym = f[1];
  assert.equal(gym.categoryId, 3);
  assert.equal(gym.startMin, 1110);
  assert.equal(gym.durationMin, 90);
  assert.deepEqual(gym.alerts, [[30, "ALARM"], [0, "REMINDER"]]);
  assert.equal(gym.place?.location, "Holmes Place");
  assert.equal(gym.place?.lat, 38.73);
  const swim = f[0];
  assert.deepEqual([swim.allDay, swim.startMin, swim.durationMin, swim.place], [true, null, null, null]);
  // Tasks are counted apart from events, and deleted items not at all.
  assert.deepEqual(frequentItems(items, reminders, "TASK"), []);
  assert.equal(frequentItems(items, reminders, "TASK", 1)[0].title, "Gym");
});

test("suggestions follow what's typed and stay while it still matches", () => {
  const f = frequentItems(items, reminders, "EVENT");
  assert.deepEqual(suggestFrequent(f, "g"), []); // one letter is too little
  assert.deepEqual(suggestFrequent(f, "gy").map((x) => x.title), ["gym."]);
  assert.deepEqual(suggestFrequent(f, "Gym").map((x) => x.title), ["gym."]);
  assert.deepEqual(suggestFrequent(f, "gym.").map((x) => x.title), ["gym."]);
  assert.deepEqual(suggestFrequent(f, "gymn"), []);
  // A later word counts too, after the titles that start with it.
  assert.deepEqual(suggestFrequent(f, "less").map((x) => x.title), ["Swim lesson"]);
  assert.deepEqual(suggestFrequent(f, "sw").map((x) => x.title), ["Swim lesson"]);
  assert.equal(suggestFrequent([...f, ...f, ...f], "s").length, 0);
  assert.equal(suggestFrequent([...f, ...f, ...f, ...f], "sw").length, 3);
});
