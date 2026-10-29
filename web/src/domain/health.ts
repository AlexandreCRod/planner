// The watch's data from Health Connect (item 213, 2.8.1's data plan), turned into Planner's own records.
// The phone reads raw records from Health Connect (health/healthConnect.ts, through the small Kotlin plugin
// health/HealthConnectPlugin.kt) and this file, pure, makes three kinds of user-owned records of them,
// written only by the phone and read everywhere:
// - healthSessions: one per exercise session (a run, a walk, a gym session, futsal...), id "hc:<metadata id>":
//   its times, moving time (minus pauses), distance, climb, steps, calories, heart rate, cadence, laps,
//   per-km splits and a compact heart-rate line (one value per 15 s). No full series.
// - healthNights: one per sleep session, id "hc:<metadata id>", on the morning it ends: bed and wake, the
//   minutes per stage, and the stages compactly.
// - healthDays: one per local day, id "hcd:YYYY-MM-DD": steps, distance, calories, floors, climb, resting
//   HR, HRV, SpO2, respiration, the day's heart-rate range, VO2 max, weigh-ins, and an "extra" map for any
//   other type, so a new type needs no format change.
// Raw records come as the plugin gives them: their own fields, times in epoch ms, zone offsets in seconds,
// units metric (m, kg, kcal, m/s, W, °C, L), plus metadata {id, origin, lastModified, device}.
// Merging these with runs.json, sleep.json and the weigh-ins is done where they're shown, not here.
import { isoOf } from "./training.ts";

const DAY_MS = 86_400_000;

// ---------- Raw records ----------

export interface RawMeta { id: string; origin?: string; lastModified?: number; device?: { type?: number; manufacturer?: string | null; model?: string | null } }
export interface RawRecord { metadata: RawMeta; [field: string]: unknown }
/** Raw records by type name ("ExerciseSession", "HeartRate"...). */
export type RawByType = Record<string, RawRecord[] | undefined>;

/** Every type the phone reads, in the order it reads them (the plugin's names). */
export const HC_TYPES = [
  "ExerciseSession", "SleepSession", "HeartRate", "RestingHeartRate", "HeartRateVariabilityRmssd", "OxygenSaturation",
  "RespiratoryRate", "Steps", "StepsCadence", "Distance", "Speed", "Power", "CyclingPedalingCadence", "ActiveCaloriesBurned",
  "TotalCaloriesBurned", "BasalMetabolicRate", "FloorsClimbed", "ElevationGained", "WheelchairPushes", "Vo2Max", "Weight",
  "BodyFat", "Height", "LeanBodyMass", "BoneMass", "BodyWaterMass", "BodyTemperature", "BasalBodyTemperature",
  "SkinTemperature", "BloodPressure", "BloodGlucose", "Hydration", "Nutrition", "PlannedExerciseSession",
] as const;

// ---------- Planner's records ----------

export interface HealthLap { startS: number; endS: number; m: number | null }
/** One km (the last one may be shorter: km is then where it ended, e.g. 8.34): its moving seconds and average HR. */
export interface HealthSplit { km: number; s: number; hr: number | null }

export interface HealthSession {
  /** "hc:<Health Connect's id>". */
  id: string;
  day: number;
  /** Local "HH:MM". */
  time: string;
  endTime: string;
  /** When it started, epoch ms (for matching the same run elsewhere). */
  startMs: number;
  durationS: number;
  /** Duration minus pauses (the session's pause segments, else stops in the speed series). */
  movingS: number;
  /** Health Connect's name: "running", "running_treadmill", "walking", "strength_training", "soccer"... */
  exerciseType: string;
  title: string;
  /** The app that wrote it, e.g. "com.garmin.android.apps.connectmobile". */
  source: string;
  distanceKm: number | null;
  ascentM: number | null;
  steps: number | null;
  kcal: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Steps per minute of moving time. */
  cadenceSpm: number | null;
  laps: HealthLap[];
  splits: HealthSplit[];
  /** Average HR per 15 s from the start; 0 where there was no reading. */
  hr: number[];
  updatedAt: number;
}

export type SleepStage = "awake" | "sleeping" | "out_of_bed" | "light" | "deep" | "rem" | "awake_in_bed" | "unknown";
/** [stage, startMin, endMin], minutes from bed. */
export type StageSpan = [SleepStage, number, number];

