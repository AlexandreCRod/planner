// The world clock's weather: a symbol and the temperature now, for each city, from Open-Meteo. The only
// thing sent is the city's coordinates (from the table below, or, for a city not in it, Open-Meteo's own
// place search by the city's name, asked once and remembered). Nothing about the phone or its owner
// leaves it. Values are kept between visits and asked again about every 30 minutes while on screen.
import { useEffect, useState } from "react";
import { forecastAt, weatherSymbol, zoneHour } from "../domain/alarms.ts";
import { cityLabel, cityOf, zoneOf } from "../domain/cities.ts";
import { native } from "./native.ts";

/** Where the city of each time zone is, as [latitude, longitude], to two decimals. */
const COORDS: Record<string, [number, number]> = {
  "Africa/Abidjan": [5.36, -4.01], "Africa/Accra": [5.6, -0.19], "Africa/Addis_Ababa": [9.03, 38.74], "Africa/Algiers": [36.75, 3.06],
  "Africa/Cairo": [30.04, 31.24], "Africa/Casablanca": [33.57, -7.59], "Africa/Dakar": [14.69, -17.44], "Africa/Dar_es_Salaam": [-6.79, 39.21],
  "Africa/Johannesburg": [-26.2, 28.05], "Africa/Kampala": [0.35, 32.58], "Africa/Khartoum": [15.5, 32.56], "Africa/Kinshasa": [-4.44, 15.27],
  "Africa/Lagos": [6.52, 3.38], "Africa/Luanda": [-8.84, 13.23], "Africa/Maputo": [-25.97, 32.57], "Africa/Nairobi": [-1.29, 36.82],
  "Africa/Tripoli": [32.89, 13.19], "Africa/Tunis": [36.81, 10.18], "Africa/Windhoek": [-22.56, 17.08], "Africa/Harare": [-17.83, 31.05],
  "America/Anchorage": [61.22, -149.9], "America/Argentina/Buenos_Aires": [-34.6, -58.38], "America/Asuncion": [-25.26, -57.58],
  "America/Bogota": [4.71, -74.07], "America/Caracas": [10.48, -66.9], "America/Chicago": [41.88, -87.63], "America/Denver": [39.74, -104.99],
  "America/Detroit": [42.33, -83.05], "America/Edmonton": [53.55, -113.49], "America/Guatemala": [14.63, -90.51], "America/Halifax": [44.65, -63.58],
  "America/Havana": [23.11, -82.37], "America/Lima": [-12.05, -77.04], "America/Los_Angeles": [34.05, -118.24], "America/Mexico_City": [19.43, -99.13],
  "America/Montevideo": [-34.9, -56.16], "America/New_York": [40.71, -74.01], "America/Panama": [8.98, -79.52], "America/Phoenix": [33.45, -112.07],
  "America/Puerto_Rico": [18.47, -66.11], "America/Santiago": [-33.45, -70.67], "America/Santo_Domingo": [18.49, -69.93], "America/Sao_Paulo": [-23.55, -46.63],
  "America/St_Johns": [47.56, -52.71], "America/Toronto": [43.65, -79.38], "America/Vancouver": [49.28, -123.12], "America/Winnipeg": [49.9, -97.14],
  "America/La_Paz": [-16.5, -68.15], "America/Manaus": [-3.12, -60.02], "America/Fortaleza": [-3.73, -38.53], "America/Recife": [-8.05, -34.88],
  "America/Bahia": [-12.97, -38.5], "America/Belem": [-1.46, -48.5], "America/Guayaquil": [-2.17, -79.92], "America/Costa_Rica": [9.93, -84.08],
  "America/El_Salvador": [13.69, -89.22], "America/Tegucigalpa": [14.07, -87.19], "America/Managua": [12.11, -86.24], "America/Jamaica": [17.97, -76.79],
  "America/Monterrey": [25.69, -100.32], "America/Tijuana": [32.51, -117.04], "America/Cancun": [21.16, -86.85], "America/Regina": [50.45, -104.62],
  "America/Nuuk": [64.18, -51.72], "America/Barbados": [13.1, -59.61], "America/Port_of_Spain": [10.65, -61.5], "America/Boise": [43.62, -116.2],
  "America/Indiana/Indianapolis": [39.77, -86.16], "America/Kentucky/Louisville": [38.25, -85.76], "Pacific/Honolulu": [21.31, -157.86],
  "Asia/Almaty": [43.24, 76.89], "Asia/Amman": [31.95, 35.93], "Asia/Baghdad": [33.31, 44.36], "Asia/Baku": [40.41, 49.87], "Asia/Bangkok": [13.76, 100.5],
  "Asia/Beirut": [33.89, 35.5], "Asia/Colombo": [6.93, 79.85], "Asia/Damascus": [33.51, 36.28], "Asia/Dhaka": [23.81, 90.41], "Asia/Dubai": [25.2, 55.27],
  "Asia/Ho_Chi_Minh": [10.82, 106.63], "Asia/Hong_Kong": [22.32, 114.17], "Asia/Jakarta": [-6.21, 106.85], "Asia/Jerusalem": [31.77, 35.21],
  "Asia/Kabul": [34.56, 69.21], "Asia/Karachi": [24.86, 67.01], "Asia/Kathmandu": [27.72, 85.32], "Asia/Kolkata": [22.57, 88.36], "Asia/Kuala_Lumpur": [3.14, 101.69],
  "Asia/Kuwait": [29.38, 47.99], "Asia/Macau": [22.2, 113.54], "Asia/Manila": [14.6, 120.98], "Asia/Muscat": [23.59, 58.41], "Asia/Qatar": [25.29, 51.53],
  "Asia/Riyadh": [24.71, 46.68], "Asia/Seoul": [37.57, 126.98], "Asia/Shanghai": [31.23, 121.47], "Asia/Singapore": [1.35, 103.82], "Asia/Taipei": [25.03, 121.57],
  "Asia/Tashkent": [41.3, 69.24], "Asia/Tbilisi": [41.72, 44.79], "Asia/Tehran": [35.69, 51.39], "Asia/Tokyo": [35.68, 139.69], "Asia/Ulaanbaatar": [47.89, 106.91],
  "Asia/Yangon": [16.87, 96.2], "Asia/Yerevan": [40.18, 44.51], "Asia/Bahrain": [26.23, 50.59], "Asia/Phnom_Penh": [11.56, 104.93], "Asia/Vientiane": [17.98, 102.63],
  "Asia/Yekaterinburg": [56.84, 60.61], "Asia/Novosibirsk": [55.01, 82.93], "Asia/Vladivostok": [43.12, 131.89], "Asia/Irkutsk": [52.29, 104.3],
  "Asia/Krasnoyarsk": [56.01, 92.85], "Asia/Omsk": [54.99, 73.37], "Asia/Thimphu": [27.47, 89.64], "Asia/Brunei": [4.9, 114.94], "Asia/Nicosia": [35.19, 33.38],
  "Asia/Pyongyang": [39.04, 125.76], "Asia/Bishkek": [42.87, 74.59], "Asia/Dushanbe": [38.56, 68.79], "Asia/Ashgabat": [37.96, 58.33], "Asia/Makassar": [-5.15, 119.43],
  "Asia/Jayapura": [-2.53, 140.72], "Asia/Dili": [-8.56, 125.57], "Asia/Aden": [12.79, 45.02], "Asia/Gaza": [31.5, 34.47],
  "Atlantic/Azores": [37.74, -25.67], "Atlantic/Canary": [28.12, -15.43], "Atlantic/Madeira": [32.65, -16.91], "Atlantic/Reykjavik": [64.15, -21.94],
  "Atlantic/Bermuda": [32.29, -64.78], "Atlantic/Cape_Verde": [14.93, -23.51], "Atlantic/Faroe": [62.01, -6.77],
  "Australia/Adelaide": [-34.93, 138.6], "Australia/Brisbane": [-27.47, 153.03], "Australia/Darwin": [-12.46, 130.84], "Australia/Hobart": [-42.88, 147.33],
  "Australia/Melbourne": [-37.81, 144.96], "Australia/Perth": [-31.95, 115.86], "Australia/Sydney": [-33.87, 151.21], "Australia/Canberra": [-35.28, 149.13],
  "Europe/Amsterdam": [52.37, 4.9], "Europe/Andorra": [42.51, 1.52], "Europe/Athens": [37.98, 23.73], "Europe/Belgrade": [44.79, 20.45], "Europe/Berlin": [52.52, 13.41],
  "Europe/Bratislava": [48.15, 17.11], "Europe/Brussels": [50.85, 4.35], "Europe/Bucharest": [44.43, 26.1], "Europe/Budapest": [47.5, 19.04],
  "Europe/Chisinau": [47.01, 28.86], "Europe/Copenhagen": [55.68, 12.57], "Europe/Dublin": [53.35, -6.26], "Europe/Gibraltar": [36.14, -5.35],
  "Europe/Helsinki": [60.17, 24.94], "Europe/Istanbul": [41.01, 28.98], "Europe/Kaliningrad": [54.71, 20.51], "Europe/Kyiv": [50.45, 30.52], "Europe/Kiev": [50.45, 30.52],
  "Europe/Lisbon": [38.72, -9.14], "Europe/Ljubljana": [46.06, 14.51], "Europe/London": [51.51, -0.13], "Europe/Luxembourg": [49.61, 6.13], "Europe/Madrid": [40.42, -3.7],
  "Europe/Malta": [35.9, 14.51], "Europe/Minsk": [53.9, 27.56], "Europe/Monaco": [43.74, 7.42], "Europe/Moscow": [55.76, 37.62], "Europe/Oslo": [59.91, 10.75],
  "Europe/Paris": [48.86, 2.35], "Europe/Prague": [50.08, 14.44], "Europe/Riga": [56.95, 24.11], "Europe/Rome": [41.9, 12.5], "Europe/Samara": [53.2, 50.15],
  "Europe/Sarajevo": [43.86, 18.41], "Europe/Skopje": [42, 21.43], "Europe/Sofia": [42.7, 23.32], "Europe/Stockholm": [59.33, 18.07], "Europe/Tallinn": [59.44, 24.75],
  "Europe/Tirane": [41.33, 19.82], "Europe/Vienna": [48.21, 16.37], "Europe/Vilnius": [54.69, 25.28], "Europe/Volgograd": [48.71, 44.51], "Europe/Warsaw": [52.23, 21.01],
  "Europe/Zagreb": [45.81, 15.98], "Europe/Zurich": [47.38, 8.54], "Europe/Podgorica": [42.43, 19.26], "Europe/San_Marino": [43.94, 12.45], "Europe/Vatican": [41.9, 12.45],
  "Europe/Vaduz": [47.14, 9.52], "Europe/Guernsey": [49.45, -2.54], "Europe/Jersey": [49.19, -2.11], "Europe/Isle_of_Man": [54.15, -4.48],
  "Indian/Maldives": [4.18, 73.51], "Indian/Mauritius": [-20.16, 57.5], "Indian/Reunion": [-20.88, 55.45], "Indian/Mahe": [-4.62, 55.45], "Indian/Antananarivo": [-18.88, 47.51],
  "Pacific/Auckland": [-36.85, 174.76], "Pacific/Fiji": [-18.14, 178.44], "Pacific/Guam": [13.44, 144.79], "Pacific/Port_Moresby": [-9.44, 147.18],
  "Pacific/Tahiti": [-17.54, -149.57], "Pacific/Tongatapu": [-21.14, -175.2], "Pacific/Apia": [-13.83, -171.76], "Pacific/Noumea": [-22.28, 166.46],
  "Pacific/Chatham": [-43.95, -176.56], "Pacific/Galapagos": [-0.9, -89.6], "Pacific/Easter": [-27.11, -109.35], "Pacific/Majuro": [7.09, 171.38],
};

