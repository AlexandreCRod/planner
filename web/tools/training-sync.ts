// Moves a training plan between a PC folder and the Planner sync server, for the plan session.
//   node --experimental-strip-types web/tools/training-sync.ts check <folder>
//   node --experimental-strip-types web/tools/training-sync.ts push  <folder>
//   node --experimental-strip-types web/tools/training-sync.ts pull  <folder>
// check: planner.json and its documents agree (same rules as the app), and so do the shared files (runs.json,
// meals.json, weights.json, lift-history.json, sleep.json) when the folder has them. push: sends the files
// that changed: the plan's, and the shared ones under the plan id "shared" (one taken out of the folder stays
// on the server: the history files are pushed once, and meals.json may come from another session). pull: writes the
// training CSVs from what the phone logged, bodyweight.csv from the weigh-ins, and from the watch's Health
// Connect data runs.csv (every run once, runs.json's merged with the watch's), workouts.csv (its other
// sessions) and daily.csv (its days). Node built-ins only.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { anchorsIn } from "../src/domain/markdown.ts";
import { count } from "../src/domain/plural.ts";
import {
  type Entry, type Lift, type Plan, PLAN_FILE, type PlanFile, entriesWithGames, isGame, logCsv, missingCards, planFileId, readPlan, setsCsv, sportsCategoryIds,
} from "../src/domain/training.ts";
import type { Category, Completion, Item } from "../src/domain/types.ts";
import type { HealthDay, HealthNight, HealthSession } from "../src/domain/health.ts";
import { dailyCsv, mergedRuns, runsCsv, typedRuns, watchLinks, workoutsCsv } from "../src/domain/healthRuns.ts";
import { sleepCsv } from "../src/domain/sleep.ts";
import {
  LIFT_HISTORY_FILE, MEALS_FILE, type Night, RUNS_FILE, type Run, SHARED_PLAN, SLEEP_FILE, WEIGHTS_FILE, type WeighIn,
  readLiftHistory, readMeals, readRuns, readSleep, readWeights, weighInsCsv,
} from "../src/domain/trends.ts";

type Rec = Record<string, unknown>;
export interface Change { kind: string; id: string; data: Rec | null }
/**
 * What this script remembers between runs: where it is in the server's history, the records it holds, and
 * which kinds it keeps ([KEPT_VERSION]; a state from before the watch's kinds receives everything again).
 */
export interface State { seq: number; records: Record<string, Rec>; kept?: number }

const KIND = "trainingFiles";
const BODYWEIGHT_FILE = "bodyweight.csv";
const RUNS_CSV = "runs.csv", WORKOUTS_CSV = "workouts.csv", DAILY_CSV = "daily.csv", SLEEP_CSV = "sleep.csv";
/**
 * 2: the watch's kinds (healthSessions, healthNights, healthDays) are kept too. 3: futsal events and the ticks (item 240).
 * 4: the Sports category's events, and the categories' names to find it (267).
 * 5: the categories' own "counts as sport" switch too (278).
 */
export const KEPT_VERSION = 5;

// ---------- Pure helpers (tested in test/trainingSync.test.ts) ----------

/**
 * The changes that bring the server's copy of one plan's files in line with [files] (file name → text):
 * a record for each file whose text differs from the last pushed one, and (unless [keepMissing]) a delete
 * for each earlier record of this plan whose file is no longer listed. Files that haven't changed give nothing.
 */
export function fileChanges(planId: string, files: ReadonlyMap<string, string>, base: Record<string, Rec>, now: number, keepMissing = false): Change[] {
  const out: Change[] = [];
  for (const [file, text] of files) {
    const id = planFileId(planId, file);
    if ((base[`${KIND}/${id}`] as unknown as PlanFile | undefined)?.text === text) continue;
    const data: PlanFile = { id, planId, file, text, updatedAt: now };
    out.push({ kind: KIND, id, data: data as unknown as Rec });
  }
  if (!keepMissing) for (const [key, r] of Object.entries(base)) {
    if (!key.startsWith(`${KIND}/`) || r.planId !== planId || files.has(String(r.file))) continue;
    out.push({ kind: KIND, id: key.slice(KIND.length + 1), data: null });
  }
  return out;
}

