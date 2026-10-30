// Searching the phone's apps (Settings' weather app picker, 83). Pure, so it's unit-tested.

export interface LaunchApp { component: string; label: string }

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Apps whose name or package matches [q] (accents and case ignored), names starting with it first. */
export function filterApps(apps: LaunchApp[], q: string): LaunchApp[] {
  const f = fold(q.trim());
  const sorted = [...apps].sort((a, b) => a.label.localeCompare(b.label));
  if (!f) return sorted;
  return sorted.filter((a) => fold(a.label).includes(f) || a.component.toLowerCase().includes(f))
    .sort((a, b) => Number(!fold(a.label).startsWith(f)) - Number(!fold(b.label).startsWith(f)));
}