export interface Weather { tempC: number; code: number; at: number }

const REFRESH_MS = 30 * 60_000;
const read = <T,>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? "null") as T | null; } catch { return null; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* full or private */ } };

/**
 * Coordinates for a world clock city (its stored id, see domain/cities.ts): the city table, the zone's
 * city above, a remembered search, or Open-Meteo's place search by name.
 */
async function coordsFor(id: string): Promise<[number, number] | null> {
  const city = cityOf(id);
  if (city) return [city.lat, city.lng];
  if (!id.includes("#") && COORDS[id]) return COORDS[id];
  const key = `geo:${id}`;
  const saved = read<[number, number] | "none">(key);
  if (saved === "none") return null;
  if (saved) return saved;
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityLabel(id))}&count=1&format=json`);
    const j = await r.json() as { results?: { latitude: number; longitude: number }[] };
    const hit = j.results?.[0];
    const v: [number, number] | "none" = hit ? [Math.round(hit.latitude * 100) / 100, Math.round(hit.longitude * 100) / 100] : "none";
    write(key, v);
    return v === "none" ? null : v;
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<Weather | null>>();
async function fetchWeather(zone: string): Promise<Weather | null> {
  const c = await coordsFor(zone);
  if (!c) return null;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c[0]}&longitude=${c[1]}&current=temperature_2m,weather_code`);
  if (!r.ok) return null;
  const j = await r.json() as { current?: { temperature_2m?: number; weather_code?: number } };
  if (typeof j.current?.temperature_2m !== "number" || typeof j.current.weather_code !== "number") return null;
  const w = { tempC: j.current.temperature_2m, code: j.current.weather_code, at: Date.now() };
  write(`wx:${zone}`, w);
  return w;
}