/** Applies sent and received changes to the held records (a null is a delete). */
export function applyChanges(records: Record<string, Rec>, ...lists: Change[][]): Record<string, Rec> {
  const out = { ...records };
  for (const list of lists) for (const c of list) { const k = `${c.kind}/${c.id}`; if (c.data === null) delete out[k]; else out[k] = c.data; }
  return out;
}

/**
 * The kinds this script keeps: the training records and the watch's (Health Connect's) ones. The rest of the
 * user's data (notes, tasks...) never lands in its file.
 */
export const keptKind = (kind: string) => kind.startsWith("training") || kind.startsWith("health");

/** The fields of a game's event the log needs (its days, its title and category), nothing else of it. */
const FUTSAL_FIELDS = [
  "id", "type", "title", "categoryId", "startDay", "endDay", "startMin", "endMin", "allDay", "freq", "interval", "weekDays", "monthDays", "months",
  "untilDay", "excludedDays", "deletedAt", "updatedAt", "futsal",
] as const;

/** The ids of the categories that count as sport, among held records and received changes (267, 278). */
export function sportsIn(records: Record<string, Rec>, received: Change[]): Set<number> {
  const cats = new Map<number, Category>();
  for (const c of recordsOfKind<Category>(records, "categories")) cats.set(c.id, c);
  for (const c of received) if (c.kind === "categories") { if (c.data) cats.set(Number(c.id), c.data as unknown as Category); else cats.delete(Number(c.id)); }
  return sportsCategoryIds(cats.values());
}

/**
 * What of the received changes this script keeps: the kinds above, the ticks (completions: an item id and
 * a day), the categories cut to their id, name and sport switch (278), and of the calendar only the games' events (futsal and
 * the Sports category's, items 240 and 267, [sports] being its ids), cut to FUTSAL_FIELDS. An event that
 * stops being a game is dropped (kept as a delete).
 */
export function keptChanges(received: Change[], sports: ReadonlySet<number> = new Set()): Change[] {
  const out: Change[] = [];
  for (const c of received) {
    if (keptKind(c.kind) || c.kind === "completions") out.push(c);
    else if (c.kind === "categories") {
      const cat = c.data as unknown as Category | null;
      out.push(cat ? { ...c, data: { id: cat.id, name: cat.name, ...(typeof cat.sport === "boolean" ? { sport: cat.sport } : {}) } } : c);
    } else if (c.kind === "items") {
      const it = c.data as unknown as Item | null;
      out.push(it && isGame(it, sports) ? { ...c, data: Object.fromEntries(FUTSAL_FIELDS.filter((f) => f in it).map((f) => [f, it[f]])) } : { ...c, data: null });
    }
  }
  return out;
}

/** Where to sync from: the state's position, or the start when it was kept with fewer kinds. */
export const sinceOf = (s: State) => (s.kept === KEPT_VERSION ? s.seq : 0);

/**
 * The pull's watch CSVs from the held records: runs.csv (runs.json as pushed under "shared", else
 * [folderRuns], merged with the watch's runs and linked to the sessions they ticked), workouts.csv, daily.csv,
 * and sleep.csv (sleep.json, pushed else [folderSleep], merged with the watch's nights).
 */
