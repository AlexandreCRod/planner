// The looks that can be tried side by side (roadmap 254, "Looks to try"): each is read here only, so a
// Settings switch later sets it in one place, and trimming one down is deleting its branch.

/**
 * The new event's box on the calendar (243). A: a crisp 1.5 px outline, 4 px corners, 6 px dots at the
 * top-right and bottom-left corners. B: a 1 px hairline with 16 × 3 px tabs in the middle of the top and
 * bottom edges. Its class on the box is `look-a` or `look-b` (phone.css).
 */
export const slotLook: "A" | "B" = "A";

/**
 * The Training page's kind colours (239): all three use the brighter run, gym and futsal colours. A: each
 * icon in a stronger circle of its colour, physio in a grey one, and the week bar's segments still to do
 * tinted. B: A, plus a soft tint of the kind behind each row. C: A, with each circle filled in full colour
 * and a dark icon on it. Its class on the Training week is `tr-col-a`, `-b` or `-c` (training.css).
 */
export const trainingColours: "A" | "B" | "C" = "A";

/** Futsal's colour (239): today's grey-blue, a brighter blue, or a violet of its own. Class `tr-fut-…`. */
export const futsalColour: "now" | "blue" | "violet" = "now";

/**
 * Futsal's icon (239): "now" is the football; 1 a ball on the move, 2 a player kicking, 3 the ball in goal,
 * 4 boot and ball, 5 the indoor court, 6 the ball made solid (trainingParts.tsx, futsalIcon).
 */
export const futsalIconLook: "now" | 1 | 2 | 3 | 4 | 5 | 6 = 6;

/**
 * A run's icon by its type (239): Set 1, the runner leaning and streaking more the harder the run (a long
 * road, speed lines, the tape, a treadmill); Set 2, an object per type: shoe (easy), route (long),
 * stopwatch (quality), finish flag (race), treadmill (other). (trainingParts.tsx, runIcon.)
 */
export const runIconSet: 1 | 2 = 2;

/**
 * Tasks B (241, for item 254): a Tasks button in Today's top bar that opens the whole Tasks page full-screen
 * (both lists, as before 241), on top of Tasks A's No date list and Agenda chips.
 */
export const tasksB: boolean = false;
