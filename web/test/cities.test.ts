import { test } from "node:test";
import assert from "node:assert/strict";
import { CITIES, cityId, cityLabel, cityOf, searchCities, zoneOf } from "../src/domain/cities.ts";

test("the city table is large, unique and well-formed", () => {
  assert.ok(CITIES.length >= 150, `only ${CITIES.length} cities`);
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
  assert.ok(!names("", ["Asia/Kamchatka"]).includes("Kamchatka"));
  assert.ok(names("kamch", ["Asia/Kamchatka"]).includes("Kamchatka"));
  // A zone the table already lists isn't offered twice.
  assert.equal(names("shanghai", ["Asia/Shanghai"]).filter((n) => n === "Shanghai").length, 1);
});
