// Cities for the world clock: every capital and the big cities of each region, with the country (so a
// search for "Japan" finds Tokyo and Osaka), the IANA time zone and where it is (for the weather).
//
// A city is stored in the world clock list as its zone ("Europe/Paris") when the zone already carries its
// name, or as "zone#Name" ("America/Los_Angeles#San Francisco") when it doesn't. Older lists hold plain
// zones only, which still read the same.
import { cityName } from "./alarms.ts";

export interface City { name: string; country: string; zone: string; lat: number; lng: number }

type Row = [name: string, country: string, zone: string, lat: number, lng: number];
const ROWS: Row[] = [
  // Europe
  ["London", "United Kingdom", "Europe/London", 51.51, -0.13], ["Edinburgh", "United Kingdom", "Europe/London", 55.95, -3.19],
  ["Manchester", "United Kingdom", "Europe/London", 53.48, -2.24], ["Dublin", "Ireland", "Europe/Dublin", 53.35, -6.26],
  ["Paris", "France", "Europe/Paris", 48.86, 2.35], ["Lyon", "France", "Europe/Paris", 45.76, 4.84], ["Marseille", "France", "Europe/Paris", 43.3, 5.37],
  ["Brussels", "Belgium", "Europe/Brussels", 50.85, 4.35], ["Amsterdam", "Netherlands", "Europe/Amsterdam", 52.37, 4.9],
  ["Luxembourg", "Luxembourg", "Europe/Luxembourg", 49.61, 6.13], ["Berlin", "Germany", "Europe/Berlin", 52.52, 13.41],
  ["Munich", "Germany", "Europe/Berlin", 48.14, 11.58], ["Frankfurt", "Germany", "Europe/Berlin", 50.11, 8.68], ["Hamburg", "Germany", "Europe/Berlin", 53.55, 9.99],
  ["Zurich", "Switzerland", "Europe/Zurich", 47.38, 8.54], ["Geneva", "Switzerland", "Europe/Zurich", 46.2, 6.14], ["Bern", "Switzerland", "Europe/Zurich", 46.95, 7.45],
  ["Vienna", "Austria", "Europe/Vienna", 48.21, 16.37], ["Rome", "Italy", "Europe/Rome", 41.9, 12.5], ["Milan", "Italy", "Europe/Rome", 45.46, 9.19],
  ["Madrid", "Spain", "Europe/Madrid", 40.42, -3.7], ["Barcelona", "Spain", "Europe/Madrid", 41.39, 2.17], ["Lisbon", "Portugal", "Europe/Lisbon", 38.72, -9.14],
  ["Porto", "Portugal", "Europe/Lisbon", 41.15, -8.61], ["Copenhagen", "Denmark", "Europe/Copenhagen", 55.68, 12.57], ["Oslo", "Norway", "Europe/Oslo", 59.91, 10.75],
  ["Stockholm", "Sweden", "Europe/Stockholm", 59.33, 18.07], ["Helsinki", "Finland", "Europe/Helsinki", 60.17, 24.94],
  ["Reykjavik", "Iceland", "Atlantic/Reykjavik", 64.15, -21.94], ["Warsaw", "Poland", "Europe/Warsaw", 52.23, 21.01], ["Prague", "Czechia", "Europe/Prague", 50.08, 14.44],
  ["Bratislava", "Slovakia", "Europe/Bratislava", 48.15, 17.11], ["Budapest", "Hungary", "Europe/Budapest", 47.5, 19.04],
  ["Ljubljana", "Slovenia", "Europe/Ljubljana", 46.06, 14.51], ["Zagreb", "Croatia", "Europe/Zagreb", 45.81, 15.98], ["Belgrade", "Serbia", "Europe/Belgrade", 44.79, 20.45],
  ["Sarajevo", "Bosnia and Herzegovina", "Europe/Sarajevo", 43.86, 18.41], ["Podgorica", "Montenegro", "Europe/Podgorica", 42.43, 19.26],
  ["Skopje", "North Macedonia", "Europe/Skopje", 42, 21.43], ["Tirana", "Albania", "Europe/Tirane", 41.33, 19.82], ["Athens", "Greece", "Europe/Athens", 37.98, 23.73],
  ["Sofia", "Bulgaria", "Europe/Sofia", 42.7, 23.32], ["Bucharest", "Romania", "Europe/Bucharest", 44.43, 26.1], ["Chisinau", "Moldova", "Europe/Chisinau", 47.01, 28.86],
  ["Kyiv", "Ukraine", "Europe/Kiev", 50.45, 30.52], ["Minsk", "Belarus", "Europe/Minsk", 53.9, 27.56], ["Vilnius", "Lithuania", "Europe/Vilnius", 54.69, 25.28],
  ["Riga", "Latvia", "Europe/Riga", 56.95, 24.11], ["Tallinn", "Estonia", "Europe/Tallinn", 59.44, 24.75], ["Moscow", "Russia", "Europe/Moscow", 55.76, 37.62],
  ["Saint Petersburg", "Russia", "Europe/Moscow", 59.93, 30.34], ["Istanbul", "Turkey", "Europe/Istanbul", 41.01, 28.98], ["Ankara", "Turkey", "Europe/Istanbul", 39.93, 32.85],
  ["Valletta", "Malta", "Europe/Malta", 35.9, 14.51], ["Monaco", "Monaco", "Europe/Monaco", 43.74, 7.42], ["Andorra la Vella", "Andorra", "Europe/Andorra", 42.51, 1.52],
  ["Nicosia", "Cyprus", "Asia/Nicosia", 35.19, 33.38], ["Tbilisi", "Georgia", "Asia/Tbilisi", 41.72, 44.79], ["Yerevan", "Armenia", "Asia/Yerevan", 40.18, 44.51],
  ["Baku", "Azerbaijan", "Asia/Baku", 40.41, 49.87], ["Ponta Delgada", "Portugal (Azores)", "Atlantic/Azores", 37.74, -25.67],
  ["Funchal", "Portugal (Madeira)", "Atlantic/Madeira", 32.65, -16.91], ["Las Palmas", "Spain (Canary Islands)", "Atlantic/Canary", 28.12, -15.43],
  // Africa
  ["Cairo", "Egypt", "Africa/Cairo", 30.04, 31.24], ["Casablanca", "Morocco", "Africa/Casablanca", 33.57, -7.59], ["Rabat", "Morocco", "Africa/Casablanca", 34.02, -6.84],
  ["Algiers", "Algeria", "Africa/Algiers", 36.75, 3.06], ["Tunis", "Tunisia", "Africa/Tunis", 36.81, 10.18], ["Tripoli", "Libya", "Africa/Tripoli", 32.89, 13.19],
  ["Khartoum", "Sudan", "Africa/Khartoum", 15.5, 32.56], ["Addis Ababa", "Ethiopia", "Africa/Addis_Ababa", 9.03, 38.74], ["Nairobi", "Kenya", "Africa/Nairobi", -1.29, 36.82],
  ["Kampala", "Uganda", "Africa/Kampala", 0.35, 32.58], ["Kigali", "Rwanda", "Africa/Kigali", -1.95, 30.06], ["Dar es Salaam", "Tanzania", "Africa/Dar_es_Salaam", -6.79, 39.21],
  ["Lagos", "Nigeria", "Africa/Lagos", 6.52, 3.38], ["Abuja", "Nigeria", "Africa/Lagos", 9.08, 7.4], ["Accra", "Ghana", "Africa/Accra", 5.6, -0.19],
  ["Dakar", "Senegal", "Africa/Dakar", 14.69, -17.44], ["Abidjan", "Côte d'Ivoire", "Africa/Abidjan", 5.36, -4.01], ["Bamako", "Mali", "Africa/Bamako", 12.64, -8],
  ["Kinshasa", "DR Congo", "Africa/Kinshasa", -4.44, 15.27], ["Luanda", "Angola", "Africa/Luanda", -8.84, 13.23], ["Lusaka", "Zambia", "Africa/Lusaka", -15.39, 28.32],
  ["Harare", "Zimbabwe", "Africa/Harare", -17.83, 31.05], ["Maputo", "Mozambique", "Africa/Maputo", -25.97, 32.57], ["Windhoek", "Namibia", "Africa/Windhoek", -22.56, 17.08],
  ["Johannesburg", "South Africa", "Africa/Johannesburg", -26.2, 28.05], ["Cape Town", "South Africa", "Africa/Johannesburg", -33.92, 18.42],
  ["Antananarivo", "Madagascar", "Indian/Antananarivo", -18.88, 47.51], ["Port Louis", "Mauritius", "Indian/Mauritius", -20.16, 57.5],
  ["Praia", "Cape Verde", "Atlantic/Cape_Verde", 14.93, -23.51],
  // Middle East and Asia
  ["Dubai", "United Arab Emirates", "Asia/Dubai", 25.2, 55.27], ["Abu Dhabi", "United Arab Emirates", "Asia/Dubai", 24.45, 54.38], ["Doha", "Qatar", "Asia/Qatar", 25.29, 51.53],
  ["Riyadh", "Saudi Arabia", "Asia/Riyadh", 24.71, 46.68], ["Jeddah", "Saudi Arabia", "Asia/Riyadh", 21.49, 39.19], ["Kuwait City", "Kuwait", "Asia/Kuwait", 29.38, 47.99],
  ["Manama", "Bahrain", "Asia/Bahrain", 26.23, 50.59], ["Muscat", "Oman", "Asia/Muscat", 23.59, 58.41], ["Tehran", "Iran", "Asia/Tehran", 35.69, 51.39],
  ["Baghdad", "Iraq", "Asia/Baghdad", 33.31, 44.36], ["Amman", "Jordan", "Asia/Amman", 31.95, 35.93], ["Beirut", "Lebanon", "Asia/Beirut", 33.89, 35.5],
  ["Damascus", "Syria", "Asia/Damascus", 33.51, 36.28], ["Jerusalem", "Israel", "Asia/Jerusalem", 31.77, 35.21], ["Tel Aviv", "Israel", "Asia/Jerusalem", 32.09, 34.78],
  ["Kabul", "Afghanistan", "Asia/Kabul", 34.56, 69.21], ["Karachi", "Pakistan", "Asia/Karachi", 24.86, 67.01], ["Islamabad", "Pakistan", "Asia/Karachi", 33.68, 73.05],
  ["Lahore", "Pakistan", "Asia/Karachi", 31.55, 74.34], ["New Delhi", "India", "Asia/Kolkata", 28.61, 77.21], ["Mumbai", "India", "Asia/Kolkata", 19.08, 72.88],
  ["Bangalore", "India", "Asia/Kolkata", 12.97, 77.59], ["Chennai", "India", "Asia/Kolkata", 13.08, 80.27], ["Kolkata", "India", "Asia/Kolkata", 22.57, 88.36],
  ["Kathmandu", "Nepal", "Asia/Kathmandu", 27.72, 85.32], ["Thimphu", "Bhutan", "Asia/Thimphu", 27.47, 89.64], ["Dhaka", "Bangladesh", "Asia/Dhaka", 23.81, 90.41],
  ["Colombo", "Sri Lanka", "Asia/Colombo", 6.93, 79.85], ["Malé", "Maldives", "Indian/Maldives", 4.18, 73.51], ["Tashkent", "Uzbekistan", "Asia/Tashkent", 41.3, 69.24],
  ["Almaty", "Kazakhstan", "Asia/Almaty", 43.24, 76.89], ["Astana", "Kazakhstan", "Asia/Almaty", 51.17, 71.45], ["Bishkek", "Kyrgyzstan", "Asia/Bishkek", 42.87, 74.59],
  ["Dushanbe", "Tajikistan", "Asia/Dushanbe", 38.56, 68.79], ["Ashgabat", "Turkmenistan", "Asia/Ashgabat", 37.96, 58.33],
  ["Yekaterinburg", "Russia", "Asia/Yekaterinburg", 56.84, 60.61], ["Novosibirsk", "Russia", "Asia/Novosibirsk", 55.01, 82.93],
  ["Vladivostok", "Russia", "Asia/Vladivostok", 43.12, 131.89], ["Ulaanbaatar", "Mongolia", "Asia/Ulaanbaatar", 47.89, 106.91],
  ["Beijing", "China", "Asia/Shanghai", 39.9, 116.41], ["Shanghai", "China", "Asia/Shanghai", 31.23, 121.47], ["Shenzhen", "China", "Asia/Shanghai", 22.54, 114.06],
  ["Hong Kong", "Hong Kong", "Asia/Hong_Kong", 22.32, 114.17], ["Macau", "Macau", "Asia/Macau", 22.2, 113.54], ["Taipei", "Taiwan", "Asia/Taipei", 25.03, 121.57],
  ["Seoul", "South Korea", "Asia/Seoul", 37.57, 126.98], ["Pyongyang", "North Korea", "Asia/Pyongyang", 39.04, 125.76], ["Tokyo", "Japan", "Asia/Tokyo", 35.68, 139.69],
  ["Osaka", "Japan", "Asia/Tokyo", 34.69, 135.5], ["Bangkok", "Thailand", "Asia/Bangkok", 13.76, 100.5], ["Hanoi", "Vietnam", "Asia/Ho_Chi_Minh", 21.03, 105.85],
  ["Ho Chi Minh City", "Vietnam", "Asia/Ho_Chi_Minh", 10.82, 106.63], ["Phnom Penh", "Cambodia", "Asia/Phnom_Penh", 11.56, 104.93],
  ["Vientiane", "Laos", "Asia/Vientiane", 17.98, 102.63], ["Yangon", "Myanmar", "Asia/Yangon", 16.87, 96.2], ["Kuala Lumpur", "Malaysia", "Asia/Kuala_Lumpur", 3.14, 101.69],
  ["Singapore", "Singapore", "Asia/Singapore", 1.35, 103.82], ["Jakarta", "Indonesia", "Asia/Jakarta", -6.21, 106.85], ["Denpasar", "Indonesia (Bali)", "Asia/Makassar", -8.65, 115.22],
  ["Manila", "Philippines", "Asia/Manila", 14.6, 120.98], ["Bandar Seri Begawan", "Brunei", "Asia/Brunei", 4.9, 114.94], ["Dili", "Timor-Leste", "Asia/Dili", -8.56, 125.57],
  // Oceania
  ["Sydney", "Australia", "Australia/Sydney", -33.87, 151.21], ["Canberra", "Australia", "Australia/Sydney", -35.28, 149.13],
  ["Melbourne", "Australia", "Australia/Melbourne", -37.81, 144.96], ["Brisbane", "Australia", "Australia/Brisbane", -27.47, 153.03],
  ["Perth", "Australia", "Australia/Perth", -31.95, 115.86], ["Adelaide", "Australia", "Australia/Adelaide", -34.93, 138.6], ["Darwin", "Australia", "Australia/Darwin", -12.46, 130.84],
  ["Hobart", "Australia", "Australia/Hobart", -42.88, 147.33], ["Auckland", "New Zealand", "Pacific/Auckland", -36.85, 174.76],
  ["Wellington", "New Zealand", "Pacific/Auckland", -41.29, 174.78], ["Suva", "Fiji", "Pacific/Fiji", -18.14, 178.44], ["Port Moresby", "Papua New Guinea", "Pacific/Port_Moresby", -9.44, 147.18],
  ["Nouméa", "New Caledonia", "Pacific/Noumea", -22.28, 166.46], ["Papeete", "French Polynesia", "Pacific/Tahiti", -17.54, -149.57], ["Apia", "Samoa", "Pacific/Apia", -13.83, -171.76],
  ["Nuku'alofa", "Tonga", "Pacific/Tongatapu", -21.14, -175.2], ["Guam", "Guam", "Pacific/Guam", 13.44, 144.79], ["Honolulu", "United States (Hawaii)", "Pacific/Honolulu", 21.31, -157.86],
  // North and Central America, the Caribbean
  ["New York", "United States", "America/New_York", 40.71, -74.01], ["Washington, D.C.", "United States", "America/New_York", 38.91, -77.04],
  ["Boston", "United States", "America/New_York", 42.36, -71.06], ["Miami", "United States", "America/New_York", 25.76, -80.19], ["Atlanta", "United States", "America/New_York", 33.75, -84.39],
  ["Chicago", "United States", "America/Chicago", 41.88, -87.63], ["Dallas", "United States", "America/Chicago", 32.78, -96.8], ["Houston", "United States", "America/Chicago", 29.76, -95.37],
  ["Denver", "United States", "America/Denver", 39.74, -104.99], ["Phoenix", "United States", "America/Phoenix", 33.45, -112.07],
  ["Los Angeles", "United States", "America/Los_Angeles", 34.05, -118.24], ["San Francisco", "United States", "America/Los_Angeles", 37.77, -122.42],
  ["Seattle", "United States", "America/Los_Angeles", 47.61, -122.33], ["Las Vegas", "United States", "America/Los_Angeles", 36.17, -115.14],
  ["Anchorage", "United States (Alaska)", "America/Anchorage", 61.22, -149.9], ["Toronto", "Canada", "America/Toronto", 43.65, -79.38], ["Ottawa", "Canada", "America/Toronto", 45.42, -75.7],
  ["Montreal", "Canada", "America/Toronto", 45.5, -73.57], ["Vancouver", "Canada", "America/Vancouver", 49.28, -123.12], ["Calgary", "Canada", "America/Edmonton", 51.05, -114.07],
  ["Winnipeg", "Canada", "America/Winnipeg", 49.9, -97.14], ["Halifax", "Canada", "America/Halifax", 44.65, -63.58], ["St. John's", "Canada", "America/St_Johns", 47.56, -52.71],
  ["Mexico City", "Mexico", "America/Mexico_City", 19.43, -99.13], ["Guadalajara", "Mexico", "America/Mexico_City", 20.66, -103.35], ["Monterrey", "Mexico", "America/Monterrey", 25.69, -100.32],
  ["Cancún", "Mexico", "America/Cancun", 21.16, -86.85], ["Tijuana", "Mexico", "America/Tijuana", 32.51, -117.04], ["Guatemala City", "Guatemala", "America/Guatemala", 14.63, -90.51],
  ["San Salvador", "El Salvador", "America/El_Salvador", 13.69, -89.22], ["Tegucigalpa", "Honduras", "America/Tegucigalpa", 14.07, -87.19],
  ["Managua", "Nicaragua", "America/Managua", 12.11, -86.24], ["San José", "Costa Rica", "America/Costa_Rica", 9.93, -84.08], ["Panama City", "Panama", "America/Panama", 8.98, -79.52],
  ["Havana", "Cuba", "America/Havana", 23.11, -82.37], ["Kingston", "Jamaica", "America/Jamaica", 17.97, -76.79], ["Santo Domingo", "Dominican Republic", "America/Santo_Domingo", 18.49, -69.93],
  ["San Juan", "Puerto Rico", "America/Puerto_Rico", 18.47, -66.11], ["Port of Spain", "Trinidad and Tobago", "America/Port_of_Spain", 10.65, -61.5],
  ["Bridgetown", "Barbados", "America/Barbados", 13.1, -59.61], ["Hamilton", "Bermuda", "Atlantic/Bermuda", 32.29, -64.78], ["Nuuk", "Greenland", "America/Nuuk", 64.18, -51.72],
  // South America
  ["Bogotá", "Colombia", "America/Bogota", 4.71, -74.07], ["Medellín", "Colombia", "America/Bogota", 6.24, -75.58], ["Caracas", "Venezuela", "America/Caracas", 10.48, -66.9],
  ["Quito", "Ecuador", "America/Guayaquil", -0.18, -78.47], ["Lima", "Peru", "America/Lima", -12.05, -77.04], ["La Paz", "Bolivia", "America/La_Paz", -16.5, -68.15],
  ["Santiago", "Chile", "America/Santiago", -33.45, -70.67], ["Buenos Aires", "Argentina", "America/Argentina/Buenos_Aires", -34.6, -58.38],
  ["Montevideo", "Uruguay", "America/Montevideo", -34.9, -56.16], ["Asunción", "Paraguay", "America/Asuncion", -25.26, -57.58],
  ["São Paulo", "Brazil", "America/Sao_Paulo", -23.55, -46.63], ["Rio de Janeiro", "Brazil", "America/Sao_Paulo", -22.91, -43.17],
  ["Brasília", "Brazil", "America/Sao_Paulo", -15.79, -47.88], ["Manaus", "Brazil", "America/Manaus", -3.12, -60.02],
];