export interface HealthNight {
  id: string;
  /** The morning it ends. */
  day: number;
  /** Local "YYYY-MM-DDTHH:MM", as sleep.json. */
  bed: string;
  wake: string;
  /** Asleep: deep + light + REM (+ plain "sleeping" from trackers without stages); the whole time when there are no stages. */
  totalMin: number;
  awakeMin: number | null;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  stages: StageSpan[];
  source: string;
  updatedAt: number;
}

export interface HealthWeighIn { time: string; kg: number; fatPct: number | null; source: string }

export interface HealthDay {
  /** "hcd:YYYY-MM-DD". */
  id: string;
  day: number;
  steps: number | null;
  distanceKm: number | null;
  kcalTotal: number | null;
  kcalActive: number | null;
  floors: number | null;
  ascentM: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  spo2: number | null;
  respiration: number | null;
  hrMin: number | null;
  hrAvg: number | null;
  hrMax: number | null;
  vo2max: number | null;
  weighIns: HealthWeighIn[];
  /** Any other type's value for the day, by name (see EXTRA); a type it doesn't know: "<Type>Count". */
  extra: Record<string, number>;
  updatedAt: number;
}

export interface HealthRecords { sessions: HealthSession[]; nights: HealthNight[]; days: HealthDay[] }

// ---------- Small helpers ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v: number, places = 0) => { const f = 10 ** places; return Math.round(v * f) / f; };
const orNull = (v: number | null, places = 0) => (v === null ? null : round(v, places));
const pad = (n: number) => String(n).padStart(2, "0");

