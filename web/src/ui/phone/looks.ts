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
   * lists, as before 241), beside the to-dos button (271) and the Agenda chips. PhoneToday.
   */
  tasks: { page: "Today", title: "Tasks button", pick: "A", choices: [
    ["A", "Off", "No Tasks button: the to-dos button opens them in a sheet"],
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
  /**
   * The notification card (218): 1, Android's group, a row per item with its own buttons and swipe; 2, one
   * card with a plain list, buttons for the next alarm only. Kotlin draws it (alarm/Card.kt); alarms/mirror.ts
   * hands it the choice.
   */
  notifCard: { page: "Notifications", title: "Coming-up card", pick: "1", choices: [
    ["1", "Rows", "A row per item, each with its own buttons and swipe"],
    ["2", "List", "One card with a plain list; buttons for the next alarm"],
  ] },
  /** The right-hand icon on the card's rows (218): rings, pops up, silent. Set 1 is the mockup's. */
  notifIcons: { page: "Notifications", title: "Row icons", pick: "1", choices: [
    ["1", "Bells", "Alarm clock, bell, quiet bell"],
    ["2", "Sound", "Alarm clock, speaker, speaker off"],
    ["3", "Soft", "Ringing bell, speech bubble, moon"],
  ] },
  /**
   * The ringing screen (246). Kotlin draws it (alarm/RingLayouts.kt); alarms/mirror.ts hands it these four.
   * A: a big thin clock, the bundle as dots, a Snooze pill. B: two big buttons, the bundle card, Stop the rest.
   */
  ringLayout: { page: "Ringing screen", title: "Layout", pick: "A", choices: [
    ["A", "A", "A big, thin clock, and a Snooze pill"],
    ["B", "B", "Two big buttons, the alarms of a bundle, Stop the rest"],
  ] },
  /** The "Today" card on the morning's first alarm, and B's "Next" line. */
  ringComing: { page: "Ringing screen", title: "Show what's coming up", pick: "on", choices: [
    ["on", "On", "A Today card on the morning's first alarm"],
    ["off", "Off", "Only the alarm"],
  ] },
  /** How a touch stops it. The volume keys and the notification always stop it too. */
  ringStop: { page: "Ringing screen", title: "How to stop", pick: "slide", choices: [
    ["slide", "Slide", "Slide the round button across"],
    ["hold", "Hold", "Press and hold for a moment"],
    ["tap", "Tap", "One tap"],
  ] },
  /** The stop and snooze icons (RingLayouts.kt, ringIcon). */
  ringIcons: { page: "Ringing screen", title: "Icons", pick: "1", choices: [
    ["1", "Alarm", "Alarm clock off, alarm clock with Zs"],
    ["2", "Plain", "A cross, a moon"],
    ["3", "Bell", "Bell off, an hourglass"],
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

/** Calls [fn] when any look changes (for what lives outside the components). */
export function onLooks(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** A look's value, kept current. */
export function useLook<K extends LookKey>(k: K): ValueOf<K> {
  useSyncExternalStore(subscribe, getVersion);
  return look(k);
}

/** Redraws the caller when any look changes (for helpers that read look() while it renders). */
export const useLooks = (): number => useSyncExternalStore(subscribe, getVersion);