export const CITIES: City[] = ROWS.map(([name, country, zone, lat, lng]) => ({ name, country, zone, lat, lng }));

/** How a city is kept in the world clock list: its zone, or "zone#Name" when the zone has another name. */
export const cityId = (c: City) => (c.name === cityName(c.zone) ? c.zone : `${c.zone}#${c.name}`);

/** The time zone of a stored id. */
export const zoneOf = (id: string) => { const i = id.indexOf("#"); return i < 0 ? id : id.slice(0, i); };

/** The name shown for a stored id: its own name, or the zone's city. */
export const cityLabel = (id: string) => { const i = id.indexOf("#"); return i < 0 ? cityName(id) : id.slice(i + 1); };

const byId = new Map(CITIES.map((c) => [cityId(c), c]));
/** The table's city for a stored id, if it's one of them. */
export const cityOf = (id: string): City | null => byId.get(id) ?? null;

/** Lower case without accents, so "sao" finds São Paulo. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface CityChoice { id: string; name: string; place: string }

/**
 * The cities offered for [query]: the table's cities whose name or country matches, by name; while
 * searching, also the other time zones by their city name ([zones], the IANA region/city ids) that the
 * table doesn't already list, with the region as their place.
 */
export function searchCities(query: string, zones: string[] = []): CityChoice[] {
  const q = fold(query.trim());
  const table = CITIES.filter((c) => !q || fold(c.name).includes(q) || fold(c.country).includes(q))
    .map((c) => ({ id: cityId(c), name: c.name, place: c.country }));
  if (q) {
    // Names that match at the start come first.
    table.sort((a, b) => Number(!fold(a.name).startsWith(q)) - Number(!fold(b.name).startsWith(q)) || a.name.localeCompare(b.name));
    const listed = new Set(CITIES.map((c) => fold(cityName(c.zone))).concat(CITIES.map((c) => fold(c.name))));
    const extra = zones.filter((z) => !listed.has(fold(cityName(z))) && (fold(cityName(z)).includes(q) || fold(z).includes(q)))
      .map((z) => ({ id: z, name: cityName(z), place: z.slice(0, z.indexOf("/")) }));
    return table.concat(extra);
  }
  return table.sort((a, b) => a.name.localeCompare(b.name));
}