export function healthCsvs(records: Record<string, Rec>, plan: Plan, folderRuns: string | null, folderSleep: string | null = null): Map<string, string> {
  const pushed = records[`${KIND}/${planFileId(SHARED_PLAN, RUNS_FILE)}`] as unknown as PlanFile | undefined;
  let fileRuns: Run[] = [];
  const text = pushed?.text ?? folderRuns;
  if (text) { try { fileRuns = readRuns(JSON.parse(text.replace(/^﻿/, ""))).runs; } catch { /* unreadable: the watch's runs alone */ } }
  const sessions = recordsOfKind<HealthSession>(records, "healthSessions");
  const entries = recordsOfKind<Entry>(records, "trainingEntries").filter((e) => e.planId === plan.id);
  const runs = typedRuns(mergedRuns(fileRuns, sessions, watchLinks(entries)), [plan]);
  const days = recordsOfKind<HealthDay>(records, "healthDays");
  const sleepFile = records[`${KIND}/${planFileId(SHARED_PLAN, SLEEP_FILE)}`] as unknown as PlanFile | undefined;
  let fileNights: Night[] = [];
  const sleepText = sleepFile?.text ?? folderSleep;
  if (sleepText) { try { fileNights = readSleep(JSON.parse(sleepText.replace(/^﻿/, ""))).nights; } catch { /* unreadable: the watch's nights alone */ } }
  return new Map([
    [RUNS_CSV, runsCsv(runs)],
    [WORKOUTS_CSV, workoutsCsv(sessions)],
    [DAILY_CSV, dailyCsv(days)],
    [SLEEP_CSV, sleepCsv(fileNights, recordsOfKind<HealthNight>(records, "healthNights"), days)],
  ]);
}

/** The held records of one kind. */
export function recordsOfKind<T>(records: Record<string, Rec>, kind: string): T[] {
  return Object.entries(records).filter(([k]) => k.startsWith(`${kind}/`)).map(([, r]) => r as unknown as T);
}

/**
 * Everything wrong with a plan folder, in plain words: what readPlan finds, a listed document that isn't
 * there, and cards pointing at a missing document or anchor. [read] gives a file's text, or null if absent.
 */
export function checkPlan(raw: unknown, read: (file: string) => string | null): { plan: Plan | null; problems: string[]; texts: Map<string, string> } {
  const { plan, problems } = readPlan(raw);
  const texts = new Map<string, string>();
  if (!plan) return { plan, problems, texts };
  if (plan.id === SHARED_PLAN) problems.push(`The plan id "${SHARED_PLAN}" is kept for ${RUNS_FILE} and the other shared files; pick another.`);
  const anchors = new Map<string, Set<string>>();
  for (const d of plan.documents) {
    const text = read(d.file);
    if (text === null) { problems.push(`Document ${d.file} is listed but isn't in the folder.`); continue; }
    texts.set(d.file, text);
    anchors.set(d.file, new Set(anchorsIn(text).keys()));
  }
  problems.push(...missingCards(plan, (file) => anchors.get(file) ?? null));
  return { plan, problems, texts };
}

/** The files pushed under "shared", each with its reader: what's wrong, and what the OK line says it holds. */
const SHARED_FILES: [file: string, read: (raw: unknown) => { problems: string[]; summary: string }][] = [
  [RUNS_FILE, (raw) => { const r = readRuns(raw); return { problems: r.problems, summary: count(r.runs.length, "run") }; }],
  [MEALS_FILE, (raw) => { const r = readMeals(raw); return { problems: r.problems, summary: count(r.meals.length, "meal") }; }],
  [WEIGHTS_FILE, (raw) => {
    const r = readWeights(raw);
    return { problems: r.problems, summary: `${count(r.weighIns.length, "weigh-in")}, ${count(r.measurements.length, "other measurement")}` };
  }],
  [LIFT_HISTORY_FILE, (raw) => { const r = readLiftHistory(raw); return { problems: r.problems, summary: count(r.sets.length, "set") }; }],
  [SLEEP_FILE, (raw) => { const r = readSleep(raw); return { problems: r.problems, summary: count(r.nights.length, "night") }; }],
];

/**
 * The shared files (runs.json, meals.json, weights.json, lift-history.json, sleep.json), each when the folder
 * has it ([read] gives a file's text, or null if absent): the text to push, what's wrong in plain words (JSON
 * errors and what their readers find), and an OK line for each one that's there.
 */
export function checkShared(read: (file: string) => string | null): { texts: Map<string, string>; problems: string[]; ok: string[] } {
  const texts = new Map<string, string>(), problems: string[] = [], ok: string[] = [];
  for (const [file, readFile] of SHARED_FILES) {
    const text = read(file);
    if (text === null) continue;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) { problems.push(`${file} isn't valid JSON: ${(e as Error).message}`); continue; }
    texts.set(file, text);
    const r = readFile(raw);
    problems.push(...r.problems.map((p) => `${file}: ${p}`));
    ok.push(`OK: ${file}: ${r.summary}.`);
  }
  return { texts, problems, ok };
}

