// Moves a training plan between a PC folder and the Planner sync server, for the plan session.
//   node --experimental-strip-types web/tools/training-sync.ts check <folder>
//   node --experimental-strip-types web/tools/training-sync.ts push  <folder>
//   node --experimental-strip-types web/tools/training-sync.ts pull  <folder>
// check: planner.json and its documents agree (same rules as the app). push: sends the plan files that
// changed. pull: writes the training CSVs from what the phone logged. Node built-ins only.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { anchorsIn } from "../src/domain/markdown.ts";
import {
  type Entry, type Lift, type Plan, PLAN_FILE, type PlanFile, logCsv, missingCards, planFileId, readPlan, setsCsv,
} from "../src/domain/training.ts";

type Rec = Record<string, unknown>;
export interface Change { kind: string; id: string; data: Rec | null }
/** What this script remembers between runs: where it is in the server's history, and the records it holds. */
export interface State { seq: number; records: Record<string, Rec> }

const KIND = "trainingFiles";

// ---------- Pure helpers (tested in test/trainingSync.test.ts) ----------

/**
 * The changes that bring the server's copy of one plan's files in line with [files] (file name → text):
 * a record for each file whose text differs from the last pushed one, and a delete for each earlier
 * record of this plan whose file is no longer listed. Files that haven't changed give nothing.
 */
export function fileChanges(planId: string, files: ReadonlyMap<string, string>, base: Record<string, Rec>, now: number): Change[] {
  const out: Change[] = [];
  for (const [file, text] of files) {
    const id = planFileId(planId, file);
    if ((base[`${KIND}/${id}`] as unknown as PlanFile | undefined)?.text === text) continue;
    const data: PlanFile = { id, planId, file, text, updatedAt: now };
    out.push({ kind: KIND, id, data: data as unknown as Rec });
  }
  for (const [key, r] of Object.entries(base)) {
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
  try { c = JSON.parse(readFileSync(p, "utf8")); } catch { throw new Stop(`${p} isn't valid JSON.`); }
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
      body: JSON.stringify({ since: state.seq, changes }),
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
  const received = body.changes ?? [];
  const next = { seq: body.seq, records: applyChanges(state.records, changes, received) };
  saveState(next);
  return { state: next, received: received.length };
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
  const r = checkPlan(raw, (f) => { const p = join(folder, f); return existsSync(p) ? readFileSync(p, "utf8") : null; });
  if (r.problems.length || !r.plan) {
    console.log(`Found ${r.problems.length} problem${r.problems.length === 1 ? "" : "s"}:`);
    for (const p of r.problems) console.log(`- ${p}`);
    return null;
  }
  const sessions = r.plan.phases.reduce((n, p) => n + p.sessions.length, 0);
  console.log(`OK: plan ${r.plan.id}, ${r.plan.phases.length} phases, ${sessions} sessions, ${r.plan.documents.length} documents.`);
  return { plan: r.plan, texts: r.texts, planText };
}

async function push(folder: string) {
  const r = check(folder);
  if (!r) throw new Stop("Not pushing: fix the problems above first.");
  const files = new Map<string, string>([[PLAN_FILE, r.planText], ...r.texts]);
  const changes = fileChanges(r.plan.id, files, loadState().records, Date.now());
  const { received } = await sync(changes);
  const sent = changes.filter((c) => c.data).map((c) => (c.data as unknown as PlanFile).file);
  const gone = changes.filter((c) => !c.data).map((c) => c.id.slice(r.plan.id.length + 1));
  if (!changes.length) console.log("Nothing to push: the server already has these files.");
  else console.log(`Pushed ${sent.length} file(s)${sent.length ? ` (${sent.join(", ")})` : ""}${gone.length ? `; removed ${gone.join(", ")}` : ""}.`);
  if (received) console.log(`Received ${received} record(s) from the server.`);
}

async function pull(folder: string) {
  const { plan, problems } = readPlan(readFolder(folder).raw);
  if (!plan) throw new Stop(`Can't read the plan in ${folder}: ${problems.join(" ")}`);
  const { state, received } = await sync([]);
  const log = `training-log-${plan.id}.csv`, sets = `training-sets-${plan.id}.csv`;
  writeFileSync(join(folder, log), logCsv(plan, recordsOfKind<Entry>(state.records, "trainingEntries")));
  writeFileSync(join(folder, sets), setsCsv(plan, recordsOfKind<Lift>(state.records, "trainingLifts")));
  console.log(`Received ${received} record(s). Wrote ${log} and ${sets} in ${folder}.`);
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
