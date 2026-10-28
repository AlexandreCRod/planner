// Small pieces the Training screens share: an icon per kind of session, a phase's short name, the
// numbered scales (effort, pain, RPE), number formats, every exercise by id and the rep bests worth showing.
import { runTypeOf } from "../../domain/healthRuns.ts";
import { type Exercise, type Session, type SessionKind, BEST_REPS } from "../../domain/training.ts";
import type { RunType } from "../../domain/trends.ts";
import type { Training } from "../../store/training.ts";
import { feel } from "./haptics.ts";
import { futsalColour, futsalIconLook, runIconSet, trainingColours } from "./looks.ts";

/** A kind's icon; a run with its session gets its type's (sessionIcon). */
export function kindIcon(kind: SessionKind | "futsal" | "record"): string {
  switch (kind) {
    case "run": return "oDirectionsRun";
    case "gym": return "oFitnessCenter";
    case "bike": return "oDirectionsBike";
    case "futsal": return FUTSAL_ICON[futsalIconLook];
    case "record": return "oEmojiEvents";
    default: return "oTaskAlt";
  }
}

/** A session's icon: a run's by its type (easy, long, quality, race), every other kind's by its kind. */
export const sessionIcon = (s: Session) => (s.kind === "run" ? runIcon(runTypeOf(s)) : kindIcon(s.kind));

// The looks to try (looks.ts), each read here only.
const FUTSAL_ICON = { now: "oSportsSoccer", 1: "tBallMoving", 2: "tPlayerKick", 3: "tBallGoal", 4: "tBootBall", 5: "tCourt", 6: "tBallSolid" } as const;
const RUN_ICONS: Record<1 | 2, Record<RunType, string>> = {
  1: { easy: "tRunner", long: "tRunnerLong", quality: "tSprint", race: "tRunnerTape", other: "tRunnerTreadmill" },
  2: { easy: "tShoe", long: "tRoute", quality: "tStopwatchFast", race: "tFinishFlag", other: "tTreadmill" },
};
export const runIcon = (type: RunType) => RUN_ICONS[runIconSet][type];
/** The Training week's classes for its kind colours and futsal's colour (training.css). */
export const trainingLookClass = `tr-col-${trainingColours.toLowerCase()} tr-fut-${futsalColour}`;

export const KIND_LABEL: Record<SessionKind, string> = { run: "Run", gym: "Gym", bike: "Bike", physio: "Physio", other: "Session" };

/** "Week 1 – Re-entry" → ["Week 1", "Re-entry"]; a name without a dash is all short. */
export function phaseNames(name: string): [string, string] {
  const m = /^(.*?)\s+[–—-]\s+(.*)$/.exec(name);
  return m ? [m[1], m[2]] : [name, ""];
}

/** 60 → "60", 62.5 → "62.5". */
export const fmtKg = (kg: number) => (Number.isInteger(kg) ? String(kg) : String(Math.round(kg * 100) / 100));

/** "2–3" sets of "5" → "2–3 × 5"; one set shows only its reps ("5 min"). */
export const setsText = (sets: string, reps: string) => (sets && sets !== "1" ? `${sets} × ${reps}` : reps);

/** The query that keeps an older plan open while moving between the Training screens. */
export const planQ = (planId: string | null) => (planId ? `&p=${encodeURIComponent(planId)}` : "");

/** A short random id for futsal and records (never derived from text or position). */
export const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** A row of numbered buttons (effort 1–10, pain 0–10, RPE): a tap picks, a tap on the picked one clears it. */
export function Scale({ label, hint, from, to, value, onPick, disabled }: {
  label: string; hint?: string; from: number; to: number; value: number | null; onPick: (v: number | null) => void; disabled?: boolean;
}) {
  return (
    <div className="tr-scale">
      <div className="tr-scale-head"><span>{label}</span>{hint && <span className="hint">{hint}</span>}</div>
      <div className="tr-scale-row" role="radiogroup" aria-label={label}>
        {Array.from({ length: to - from + 1 }, (_, k) => from + k).map((n) => (
          <button key={n} role="radio" aria-checked={value === n} className={value === n ? "on" : ""} disabled={disabled}
            onClick={() => { feel("tick"); onPick(value === n ? null : n); }}>{n}</button>
        ))}
      </div>
    </div>
  );
}

/** Every exercise named in any plan, by id; a later plan's name wins (ids are permanent across plans). */
export function allExercises(tr: Training): Map<string, Exercise> {
  const out = new Map<string, Exercise>();
  for (const p of tr.plans) for (const e of p.plan.exercises) out.set(e.id, e);
  return out;
}

export const bestWord = (n: number) => (n === 1 ? "1 rep" : `${n} reps`);

/** The rep counts worth showing: one is left out when more reps were done at the same weight or more. */
export const shownBests = (m: ReadonlyMap<number, { kg: number }>) =>
  BEST_REPS.filter((n) => m.has(n) && !BEST_REPS.some((k) => k > n && (m.get(k)?.kg ?? -1) >= m.get(n)!.kg));
