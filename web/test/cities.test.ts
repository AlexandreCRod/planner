import { test } from "node:test";
import assert from "node:assert/strict";
import { CITIES, cityId, cityLabel, cityOf, searchCities, zoneOf } from "../src/domain/cities.ts";

test("the city table is large, unique and well-formed", () => {
  assert.ok(CITIES.length >= 800, `only ${CITIES.length} cities`);
  const ids = CITIES.map(cityId);
  assert.equal(new Set(ids).size, ids.length, "two cities share an id");
  const zones = new Set((Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"));
  for (const c of CITIES) {
    assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180, c.name);
    // Every zone is one the clock can show (a link like Europe/Kiev is accepted too).
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en", { timeZone: c.zone }), c.zone);
    assert.ok(zones.has(c.zone) || c.zone.includes("/"), c.zone);
  }
});

test("ids keep the zone, with the name only when the zone has another one", () => {
  assert.equal(cityId(cityOf("Europe/Paris")!), "Europe/Paris");
  assert.equal(zoneOf("America/Los_Angeles#San Francisco"), "America/Los_Angeles");
  assert.equal(cityLabel("America/Los_Angeles#San Francisco"), "San Francisco");
  assert.equal(cityLabel("America/New_York"), "New York");
  assert.equal(cityOf("America/Los_Angeles#San Francisco")?.lat, 37.77);
  assert.equal(cityOf("Etc/Unknown"), null);
});

test("search by city or country, accents ignored, other zones only while typing", () => {
  const names = (q: string, zones: string[] = []) => searchCities(q, zones).map((c) => c.name);
  assert.ok(names("japan").includes("Osaka") && names("japan").includes("Tokyo"));
  assert.equal(names("sao")[0], "São Paulo");
  assert.equal(names("")[0], [...CITIES].map((c) => c.name).sort((a, b) => a.localeCompare(b))[0]);
  assert.ok(!names("", ["Asia/Srednekolymsk"]).includes("Srednekolymsk"));
  assert.ok(names("sredne", ["Asia/Srednekolymsk"]).includes("Srednekolymsk"));
  // A zone the table already lists isn't offered twice.
  assert.equal(names("shanghai", ["Asia/Shanghai"]).filter((n) => n === "Shanghai").length, 1);
});

test("the offline list has every European capital, big cities, other names and short country names (78)", () => {
  const names = new Set(CITIES.map((c) => c.name));
  const capitals = ["London", "Dublin", "Paris", "Brussels", "Amsterdam", "Luxembourg", "Berlin", "Bern", "Vienna", "Rome", "Madrid", "Lisbon",
    "Copenhagen", "Oslo", "Stockholm", "Helsinki", "Reykjavik", "Warsaw", "Prague", "Bratislava", "Budapest", "Ljubljana", "Zagreb", "Belgrade",
    "Sarajevo", "Podgorica", "Skopje", "Tirana", "Athens", "Sofia", "Bucharest", "Chisinau", "Kyiv", "Minsk", "Vilnius", "Riga", "Tallinn",
    "Moscow", "Ankara", "Valletta", "Monaco", "Andorra la Vella", "Nicosia", "Vaduz", "San Marino", "Vatican City", "Pristina"];
  for (const c of capitals) assert.ok(names.has(c), c);
  for (const c of ["Barcelona", "Hamburg", "Kraków", "Naples", "Thessaloniki", "Gothenburg", "Lyon", "Rotterdam", "Faro", "Antwerp"]) assert.ok(names.has(c), c);
  const first = (q: string) => searchCities(q)[0]?.name;
  assert.equal(first("lisboa"), "Lisbon");
  assert.equal(first("munchen"), "Munich");
  assert.equal(first("krakow"), "Kraków");
  assert.ok(searchCities("uk").some((c) => c.name === "Edinburgh"));
  assert.ok(searchCities("portugal").some((c) => c.name === "Coimbra") && searchCities("portugal").some((c) => c.name === "Ponta Delgada"));
  assert.ok(searchCities("TÜRKEY".replace("Ü", "U")).some((c) => c.name === "Izmir" || c.name === "İzmir"));
});