/**
 * The weather in [zone]'s city: the last known value at once, then a fresh one when it's 30 minutes
 * old, checked every minute while [visible].
 */
export function useWeather(zone: string, visible: boolean): Weather | null {
  const [w, setW] = useState<Weather | null>(() => read<Weather>(`wx:${zone}`));
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const check = () => {
      const last = read<Weather>(`wx:${zone}`);
      if (last && Date.now() - last.at < REFRESH_MS) { setW(last); return; }
      if (!navigator.onLine) return;
      let p = inflight.get(zone);
      if (!p) { p = fetchWeather(zone).catch(() => null).finally(() => inflight.delete(zone)); inflight.set(zone, p); }
      void p.then((x) => { if (live && x) setW(x); });
    };
    check();
    const t = window.setInterval(check, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [zone, visible]);
  return w;
}

/** "18°C" (always Celsius), with the symbol for the code (night between 20:00 and 06:00 there). */
export function weatherView(w: Weather, id: string, now: number): { text: string; icon: string; label: string } {
  const h = zoneHour(zoneOf(id), now);
  const sym = weatherSymbol(w.code, h >= 6 && h < 20);
  return { text: `${Math.round(w.tempC)}°C`, ...sym };
}

/** A weather page for the city, for when no weather app has been picked (DuckDuckGo: no account, no tracking). */
export const weatherPage = (id: string) => `https://duckduckgo.com/?q=${encodeURIComponent(`weather ${cityLabel(id)}`)}&ia=weather`;