/** The record's zone offset in ms at [field] ("startZoneOffset", "zoneOffset"...); 0 when it has none. */
const offsetMs = (r: RawRecord, field = "startZoneOffset") => (num(r[field]) ?? num(r.zoneOffset) ?? num(r.startZoneOffset) ?? 0) * 1000;
const startOf = (r: RawRecord) => num(r.startTime) ?? num(r.time) ?? 0;
const endOf = (r: RawRecord) => num(r.endTime) ?? num(r.time) ?? 0;
/** The local epoch day of instant [ms] at offset [off] (ms). */
export const localDay = (ms: number, off: number) => Math.floor((ms + off) / DAY_MS);
/** Local "HH:MM" of [ms] at [off]. */
export function localTime(ms: number, off: number): string {
  const d = new Date(ms + off);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** Local "YYYY-MM-DDTHH:MM" of [ms] at [off]. */
export const localMoment = (ms: number, off: number) => `${isoOf(localDay(ms, off))}T${localTime(ms, off)}`;

interface Sample { t: number; v: number }
/** A series type's samples (field [field] of each sample) inside [from, to), oldest first. */
function samples(records: RawRecord[] | undefined, field: string, from = -Infinity, to = Infinity): Sample[] {
  const out: Sample[] = [];
  for (const r of records ?? []) {
    if (endOf(r) < from || startOf(r) > to) continue;
    for (const s of (Array.isArray(r.samples) ? r.samples : []) as Record<string, unknown>[]) {
      const t = num(s.time), v = num(s[field]);
      if (t !== null && v !== null && t >= from && t < to) out.push({ t, v });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Records of a type that write by origin: the session's own app first, else any. */
function fromOrigin(records: RawRecord[] | undefined, origin: string): RawRecord[] {
  const list = records ?? [];
  const own = list.filter((r) => r.metadata.origin === origin);
  return own.length ? own : list;
}

/**
 * The sum of [field] over interval records within [from, to), each counted by the part of it inside;
 * null when none touches it. Only one app's records count, as apps copy each other's (the session's app
 * when it wrote any, else the app with the most).
 */
function sumIn(records: RawRecord[] | undefined, field: string, from: number, to: number, origin?: string): number | null {
  const byOrigin = new Map<string, number>();
  for (const r of records ?? []) {
    const v = num(r[field]);
    if (v === null) continue;
    const s = startOf(r), e = endOf(r);
    const part = e > s ? overlap(s, e, from, to) / (e - s) : s >= from && s < to ? 1 : 0;
    if (part <= 0) continue;
    const o = r.metadata.origin ?? "";
    byOrigin.set(o, (byOrigin.get(o) ?? 0) + v * part);
  }
  if (!byOrigin.size) return null;
  if (origin !== undefined && byOrigin.has(origin)) return byOrigin.get(origin)!;
  return Math.max(...byOrigin.values());
}

// ---------- Exercise sessions ----------

const PAUSE_SEGMENT = 39;
/** Below this the speed series counts as stopped (m/s), when the session has no pause segments. */
const STOPPED_MS = 0.5;
/** A gap in a series longer than this isn't bridged (ms). */
const MAX_GAP = 30_000;
const HR_STEP = 15_000;

/** Paused stretches [from, to) in ms: the pause segments, else where the speed series stands still. */
function pausesOf(r: RawRecord, speed: Sample[], start: number, end: number): [number, number][] {
  const segs = (Array.isArray(r.segments) ? r.segments : []) as RawRecord[];
  const paused = segs.filter((s) => num(s.segmentType) === PAUSE_SEGMENT).map((s): [number, number] => [Math.max(start, startOf(s)), Math.min(end, endOf(s))]);
  if (paused.length || speed.length < 2) return paused.filter(([a, b]) => b > a);
  const out: [number, number][] = [];
  for (let i = 0; i < speed.length - 1; i++) {
    const a = speed[i], b = speed[i + 1];
    if (a.v < STOPPED_MS || b.t - a.t > MAX_GAP) {
      const last = out[out.length - 1];
      if (last && last[1] === a.t) last[1] = b.t; else out.push([a.t, b.t]);
    }
  }
  return out;
}

/**
 * Cumulative distance (m) at points in time, from the speed series (scaled to [total] when known), else
 * from the laps' lengths, else from distance records; null when there's nothing to go by.
 */
function distanceCurve(r: RawRecord, speed: Sample[], distance: RawRecord[], start: number, end: number, total: number | null): Sample[] | null {
  if (speed.length >= 2) {
    const curve: Sample[] = [{ t: speed[0].t, v: 0 }];
    let d = 0;
    for (let i = 0; i < speed.length - 1; i++) {
      const dt = speed[i + 1].t - speed[i].t;
      if (dt <= MAX_GAP) d += speed[i].v * dt / 1000;
      curve.push({ t: speed[i + 1].t, v: d });
    }
    const last = speed[speed.length - 1];
    if (end > last.t && end - last.t <= MAX_GAP) curve.push({ t: end, v: d += last.v * (end - last.t) / 1000 });
    if (total !== null && d > 0) for (const p of curve) p.v *= total / d;
    return curve;
  }
  const laps = ((Array.isArray(r.laps) ? r.laps : []) as RawRecord[]).filter((l) => num(l.length) !== null).sort((a, b) => startOf(a) - startOf(b));
  const pieces = laps.length ? laps.map((l) => ({ s: startOf(l), e: endOf(l), m: num(l.length)! }))
    : distance.filter((x) => overlap(startOf(x), endOf(x), start, end) > 0).sort((a, b) => startOf(a) - startOf(b)).map((x) => ({ s: startOf(x), e: endOf(x), m: num(x.distance) ?? 0 }));
  if (pieces.length < 2) return null;
  const curve: Sample[] = [{ t: pieces[0].s, v: 0 }];
  let d = 0;
  for (const p of pieces) {
    if (p.s > curve[curve.length - 1].t) curve.push({ t: p.s, v: d });
    d += p.m;
    curve.push({ t: p.e, v: d });
  }
  return curve;
}

/** When [curve] reaches [m] metres, interpolated. */
function timeAt(curve: Sample[], m: number): number {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if (b.v >= m) return b.v === a.v ? b.t : a.t + (b.t - a.t) * (m - a.v) / (b.v - a.v);
  }
  return curve[curve.length - 1].t;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function sessionOf(r: RawRecord, raw: RawByType, now: number): HealthSession {
  const start = startOf(r), end = Math.max(endOf(r), start);
  const off = offsetMs(r);
  const origin = r.metadata.origin ?? "";
  const speed = samples(fromOrigin(raw.Speed, origin), "speed", start, end + 1);
  const hrs = samples(fromOrigin(raw.HeartRate, origin), "beatsPerMinute", start, end + 1);
  const pauses = pausesOf(r, speed, start, end);
  const pausedBefore = (t: number) => pauses.reduce((sum, [a, b]) => sum + overlap(a, b, start, t), 0);
  const moving = (t: number) => (t - start) - pausedBefore(t);
  const durationS = Math.round((end - start) / 1000);
  const movingS = Math.round(moving(end) / 1000);

  const laps: HealthLap[] = ((Array.isArray(r.laps) ? r.laps : []) as RawRecord[]).map((l) => ({
    startS: Math.round((startOf(l) - start) / 1000), endS: Math.round((endOf(l) - start) / 1000), m: orNull(num(l.length)),
  })).sort((a, b) => a.startS - b.startS);
  const lapM = laps.reduce((s, l) => s + (l.m ?? 0), 0);
  let distM = sumIn(raw.Distance, "distance", start, end, origin);
  if (distM === null && lapM > 0) distM = lapM;
  if (distM === null && speed.length >= 2) {
    distM = 0;
    for (let i = 0; i < speed.length - 1; i++) { const dt = speed[i + 1].t - speed[i].t; if (dt <= MAX_GAP) distM += speed[i].v * dt / 1000; }
  }
  const steps = sumIn(raw.Steps, "count", start, end, origin);
  const kcal = sumIn(raw.ActiveCaloriesBurned, "energy", start, end, origin) ?? sumIn(raw.TotalCaloriesBurned, "energy", start, end, origin);
  const hrAt = (a: number, b: number) => orNull(mean(hrs.filter((s) => s.t >= a && s.t < b).map((s) => s.v)));
  const cadence = steps !== null && movingS > 0 ? steps / (movingS / 60)
    : mean(samples(fromOrigin(raw.StepsCadence, origin), "rate", start, end + 1).map((s) => s.v));

  const splits: HealthSplit[] = [];
  const curve = distM !== null && distM > 0 ? distanceCurve(r, speed, raw.Distance ?? [], start, end, distM) : null;
  if (curve && distM !== null) {
    const reached = curve[curve.length - 1].v;
    let prevT = start, prevM = 0;
    for (let km = 1; km * 1000 <= reached + 0.5; km++) {
      const t = timeAt(curve, km * 1000);
      splits.push({ km, s: Math.round((moving(t) - moving(prevT)) / 1000), hr: hrAt(prevT, t) });
      prevT = t; prevM = km * 1000;
    }
    if (reached - prevM >= 50) {
      splits.push({ km: round(reached / 1000, 2), s: Math.round((moving(end) - moving(prevT)) / 1000), hr: hrAt(prevT, end + 1) });
    }
  }

  const line: number[] = [];
  if (hrs.length) for (let t = start; t < end; t += HR_STEP) line.push(hrAt(t, t + HR_STEP) ?? 0);

  return {
    id: `hc:${r.metadata.id}`, day: localDay(start, off), time: localTime(start, off), endTime: localTime(end, offsetMs(r, "endZoneOffset")), startMs: start,
    durationS, movingS,
    exerciseType: typeof r.exerciseTypeName === "string" ? r.exerciseTypeName : `type_${num(r.exerciseType) ?? 0}`,
    title: typeof r.title === "string" ? r.title : "", source: origin,
    distanceKm: distM === null ? null : round(distM / 1000, 2),
    ascentM: orNull(sumIn(raw.ElevationGained, "elevation", start, end, origin)),
    steps: orNull(steps), kcal: orNull(kcal),
    avgHr: orNull(mean(hrs.map((s) => s.v))), maxHr: hrs.length ? Math.round(Math.max(...hrs.map((s) => s.v))) : null,
    cadenceSpm: orNull(cadence), laps, splits, hr: line, updatedAt: now,
  };
}

// ---------- Sleep ----------

const STAGES: SleepStage[] = ["unknown", "awake", "sleeping", "out_of_bed", "light", "deep", "rem", "awake_in_bed"];

export function nightOf(r: RawRecord, now: number): HealthNight {
  const bed = startOf(r), wake = Math.max(endOf(r), bed);
  const off = offsetMs(r), offEnd = offsetMs(r, "endZoneOffset");
  const raw = ((Array.isArray(r.stages) ? r.stages : []) as RawRecord[]).sort((a, b) => startOf(a) - startOf(b));
  const stages: StageSpan[] = raw.map((s) => [STAGES[num(s.stage) ?? 0] ?? "unknown", Math.round((startOf(s) - bed) / 60_000), Math.round((endOf(s) - bed) / 60_000)]);
  const minutes = (...kinds: SleepStage[]) => {
    let ms = 0;
    for (const s of raw) if (kinds.includes(STAGES[num(s.stage) ?? 0] ?? "unknown")) ms += endOf(s) - startOf(s);
    return Math.round(ms / 60_000);
  };
  const has = raw.length > 0;
  return {
    id: `hc:${r.metadata.id}`, day: localDay(wake, offEnd), bed: localMoment(bed, off), wake: localMoment(wake, offEnd),
    totalMin: has ? minutes("light", "deep", "rem", "sleeping") : Math.round((wake - bed) / 60_000),
    awakeMin: has ? minutes("awake", "awake_in_bed", "out_of_bed") : null,
    deepMin: has ? minutes("deep") : null, lightMin: has ? minutes("light") : null, remMin: has ? minutes("rem") : null,
    stages, source: r.metadata.origin ?? "", updatedAt: now,
  };
}

// ---------- Days ----------

/** The types a day's own fields come from; the rest go in extra. */
const DAY_TYPES = new Set(["ExerciseSession", "SleepSession", "HeartRate", "RestingHeartRate", "HeartRateVariabilityRmssd", "OxygenSaturation",
  "RespiratoryRate", "Steps", "Distance", "ActiveCaloriesBurned", "TotalCaloriesBurned", "FloorsClimbed", "ElevationGained", "Vo2Max", "Weight", "BodyFat",
  // Within sessions only (their series), not worth a daily number:
  "Speed", "Power", "StepsCadence", "CyclingPedalingCadence"]);

/** Other types' daily value: [key, field, how] (last: the day's latest; avg; sum). 1 W of BMR = 20.65 kcal a day. */
const EXTRA: Record<string, [string, string, "last" | "avg" | "sum", number?][]> = {
  Height: [["heightM", "height", "last"]],
  BasalMetabolicRate: [["bmrKcal", "basalMetabolicRate", "avg", 20.6362]],
  LeanBodyMass: [["leanKg", "mass", "last"]],
  BoneMass: [["boneKg", "mass", "last"]],
  BodyWaterMass: [["waterKg", "mass", "last"]],
  BodyTemperature: [["bodyTempC", "temperature", "avg"]],
  BasalBodyTemperature: [["basalTempC", "temperature", "avg"]],
  BloodPressure: [["systolic", "systolic", "avg"], ["diastolic", "diastolic", "avg"]],
  BloodGlucose: [["glucoseMmol", "level", "avg"]],
  Hydration: [["waterL", "volume", "sum"]],
  Nutrition: [["foodKcal", "energy", "sum"]],
  WheelchairPushes: [["pushes", "count", "sum"]],
};

/** The local day a record belongs to: an instant's day, an interval's start day. */
const dayOfRecord = (r: RawRecord) => localDay(startOf(r), offsetMs(r));

export function daysOf(raw: RawByType, from: number, to: number, now: number): HealthDay[] {
  const days = new Map<number, HealthDay>();
  const get = (day: number): HealthDay => {
    let d = days.get(day);
    if (!d) {
      d = {
        id: `hcd:${isoOf(day)}`, day, steps: null, distanceKm: null, kcalTotal: null, kcalActive: null, floors: null, ascentM: null,
        restingHr: null, hrvMs: null, spo2: null, respiration: null, hrMin: null, hrAvg: null, hrMax: null, vo2max: null, weighIns: [], extra: {}, updatedAt: now,
      };
      days.set(day, d);
    }
    return d;
  };
  const inRange = (day: number) => day >= from && day < to;
  /** A type's records by local day. */
  const byDay = (type: string) => {
    const m = new Map<number, RawRecord[]>();
    for (const r of raw[type] ?? []) { const day = dayOfRecord(r); if (inRange(day)) m.set(day, [...(m.get(day) ?? []), r]); }
    return m;
  };
  // A day's totals run from local midnight to midnight (266): a record over midnight (a walk, a night's
  // steps) is shared out between the two days by its time on each.
  const total = (type: string, field: string, set: (d: HealthDay, v: number) => void) => {
    const m = new Map<number, { rs: RawRecord[]; off: number }>();
    for (const r of raw[type] ?? []) {
      const off = offsetMs(r), s = startOf(r);
      const a = localDay(s, off), b = Math.min(a + 2, Math.max(a, localDay(Math.max(s, endOf(r) - 1), off)));
      for (let day = a; day <= b; day++) {
        if (!inRange(day)) continue;
        const e = m.get(day);
        if (e) e.rs.push(r); else m.set(day, { rs: [r], off });
      }
    }
    for (const [day, { rs, off }] of m) { const v = sumIn(rs, field, day * DAY_MS - off, (day + 1) * DAY_MS - off); if (v !== null) set(get(day), v); }
  };
  // The nights (not naps: those start after 10:00 on the day they end), for the overnight readings below.
  const sleeps = (raw.SleepSession ?? []).flatMap((r) => {
    const s = startOf(r), e = endOf(r), off = offsetMs(r), offEnd = offsetMs(r, "endZoneOffset");
    const day = localDay(e, offEnd);
    return localDay(s, off) === day && localTime(s, off) >= "10:00" ? [] : [{ s, e, day }];
  });
  /**
   * HRV, blood oxygen and breathing rate: a night's readings belong to the morning it ends (266: one after
   * midnight and one before went to two days), and a day with any taken asleep averages only those, so a
   * spot check by day doesn't count in the overnight figure. Readings outside a night go by their own day.
   */
  const overnight = (type: string, field: string, places: number, set: (d: HealthDay, v: number) => void) => {
    const m = new Map<number, { asleep: number[]; awake: number[] }>();
    for (const r of raw[type] ?? []) {
      const v = num(r[field]);
      if (v === null) continue;
      const t = startOf(r), night = sleeps.find((n) => t >= n.s && t <= n.e);
      const day = night ? night.day : dayOfRecord(r);
      if (!inRange(day)) continue;
      let e = m.get(day);
      if (!e) m.set(day, e = { asleep: [], awake: [] });
      (night ? e.asleep : e.awake).push(v);
    }
    for (const [day, { asleep, awake }] of m) { const v = mean(asleep.length ? asleep : awake); if (v !== null) set(get(day), round(v, places)); }
  };
  const values = (rs: RawRecord[], field: string) => rs.map((r) => num(r[field])).filter((v): v is number => v !== null);
  const latest = (rs: RawRecord[], field: string) => { const r = [...rs].sort((a, b) => startOf(b) - startOf(a)).find((x) => num(x[field]) !== null); return r ? num(r[field]) : null; };

  total("Steps", "count", (d, v) => { d.steps = Math.round(v); });
  total("Distance", "distance", (d, v) => { d.distanceKm = round(v / 1000, 2); });
  total("TotalCaloriesBurned", "energy", (d, v) => { d.kcalTotal = Math.round(v); });
  total("ActiveCaloriesBurned", "energy", (d, v) => { d.kcalActive = Math.round(v); });
  total("FloorsClimbed", "floors", (d, v) => { d.floors = round(v, 1); });
  total("ElevationGained", "elevation", (d, v) => { d.ascentM = Math.round(v); });
  for (const [day, rs] of byDay("RestingHeartRate")) { const v = latest(rs, "beatsPerMinute"); if (v !== null) get(day).restingHr = Math.round(v); }
  for (const [day, rs] of byDay("Vo2Max")) { const v = latest(rs, "vo2MillilitersPerMinuteKilogram"); if (v !== null) get(day).vo2max = round(v, 1); }
  overnight("HeartRateVariabilityRmssd", "heartRateVariabilityMillis", 0, (d, v) => { d.hrvMs = v; });
  overnight("OxygenSaturation", "percentage", 1, (d, v) => { d.spo2 = v; });
  overnight("RespiratoryRate", "rate", 1, (d, v) => { d.respiration = v; });

  // Heart rate: every sample by its own local day.
  const hr = new Map<number, number[]>();
  for (const r of raw.HeartRate ?? []) {
    const off = offsetMs(r);
    for (const s of (Array.isArray(r.samples) ? r.samples : []) as Record<string, unknown>[]) {
      const t = num(s.time), v = num(s.beatsPerMinute);
      if (t === null || v === null) continue;
      const day = localDay(t, off);
      if (inRange(day)) { const list = hr.get(day); if (list) list.push(v); else hr.set(day, [v]); }
    }
  }
  for (const [day, vs] of hr) {
    const d = get(day);
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (const v of vs) { if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
    d.hrMin = Math.round(lo); d.hrMax = Math.round(hi); d.hrAvg = Math.round(sum / vs.length);
  }

  // Weigh-ins, with the body fat measured within 10 minutes.
  const fats = raw.BodyFat ?? [];
  for (const [day, rs] of byDay("Weight")) {
    const d = get(day);
    for (const r of [...rs].sort((a, b) => startOf(a) - startOf(b))) {
      const kg = num(r.weight);
      if (kg === null) continue;
      const t = startOf(r);
      const fat = fats.filter((f) => Math.abs(startOf(f) - t) <= 600_000).sort((a, b) => Math.abs(startOf(a) - t) - Math.abs(startOf(b) - t))[0];
      d.weighIns.push({ time: localTime(t, offsetMs(r)), kg: round(kg, 2), fatPct: fat ? orNull(num(fat.percentage), 1) : null, source: r.metadata.origin ?? "" });
    }
  }

  // Everything else.
  for (const type of Object.keys(raw)) {
    if (DAY_TYPES.has(type)) continue;
    const how = EXTRA[type];
    for (const [day, rs] of byDay(type)) {
      const d = get(day);
      if (!how) { d.extra[`${type}Count`] = rs.length; continue; }
      for (const [key, field, kind, factor = 1] of how) {
        const v = kind === "last" ? latest(rs, field) : kind === "sum" ? sumIn(rs, field, -Infinity, Infinity) : mean(values(rs, field));
        if (v !== null) d.extra[key] = round(v * factor, 2);
      }
    }
  }
  return [...days.values()].sort((a, b) => a.day - b.day);
}

// ---------- All of it ----------

/**
 * Planner's records from the raw records read for local days [from, to) (epoch days; the raw records may
 * reach a day further either side, so sessions and nights at the edges are whole). Sessions count by the
 * day they start, nights by the morning they end, days by their own.
 */
export function convertHealth(raw: RawByType, from: number, to: number, now: number): HealthRecords {
  const sessions = (raw.ExerciseSession ?? []).map((r) => sessionOf(r, raw, now)).filter((s) => s.day >= from && s.day < to);
  const nights = (raw.SleepSession ?? []).map((r) => nightOf(r, now)).filter((n) => n.day >= from && n.day < to);
  return { sessions, nights, days: daysOf(raw, from, to, now) };
}

/** JSON with sorted keys, so two copies of a record compare equal whatever order their fields came in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter((k) => k !== "updatedAt").sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Whether [a] and [b] say the same, apart from when they were made. */
export const sameRecord = (a: unknown, b: unknown) => stable(a) === stable(b);

/**
 * The records of [fresh] that differ from what's stored ([stored] by id). [newOnly]: only those not stored
 * at all, for a window where some type couldn't be read, so a whole stored record isn't replaced by one
 * missing that type's part (it's completed on the next read, which retries the type).
 */
export function changedOnly<T extends { id: string }>(fresh: T[], stored: ReadonlyMap<string, unknown>, newOnly = false): T[] {
  return fresh.filter((r) => (newOnly ? !stored.has(r.id) : !sameRecord(r, stored.get(r.id))));
}

// ---------- When to read ----------

/** Re-read this far back from the last read, for data the watch synced late. */
export const REREAD_DAYS = 3;
/** First connect reads the history in windows this long, to keep memory low. */
export const WINDOW_DAYS = 14;
/** First connect reads this many newest days first, so the last few days show at once (253). */
export const FIRST_DAYS = 7;

/**
 * The local-day windows [from, to) to convert, in the order to read them. On first connect
 * ([lastReadDay] null): the newest [FIRST_DAYS] days, then back in [WINDOW_DAYS] chunks to [firstDay]
 * (the earliest day with data). After that: from [REREAD_DAYS] before the day of the last read to today
 * inclusive, oldest first.
 */
export function readWindows(lastReadDay: number | null, firstDay: number, today: number): [number, number][] {
  const out: [number, number][] = [];
  if (lastReadDay === null) {
    const first = Math.min(firstDay, today);
    let from = Math.max(first, today + 1 - FIRST_DAYS);
    out.push([from, today + 1]);
    while (from > first) { const to = from; from = Math.max(first, to - WINDOW_DAYS); out.push([from, to]); }
    return out;
  }
  for (let d = Math.min(lastReadDay - REREAD_DAYS, today); d <= today; d += WINDOW_DAYS) out.push([d, Math.min(d + WINDOW_DAYS, today + 1)]);
  return out;
}