// ---------- Settings, state and the server ----------

const configPath = () => process.env.PLANNER_SYNC_CONFIG || join(homedir(), ".planner-sync.json");
/** ".planner-sync.json" → ".planner-sync-state.json", next to it. */
const statePath = () => { const p = configPath(); return join(dirname(p), basename(p).replace(/(\.json)?$/, "-state.json")); };

/** A problem to tell the user in plain words (no stack trace). */
class Stop extends Error {}

function loadConfig(): { server: string; token: string } {
  const p = configPath();
  if (!existsSync(p)) throw new Stop(`No sync settings found. Create ${p} containing {"server":"https://your-worker.example.workers.dev","token":"your password"}.`);
  let c: { server?: unknown; token?: unknown };
  try { c = JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); } catch { throw new Stop(`${p} isn't valid JSON.`); }
  if (typeof c.server !== "string" || typeof c.token !== "string" || !c.server || !c.token) throw new Stop(`${p} needs a "server" and a "token".`);
  return { server: c.server.replace(/\/+$/, ""), token: c.token };
}

function loadState(): State {
  try {
    const s = JSON.parse(readFileSync(statePath(), "utf8")) as State;
    if (typeof s.seq === "number" && s.records && typeof s.records === "object") return s;
  } catch { /* first run, or unreadable: start over and receive everything */ }
  return { seq: 0, records: {} };
}

/** Written whole then renamed, so an interrupted run never leaves a half-written state file. */
function saveState(s: State) {
  const tmp = `${statePath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, statePath());
}

/**
 * One sync round: sends [changes], receives the rest, and saves the new position and records. Stops
 * (saving nothing) on a refusal; a 409 is never forced.
 */
async function sync(changes: Change[]): Promise<{ state: State; received: number }> {
  const { server, token } = loadConfig();
  const state = loadState();
  let res: Response;
  try {
    res = await fetch(`${server}/api/sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Device": "plan-script" },
      body: JSON.stringify({ since: sinceOf(state), changes }),
    });
  } catch { throw new Stop(`Can't reach the server at ${server}.`); }
  const text = await res.text();
  let body: { seq?: number; conflicts?: number; changes?: Change[]; features?: string[]; error?: string } = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (res.status === 401) throw new Stop("The server refused the token (wrong password).");
  if (res.status === 409) throw new Stop(`The server held the sync back and nothing was sent: ${body.error ?? "conflict"}. Not forcing it.`);
  if (!res.ok || typeof body.seq !== "number") throw new Stop(`Server error ${res.status}: ${body.error ?? text.slice(0, 200)}`);
  // Without this, the Worker would refuse (or ignore) our kinds: stop before saving anything.
  if (!(body.features ?? []).includes("anyKind")) throw new Stop("The server doesn't take training records yet: update the Worker first.");
  // Only training records, the watch's, ticks, category names and the games' events are kept: the rest of the user's data (notes, tasks...) never lands in this file.
  const received = keptChanges(body.changes ?? [], sportsIn(sinceOf(state) ? state.records : {}, body.changes ?? []));
  const next: State = { seq: body.seq, records: applyChanges(state.records, changes, received), kept: KEPT_VERSION };
  saveState(next);
  return { state: next, received: received.filter((c) => c.kind !== "items" || c.data).length };
}

// ---------- Commands ----------

function readFolder(folder: string) {
  const file = join(folder, PLAN_FILE);
  if (!existsSync(file)) throw new Stop(`There is no ${PLAN_FILE} in ${folder}.`);
  const planText = readFileSync(file, "utf8");
  let raw: unknown;
  try { raw = JSON.parse(planText); } catch (e) { throw new Stop(`${PLAN_FILE} isn't valid JSON: ${(e as Error).message}`); }
  return { raw, planText };
}

