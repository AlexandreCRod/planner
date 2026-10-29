// The looks that can be tried side by side (roadmap 254, "Looks to try" in Settings). Each is a setting
// kept on this device (localStorage "look.<key>"), its default the pick. Each is read in one place, through
// useLook (in a component) or look (elsewhere), so trimming one down later is deleting its branch there
// and its entry here. Changing one redraws what shows it at once (useLook subscribes).
import { useSyncExternalStore } from "react";

type Look = {
  /** The page the Looks page lists it under. */
  page: string;
  title: string;
  /** Each choice: its value, its short name (on the switch) and a one-line plain description. */
  choices: readonly (readonly [value: string, short: string, about: string])[];
  /** The pick (the default). */
  pick: string;
};

/** Every look, in the Looks page's order. */
export const LOOKS = {
  /**
   * The new event's box on the calendar (243). A: a crisp 1.5 px outline, 4 px corners, 6 px dots at the
   * top-right and bottom-left corners. B: a 1 px hairline with 16 × 3 px tabs in the middle of the top and
   * bottom edges. Its class on the box is `look-a` or `look-b` (phone.css); AddPanel picks the handle.
   */
  slot: { page: "Calendar", title: "New event's box", pick: "A", choices: [
    ["A", "A", "An outline, with a dot at two corners to drag"],
    ["B", "B", "A thin line, with a tab mid-top and mid-bottom to drag"],
  ] },
  /**
   * Tasks B (241): a Tasks button in Today's top bar that opens the whole Tasks page full-screen (both
   * lists, as before 241), on top of Tasks A's No date list and Agenda chips. PhoneToday.
   */
  tasks: { page: "Today", title: "Tasks button", pick: "A", choices: [
    ["A", "Off", "No button: to-dos without a date are on Today"],
    ["B", "On", "A Tasks button in the top bar opens the whole Tasks page"],
  ] },
  /**
   * The Training page's kind colours (239): all three use the brighter run, gym and futsal colours. A: each
   * icon in a stronger circle of its colour, physio in a grey one, and the week bar's segments still to do
   * tinted. B: A, plus a soft tint of the kind behind each row. C: A, with each circle filled in full colour
   * and a dark icon on it. Its class on the Training week is `tr-col-a`, `-b` or `-c` (training.css).
   */
  trainingColours: { page: "Training", title: "Colours", pick: "A", choices: [
    ["A", "A", "Each icon in a circle of its colour"],
    ["B", "B", "As A, plus a soft tint behind each row"],
    ["C", "C", "Full-colour circles with a dark icon"],
  ] },
  /** Futsal's colour (239): today's grey-blue, a brighter blue, or a violet of its own. Class `tr-fut-…`. */
  futsalColour: { page: "Training", title: "Futsal colour", pick: "now", choices: [
    ["now", "Grey-blue", "A quiet grey-blue"], ["blue", "Blue", "A brighter blue"], ["violet", "Violet", "A violet of its own"],
  ] },
  /**
   * Futsal's icon (239): "now" is the football; 1 a ball on the move, 2 a player kicking, 3 the ball in goal,
   * 4 boot and ball, 5 the indoor court, 6 the ball made solid (trainingParts.tsx, kindIcon).
   */
  futsalIcon: { page: "Training", title: "Futsal icon", pick: "6", choices: [
    ["now", "Football", "The classic football"], ["1", "Ball moving", "A ball on the move"],
    ["2", "Kick", "A player kicking"], ["3", "Goal", "The ball in the goal"], ["4", "Boot", "Boot and ball"],
    ["5", "Court", "The indoor court"], ["6", "Solid ball", "The football, filled in"],
  ] },
  /**
   * A run's icon by its type (239): Set 1, the runner leaning and streaking more the harder the run (a long
   * road, speed lines, the tape, a treadmill); Set 2, an object per type: shoe (easy), route (long),
   * stopwatch (quality), finish flag (race), treadmill (other). (trainingParts.tsx, runIcon; also the
   * bottom bar's Training icon.)
   */
  runIcons: { page: "Training", title: "Run icons", pick: "2", choices: [
    ["1", "Set 1", "A runner, leaning more the harder the run"],
    ["2", "Set 2", "A thing per run: shoe, route, stopwatch, flag"],
  ] },
  /**
   * An exercise's guide in a session (242; TrainingSession.tsx, TrainingGuide.tsx). A: a "How to · Watch"
   * line under each exercise ("How to" opens the whole guide). B: a small ⓘ by the name, opening a sheet
   * that stops halfway. C: a › after the name instead, opening the same sheet.
   */
  guides: { page: "Training", title: "Exercise guides in a session", pick: "B", choices: [
    ["A", "A", "A “How to · Watch” line under each exercise"],
    ["B", "B", "A small ⓘ by the name opens a half sheet"],
    ["C", "C", "The name as a link with ›, opening the same sheet"],
  ] },
} as const satisfies Record<string, Look>;

export type LookKey = keyof typeof LOOKS;
type ValueOf<K extends LookKey> = (typeof LOOKS)[K]["choices"][number][0];

const keyOf = (k: LookKey) => `look.${k}`;
const listeners = new Set<() => void>();
let version = 0;

/** A look's value now (outside a component, or in a handler); in a component use useLook so it redraws. */
export function look<K extends LookKey>(k: K): ValueOf<K> {
  const l: Look = LOOKS[k];
  let v: string | null = null;
  try { v = localStorage.getItem(keyOf(k)); } catch { /* private mode */ }
  return (v !== null && l.choices.some(([c]) => c === v) ? v : l.pick) as ValueOf<K>;
}

/** Sets a look (the pick goes back to being the default) and redraws what shows it. */
export function setLook<K extends LookKey>(k: K, v: ValueOf<K>) {
  try {
    if (v === LOOKS[k].pick) localStorage.removeItem(keyOf(k));
    else localStorage.setItem(keyOf(k), v);
  } catch { /* private mode */ }
  version++;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getVersion = () => version;

/** A look's value, kept current. */
export function useLook<K extends LookKey>(k: K): ValueOf<K> {
  useSyncExternalStore(subscribe, getVersion);
  return look(k);
}

/** Redraws the caller when any look changes (for helpers that read look() while it renders). */
export const useLooks = (): number => useSyncExternalStore(subscribe, getVersion);
