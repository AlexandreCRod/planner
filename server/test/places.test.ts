import assert from "node:assert/strict";
import { test } from "node:test";
import { coordsOf, isGoogleHost, nameOf, parseMapsLink, placeFromUrl, splitName } from "../src/places.ts";

test("only Google Maps short links are accepted", () => {
  for (const ok of ["https://maps.app.goo.gl/AbC123xyz", "https://goo.gl/maps/Xy12Z", "https://share.google/aBcDeF", "http://maps.app.goo.gl/x"]) assert.ok(parseMapsLink(ok), ok);
  for (const bad of ["", "nope", "https://goo.gl/other", "https://www.google.com/maps/place/X", "https://maps.app.goo.gl.evil.com/x", "https://evil.com/maps.app.goo.gl",
    "https://user@maps.app.goo.gl/x", "ftp://maps.app.goo.gl/x", "http://127.0.0.1/"]) assert.equal(parseMapsLink(bad), null, bad);
});

test("hosts a redirect may pass through", () => {
  for (const ok of ["www.google.com", "google.com", "maps.google.com", "www.google.de", "www.google.co.uk", "consent.google.com", "maps.app.goo.gl"]) assert.ok(isGoogleHost(ok), ok);
  for (const bad of ["google.com.evil.com", "evilgoogle.com", "localhost", "127.0.0.1", "example.com", "goo.gl.evil.com"]) assert.ok(!isGoogleHost(bad), bad);
});

const EIFFEL = "https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813!16zL20vMDJqODE?entry=ttu";

test("a place link: name, and the pin from !3d!4d", () => {
  const p = placeFromUrl(EIFFEL)!;
  assert.equal(p.name, "Eiffel Tower");
  assert.deepEqual([p.lat, p.lng], [48.8583701, 2.2944813]);
});

test("!3d!4d (the place) wins over @ (the map's centre)", () => {
  const u = "https://www.google.com/maps/place/Caf%C3%A9+de+Flore,+172+Bd+Saint-Germain,+75006+Paris,+France/@48.8,2.3,15z/data=!4m6!3m5!8m2!3d48.854!4d2.3326";
  const p = placeFromUrl(u)!;
  assert.deepEqual([p.lat, p.lng], [48.854, 2.3326]);
  assert.equal(p.name, "Café de Flore");
  assert.equal(p.address, "172 Bd Saint-Germain, 75006 Paris, France");
  assert.equal(p.area, "Paris");
});

test("only @lat,lng, with a southern and western position", () => {
  const p = placeFromUrl("https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z")!;
  assert.deepEqual([p.lat, p.lng], [-33.8567844, 151.2152967]);
  const w = placeFromUrl("https://www.google.com/maps/@-12.5,-77.03,12z")!;
  assert.deepEqual([w.lat, w.lng, w.name], [-12.5, -77.03, "Map location"]);
});

test("q= and query= as coordinates or as a name", () => {
  assert.deepEqual(coordsOf(new URL("https://maps.google.com/?q=52.5200,13.4050")), { lat: 52.52, lng: 13.405 });
  assert.deepEqual(coordsOf(new URL("https://www.google.com/maps/search/?api=1&query=40.7128%2C-74.0060")), { lat: 40.7128, lng: -74.006 });
  assert.equal(nameOf(new URL("https://www.google.com/maps?q=Pizza+Place&ll=1.5,2.5")), "Pizza Place");
  assert.equal(nameOf(new URL("https://maps.google.com/?q=52.5,13.4")), "");
  const p = placeFromUrl("https://www.google.com/maps?q=Pizza+Place&ll=41.9,12.5")!;
  assert.deepEqual([p.name, p.lat, p.lng], ["Pizza Place", 41.9, 12.5]);
});

test("no coordinates, or nonsense ones, is no place", () => {
  assert.equal(placeFromUrl("https://www.google.com/search?q=cafe"), null);
  assert.equal(placeFromUrl("https://www.google.com/maps/@95.0,200.0,12z"), null);
  assert.equal(placeFromUrl("not a url"), null);
});

test("a full name splits into name, address and area", () => {
  assert.deepEqual(splitName("Tate Modern, Bankside, London SE1 9TG, UK"), { name: "Tate Modern", address: "Bankside, London SE1 9TG, UK", area: "London SE1 9TG" });
  assert.deepEqual(splitName("Central Park"), { name: "Central Park", address: "", area: "" });
  assert.deepEqual(splitName(""), { name: "", address: "", area: "" });
});
