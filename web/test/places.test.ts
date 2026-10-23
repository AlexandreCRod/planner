import assert from "node:assert/strict";
import { test } from "node:test";
import { mapsQuery, NO_PLACE, photonUrl, placeFields, placeLines, placesFromPhoton, stableMerge, usualArea, type Place } from "../src/domain/places.ts";
import type { Item } from "../src/domain/types.ts";

const feature = (props: Record<string, string>, lng: number, lat: number) => ({ geometry: { coordinates: [lng, lat] }, properties: props });

test("Photon's address: the query, and a rough position only when one is known", () => {
  const a = new URL(photonUrl("decathlon", null));
  assert.equal(a.origin + a.pathname, "https://photon.komoot.io/api/");
  assert.equal(a.searchParams.get("q"), "decathlon");
  assert.equal(a.searchParams.get("lat"), null);
  const b = new URL(photonUrl("café luso", { lat: 38.736946, lng: -9.142685 }));
  assert.equal(b.searchParams.get("q"), "café luso");
  // Rounded to about a kilometre: no exact position leaves the phone.
  assert.equal(b.searchParams.get("lat"), "38.74");
  assert.equal(b.searchParams.get("lon"), "-9.14");
});

test("Photon's answer becomes named places with an address and an area", () => {
  const r = placesFromPhoton({ features: [
    feature({ name: "Decathlon", street: "Rua da Quinta", housenumber: "3", postcode: "2610-999", city: "Amadora", district: "Alfragide", country: "Portugal" }, -9.22, 38.73),
    feature({ name: "Decathlon", street: "Rua da Quinta", housenumber: "3", city: "Amadora", district: "Alfragide", country: "Portugal" }, -9.22, 38.73), // the same again
    feature({ street: "Avenida da Liberdade", housenumber: "10", city: "Lisboa", country: "Portugal" }, -9.14, 38.72),
    { geometry: {}, properties: { name: "No coordinates" } },
  ] });
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { name: "Decathlon", address: "Rua da Quinta 3, Alfragide, 2610-999 Amadora, Portugal", area: "Alfragide", lat: 38.73, lng: -9.22 });
  assert.equal(r[1].name, "Avenida da Liberdade 10");
  assert.equal(r[1].address, "Lisboa, Portugal");
  assert.equal(r[1].area, "Lisboa");
  assert.deepEqual(placesFromPhoton(null), []);
  assert.deepEqual(placesFromPhoton({ nope: 1 }), []);
});

const pl = (name: string, lat = 1, lng = 1): Place => ({ name, address: "", area: "", lat, lng });

test("suggestions never jump about as more is typed", () => {
  const shown = [pl("A"), pl("B"), pl("C")];
  // B goes, A and C keep their order, D comes after them.
  assert.deepEqual(stableMerge(shown, [pl("D"), pl("C"), pl("A")]).map((p) => p.name), ["A", "C", "D"]);
  assert.deepEqual(stableMerge([], [pl("X"), pl("Y")]).map((p) => p.name), ["X", "Y"]);
  assert.equal(stableMerge([], Array.from({ length: 9 }, (_, i) => pl(`P${i}`, i))).length, 6);
  // Same name in another town is another place.
  assert.equal(stableMerge([pl("Decathlon", 1)], [pl("Decathlon", 2)])[0].lat, 2);
});

const item = (over: Partial<Item>): Item => ({ id: "x", updatedAt: 0, ...over } as Item);

test("the usual area is the middle of the latest places, not thrown by one far away", () => {
  assert.equal(usualArea([item({}), item({ lat: null, lng: null })]), null);
  const a = usualArea([item({ lat: 38.7, lng: -9.1, updatedAt: 3 }), item({ lat: 38.8, lng: -9.2, updatedAt: 2 }), item({ lat: 40.4, lng: -3.7, updatedAt: 1 })]);
  assert.deepEqual(a, { lat: 38.8, lng: -9.1 });
});

test("how a place reads, and what Google Maps is asked", () => {
  // An item from before places had names: its text alone.
  assert.deepEqual(placeLines({ location: "Rua Augusta 5" }), { main: "Rua Augusta 5", sub: "" });
  assert.equal(mapsQuery({ location: "Rua Augusta 5" }), "Rua Augusta 5");
  assert.equal(mapsQuery({ location: "Home", lat: 38.7, lng: -9.1 }), "38.7,-9.1");
  const picked = { ...placeFields({ name: "Decathlon", address: "Rua da Quinta 3, Amadora", area: "Alfragide", lat: 38.73, lng: -9.22 }) };
  assert.deepEqual(placeLines(picked), { main: "Decathlon", sub: "Alfragide" });
  // Renamed by the user: the place's own name shows under it.
  assert.deepEqual(placeLines({ ...picked, location: "Shoes shop" }), { main: "Shoes shop", sub: "Decathlon · Alfragide" });
  assert.equal(mapsQuery({ ...picked, location: "Shoes shop" }), "Decathlon, Rua da Quinta 3, Amadora");
  assert.deepEqual(placeLines(NO_PLACE), { main: "", sub: "" });
});