// ---------- The forecast for alarms ----------
// Each alarm shows the weather at the hour it rings next: the hourly forecast for the phone's own city
// (the same coordinates as its world clock card; nothing else is sent), asked about every three hours
// while the Alarms page is open. It's also handed to the alarm engine, so the ringing screen can show
// it without the network (alarm/Forecast.kt).

/** Hour starts (ms), °C and weather codes, for the next 16 days. */
export interface Hourly { at: number[]; t: number[]; c: number[]; fetched: number }
const FORECAST_MS = 3 * 3600_000;

async function fetchHourly(zone: string): Promise<Hourly | null> {
  const c = await coordsFor(zone);
  if (!c) return null;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c[0]}&longitude=${c[1]}&hourly=temperature_2m,weather_code&forecast_days=16&timeformat=unixtime`);
  if (!r.ok) return null;
  const j = await r.json() as { hourly?: { time?: number[]; temperature_2m?: (number | null)[]; weather_code?: (number | null)[] } };
  const h = j.hourly;
  if (!h?.time || !h.temperature_2m || !h.weather_code) return null;
  const out: Hourly = { at: [], t: [], c: [], fetched: Date.now() };
  h.time.forEach((s, i) => {
    const t = h.temperature_2m![i], code = h.weather_code![i];
    if (typeof t === "number" && typeof code === "number") { out.at.push(s * 1000); out.t.push(Math.round(t * 10) / 10); out.c.push(code); }
  });
  if (!out.at.length) return null;
  write(`wxh:${zone}`, out);
  return out;
}

let pushed = "";
/** Hands the forecast to the alarm engine (the phone build), once per new forecast. */
function pushForecast(h: Hourly) {
  const text = JSON.stringify(h);
  if (text === pushed) return;
  pushed = text;
  void native.forecast(text);
}

/** The hourly forecast for [zone]'s city: the last one at once, a fresh one when it's three hours old. */
export function useForecast(zone: string, visible: boolean): Hourly | null {
  const [h, setH] = useState<Hourly | null>(() => (zone ? read<Hourly>(`wxh:${zone}`) : null));
  useEffect(() => {
    if (!zone) return;
    const last = read<Hourly>(`wxh:${zone}`);
    setH(last);
    if (last) pushForecast(last);
    if (!visible) return;
    let live = true;
    const check = () => {
      const cur = read<Hourly>(`wxh:${zone}`);
      if ((cur && Date.now() - cur.fetched < FORECAST_MS) || !navigator.onLine) return;
      void fetchHourly(zone).catch(() => null).then((x) => { if (x) { pushForecast(x); if (live) setH(x); } });
    };
    check();
    const t = window.setInterval(check, 10 * 60_000);
    return () => { live = false; clearInterval(t); };
  }, [zone, visible]);
  return h;
}

/** The weather in the hour holding [at], or null (domain/alarms.ts, tested). */
export const forecastView = forecastAt;
