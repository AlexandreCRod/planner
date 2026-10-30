// Cities for the world clock (78: about a thousand, offline, in cityData.ts): every capital and the big cities of each region, with the country (so a
// search for "Japan" finds Tokyo and Osaka), the IANA time zone and where it is (for the weather).
//
// A city is stored in the world clock list as its zone ("Europe/Paris") when the zone already carries its
// name, or as "zone#Name" ("America/Los_Angeles#San Francisco") when it doesn't. Older lists hold plain
// zones only, which still read the same.
import { cityName } from "./alarms.ts";
import { CITY_DATA } from "./cityData.ts";

export interface City {
  name: string; country: string; zone: string; lat: number; lng: number;
  /** Other names it's searched by ("Lisboa", "München"). */
  aliases?: string[];
}

/** The offline list (78): about a thousand cities, every European capital and big city and the world's. */
export const CITIES: City[] = CITY_DATA.split("\n").flatMap((line) => {
  const [country, zone, ...cities] = line.split("|");
  return cities.map((c) => {
    const at = c.lastIndexOf("@");
    const [name, ...aliases] = c.slice(0, at).split("=");
    const [lat, lng] = c.slice(at + 1).split(",").map(Number);
    return aliases.length ? { name, country, zone, lat, lng, aliases } : { name, country, zone, lat, lng };
  });
});

/** How a city is kept in the world clock list: its zone, or "zone#Name" when the zone has another name. */
export const cityId = (c: City) => (c.name === cityName(c.zone) ? c.zone : `${c.zone}#${c.name}`);

/** The time zone of a stored id. */
export const zoneOf = (id: string) => { const i = id.indexOf("#"); return i < 0 ? id : id.slice(0, i); };

/** The name shown for a stored id: its own name, or the zone's city. */
export const cityLabel = (id: string) => { const i = id.indexOf("#"); return i < 0 ? cityName(id) : id.slice(i + 1); };

const byId = new Map(CITIES.map((c) => [cityId(c), c]));
const rank = new Map(CITIES.map((c, i) => [cityId(c), i]));
/** The table's city for a stored id, if it's one of them. */
export const cityOf = (id: string): City | null => byId.get(id) ?? null;

/** Lower case without accents, so "sao" finds São Paulo. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Short names a country is often typed as, to the country's name in the list. */
const COUNTRY_SHORT: Record<string, string> = {
  uk: "United Kingdom", england: "United Kingdom", scotland: "United Kingdom", wales: "United Kingdom", britain: "United Kingdom",
  us: "United States", usa: "United States", america: "United States", uae: "United Arab Emirates", holland: "Netherlands",
  "czech republic": "Czechia", drc: "DR Congo", "ivory coast": "Côte d'Ivoire", burma: "Myanmar", persia: "Iran",
  korea: "South Korea", "east timor": "Timor-Leste", swaziland: "Eswatini", macedonia: "North Macedonia",
};

export interface CityChoice { id: string; name: string; place: string }

/**
 * The cities offered for [query]: the table's cities whose name or country matches, by name; while
 * searching, also the other time zones by their city name ([zones], the IANA region/city ids) that the
 * table doesn't already list, with the region as their place.
 */
export function searchCities(query: string, zones: string[] = []): CityChoice[] {
  const q = fold(query.trim());
  const short = COUNTRY_SHORT[q];
  const table = CITIES.filter((c) => !q || fold(c.name).includes(q) || fold(c.country).includes(q)
      || c.aliases?.some((x) => fold(x).includes(q)) || (short !== undefined && c.country.startsWith(short)))
    .map((c) => ({ id: cityId(c), name: c.name, place: c.country }));
  if (q) {
    // Names that match at the start come first, then the list's own order (capitals and the biggest
    // cities first in each country: "sao" gives São Paulo before São Luís).
    const at = (c: CityChoice) => rank.get(c.id) ?? 0;
    table.sort((a, b) => Number(!fold(a.name).startsWith(q)) - Number(!fold(b.name).startsWith(q)) || at(a) - at(b));
    const listed = new Set(CITIES.map((c) => fold(cityName(c.zone))).concat(CITIES.map((c) => fold(c.name))));
    const extra = zones.filter((z) => !listed.has(fold(cityName(z))) && (fold(cityName(z)).includes(q) || fold(z).includes(q)))
      .map((z) => ({ id: z, name: cityName(z), place: z.slice(0, z.indexOf("/")) }));
    return table.concat(extra);
  }
  return table.sort((a, b) => a.name.localeCompare(b.name));
}
