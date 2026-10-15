// The native app's accent palettes (app/.../ui/theme/Theme.kt, `accents`), keyed by the light colour the
// PC settings store as --accent. The phone theme in phone.css builds its Material 3 roles from these,
// so primary, containers and tertiary are the very colours the native app draws with.
const PALETTES: Record<string, [lightContainer: string, dark: string, darkContainer: string, tertiary: string]> = {
  "#1a73e8": ["#d3e3fd", "#a8c7fa", "#0842a0", "#5f6368"], // Blue
  "#00796b": ["#b2f1e6", "#80d5c8", "#005048", "#4a6363"], // Teal
  "#b0285a": ["#ffd9e1", "#ffb1c5", "#8e0f43", "#7a5734"], // Rose
  "#8b5000": ["#ffdcbe", "#ffb870", "#693c00", "#5f6134"], // Amber
  "#2e7d32": ["#b9f0b4", "#9ed699", "#155219", "#39656b"], // Forest
  "#6a3db8": ["#ebddff", "#d3bbff", "#51229e", "#7e525e"], // Violet
  "#0061a4": ["#d1e4ff", "#9ecaff", "#00497d", "#6b5778"], // Ocean
  "#4f5b66": ["#d3e4f2", "#b7c8d6", "#38444f", "#665a6f"], // Slate
  "#3f51b5": ["#dde1ff", "#b8c3ff", "#2b3a9a", "#7d5260"], // Indigo
};

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const rgb = (c: string) => hex(c).join(" ");
/** The dark scheme's tertiary: the accent's tertiary with its red lifted by 0.35 (as Theme.kt does). */
const darkTertiary = (c: string) => { const [r, g, b] = hex(c); return `rgb(${Math.min(255, Math.round(r + 0.35 * 255))} ${g} ${b})`; };

let applied = "";
function apply() {
  const root = document.documentElement;
  const accent = (root.style.getPropertyValue("--accent").trim() || "#1a73e8").toLowerCase();
  if (accent === applied) return;
  applied = accent;
  const p = PALETTES[accent] ?? PALETTES["#1a73e8"];
  const light = PALETTES[accent] ? accent : "#1a73e8";
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set("--p-acc-light", light);
  set("--p-acc-light-container", p[0]);
  set("--p-acc-light-container-rgb", rgb(p[0]));
  set("--p-acc-dark", p[1]);
  set("--p-acc-dark-container", p[2]);
  set("--p-acc-dark-container-rgb", rgb(p[2]));
  set("--p-tert-light", p[3]);
  set("--p-tert-dark", darkTertiary(p[3]));
}

let started = false;
/** Keeps the phone palette in step with the accent chosen in Settings. */
export function startPhoneTheme() {
  if (started) return;
  started = true;
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
}
