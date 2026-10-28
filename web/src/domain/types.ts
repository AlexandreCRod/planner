// Record shapes, field for field the same JSON the Android app writes (kotlinx.serialization with
// defaults included), so both apps can edit the same records through the sync server.

export type ItemType = "TASK" | "EVENT" | "NOTE";
export type Freq = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type OverduePolicy = "SHOW_OVERDUE" | "CARRY_OVER" | "SKIP";
export type AlertType = "NOTIFICATION" | "REMINDER" | "ALARM";

export interface Item {
  id: number;
  type: ItemType;
  title: string;
  /** Rich text as HTML. */
  content: string;
  categoryId: number | null;
  /** ARGB as a signed 32-bit int, like Android's Color.toArgb(). */
  color: number | null;
  /** Local days since 1970-01-01. */
  startDay: number | null;
  /** Minutes after midnight; null = untimed / all day. */
  startMin: number | null;
  endDay: number | null;
  endMin: number | null;
  allDay: boolean;
  freq: Freq;
  interval: number;
  /** Bitmask, Monday = bit 0 ... Sunday = bit 6. */
  weekDays: number;
  /** Comma separated 1..31, 32 = last day of month. */
  monthDays: string;
  /** Bitmask, January = bit 0. */
  months: number;
  untilDay: number | null;
  excludedDays: string;
  overduePolicy: OverduePolicy;
  parentId: number | null;
  noteDay: number | null;
  pinned: boolean;
  bgColor: number | null;
  bgPattern: number;
  fontFamily: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** 0 none, 1 low, 2 medium, 3 high, 4 urgent. */
  priority: number;
  /** Place name or address (missing on records made before places existed). */
  location?: string;
  /** The place's coordinates, when it was picked from the suggestions. */
  lat?: number | null;
  lng?: number | null;
  /** A picked place's own name ("Decathlon"; [location] is the label shown, the same unless renamed), its
   *  address, and a short area to tell places apart ("Alfragide"). Missing on records from before places
   *  had names, which show their location text as it is. */
  placeName?: string;
  address?: string;
  area?: string;
  /** A repeating task done as a habit: on Today's own checklist, a missed day only ends its streak
   *  (domain/routines.ts). Missing on records made before routines synced. */
  routine?: boolean;
  /** A note kept off the Notes page (still found by Search). Missing = shown. */
  hidden?: boolean;
  /** A pinned note's place among the pinned ones (lower first), set by dragging them; missing = after
   *  those that have one, oldest first. */
  pinOrder?: number;
  /** An unpinned note's place on the Notes page once dragged there, on the scale of edit times (higher
   *  first, among the others' last edits); missing = where its last edit puts it. */
  listOrder?: number;
  /** Counts as a futsal game on Training (domain/training.ts isFutsal): missing = by its title ("futsal", any case),
   *  true or false = the editor's "Counts as futsal" switch. Events only. */
  futsal?: boolean;
}

export interface Completion { itemId: number; day: number; completedAt: number }
export interface Reminder { id: number; itemId: number; offsetMin: number; type: AlertType; soundUri: string | null }
export interface Category { id: number; name: string; color: number; defaultAlert: AlertType }
export interface Tag { id: number; name: string }
export interface ItemTag { itemId: number; tagId: number }
export interface Link { sourceId: number; targetId: number; auto: boolean }
export interface NoteVersion { id: number; itemId: number; title: string; content: string; savedAt: number }
/** A picture on a note; the file is stored by its SHA-256 [hash] (see store/images.ts). */
export interface NoteImage {
  id: number; itemId: number; hash: string; mime: string; width: number; height: number; createdAt: number;
  /** A video's still (a JPEG's hash), the part of a video that syncs (domain/media.ts). */
  poster?: string;
  /** A video: its size in bytes, its length in seconds, and that its file is only on the phone that added it. */
  size?: number; duration?: number; phoneOnly?: boolean;
}

export const NO_DAY = 0;
export const PRIORITIES = ["None", "Low", "Medium", "High", "Urgent"] as const;
export const PRIORITY_COLORS = ["#9e9e9e", "#42a5f5", "#ffb300", "#ff7043", "#e53935"];
/** The phone's calmer priority colours: the same order, greyed and softened so they sit with the neutral palette. */
export const PRIORITY_COLORS_MUTED = ["#8e9094", "#7d93a8", "#a8915e", "#b07a62", "#b0605c"];
/**
 * A priority's colour on screen: the phone's theme colours (--prio-1 to --prio-4: blue, yellow, orange
 * and red, clearly apart in light and in dark), else the calm ones above.
 */
export const priorityColor = (p: number) => (p > 0 ? `var(--prio-${p}, ${PRIORITY_COLORS_MUTED[p]})` : PRIORITY_COLORS_MUTED[0]);

export function newItem(fields: Partial<Item> & { type: ItemType }): Item {
  const now = Date.now();
  return {
    id: 0, title: "", content: "", categoryId: null, color: null,
    startDay: null, startMin: null, endDay: null, endMin: null, allDay: false,
    freq: "NONE", interval: 1, weekDays: 0, monthDays: "", months: 0, untilDay: null, excludedDays: "",
    overduePolicy: "SHOW_OVERDUE", parentId: null, noteDay: null, pinned: false,
    bgColor: null, bgPattern: 0, fontFamily: 0, createdAt: now, updatedAt: now, deletedAt: null, priority: 0,
    location: "", lat: null, lng: null,
    ...fields,
  };
}

export const isRecurring = (i: Item) => i.freq !== "NONE";

/** Signed ARGB int → CSS colour. */
export function cssColor(argb: number): string {
  return "#" + ((argb >>> 0) & 0xffffff).toString(16).padStart(6, "0");
}

/** CSS #rrggbb → signed ARGB int (opaque). */
export function argbOf(hex: string): number {
  return (0xff000000 | parseInt(hex.replace("#", ""), 16)) | 0;
}

export const TYPE_COLORS: Record<ItemType, string> = { TASK: "#26a69a", EVENT: "#039be5", NOTE: "#ffa726" };

/**
 * The title with "↻" in front for repeating items, for places too small for a badge. Not for a routine: it
 * has its own mark (its ring), and both would overlap (215).
 */
export const displayTitle = (item: Item) => (isRecurring(item) && item.routine !== true ? "↻ " : "") + (item.title || "Untitled");
