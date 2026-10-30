// "Planner Test"'s sample data (roadmap 129, domain/sample.ts): put in on its first start, and again by
// Settings -> "Reset sample data". Never in the real app.
import { isTestApp } from "../platform.ts";
import { today } from "../domain/dates.ts";
import { sampleRecords } from "../domain/sample.ts";
import { allRecords, keyOf, replaceAllRecords } from "./store.ts";

const SEEDED_KEY = "testSampleSeeded";

/** Every record replaced by the sample week around today. */
export function resetSample() {
  if (!isTestApp()) return;
  replaceAllRecords(sampleRecords(today(), Date.now()).map(({ kind, rec }) => [`${kind}/${keyOf(kind, rec as never)}`, rec as never]));
}

/** The first start of the test app: the sample data, when there's nothing yet (once only). */
export function seedSampleOnce() {
  if (!isTestApp() || localStorage.getItem(SEEDED_KEY)) return;
  if (allRecords().size === 0) resetSample();
  localStorage.setItem(SEEDED_KEY, "1");
}