function check(folder: string) {
  const { raw, planText } = readFolder(folder);
  const read = (f: string) => { const p = join(folder, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
  const r = checkPlan(raw, read);
  // A byte order mark (some Windows tools add one) is dropped, so the app can read what is pushed.
  const shared = checkShared((f) => read(f)?.replace(/^﻿/, "") ?? null);
  const problems = [...r.problems, ...shared.problems];
  if (problems.length || !r.plan) {
    console.log(`Found ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
    for (const p of problems) console.log(`- ${p}`);
    return null;
  }
  const sessions = r.plan.phases.reduce((n, p) => n + p.sessions.length, 0);
  console.log(`OK: plan ${r.plan.id}, ${r.plan.phases.length} phases, ${sessions} sessions, ${r.plan.documents.length} documents.`);
  for (const line of shared.ok) console.log(line);
  return { plan: r.plan, texts: r.texts, planText, shared: shared.texts };
}

async function push(folder: string) {
  const r = check(folder);
  if (!r) throw new Stop("Not pushing: fix the problems above first.");
  const files = new Map<string, string>([[PLAN_FILE, r.planText], ...r.texts]);
  const base = loadState().records, now = Date.now();
  const changes = [...fileChanges(r.plan.id, files, base, now), ...fileChanges(SHARED_PLAN, r.shared, base, now, true)];
  const { received } = await sync(changes);
  // Plan ids never hold a ":", so a record id splits into plan and file at the first one.
  const name = (planId: string, file: string) => (planId === SHARED_PLAN ? `shared/${file}` : file);
  const sent = changes.filter((c) => c.data).map((c) => { const f = c.data as unknown as PlanFile; return name(f.planId, f.file); });
  const gone = changes.filter((c) => !c.data).map((c) => { const i = c.id.indexOf(":"); return name(c.id.slice(0, i), c.id.slice(i + 1)); });
  if (!changes.length) console.log("Nothing to push: the server already has these files.");
  else console.log(`Pushed ${sent.length} file(s)${sent.length ? ` (${sent.join(", ")})` : ""}${gone.length ? `; removed ${gone.join(", ")}` : ""}.`);
  if (received) console.log(`Received ${received} record(s) from the server.`);
}

async function pull(folder: string) {
  const { plan, problems } = readPlan(readFolder(folder).raw);
  if (!plan) throw new Stop(`Can't read the plan in ${folder}: ${problems.join(" ")}`);
  const { state, received } = await sync([]);
  const log = `training-log-${plan.id}.csv`, sets = `training-sets-${plan.id}.csv`;
  // Futsal and other sports from the calendar's games; old futsal entries not converted yet are converted here first (not saved).
  const entries = entriesWithGames([plan], recordsOfKind<Entry>(state.records, "trainingEntries"),
    recordsOfKind<Item>(state.records, "items"), recordsOfKind<Completion>(state.records, "completions"),
    sportsCategoryIds(recordsOfKind<Category>(state.records, "categories")));
  writeFileSync(join(folder, log), logCsv(plan, entries.values()));
  writeFileSync(join(folder, sets), setsCsv(plan, recordsOfKind<Lift>(state.records, "trainingLifts")));
  writeFileSync(join(folder, BODYWEIGHT_FILE), weighInsCsv(recordsOfKind<WeighIn>(state.records, "trainingWeighIns")));
  const runsFile = join(folder, RUNS_FILE);
  const sleepFile = join(folder, SLEEP_FILE);
  const health = healthCsvs(state.records, plan, existsSync(runsFile) ? readFileSync(runsFile, "utf8") : null,
    existsSync(sleepFile) ? readFileSync(sleepFile, "utf8") : null);
  for (const [file, text] of health) writeFileSync(join(folder, file), text);
  console.log(`Received ${received} record(s). Wrote ${log}, ${sets}, ${BODYWEIGHT_FILE}, ${[...health.keys()].join(", ")} in ${folder}.`);
}

async function main() {
  const [cmd, folder] = process.argv.slice(2);
  if (!folder || !["check", "push", "pull"].includes(cmd)) {
    console.log("Usage: node --experimental-strip-types web/tools/training-sync.ts <check|push|pull> <folder>");
    process.exit(2);
  }
  try {
    if (cmd === "check") { if (!check(folder)) process.exitCode = 1; }
    else if (cmd === "push") await push(folder);
    else await pull(folder);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    console.error(e.message);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
