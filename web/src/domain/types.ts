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
  /** Coordinates when the place came from the device's position. */
  lat?: number | null;
  lng?: number | null;
}

export interface Completion { itemId: number; day: number; completedAt: number }
export interface Reminder { id: number; itemId: number; offsetMin: number; type: AlertType; soundUri: string | null }
export interface Category { id: number; name: string; color: number; defaultAlert: AlertType }
export interface Tag { id: number; name: string }
export interface ItemTag { itemId: number; tagId: number }
export interface Link { sourceId: number; targetId: number; auto: boolean }
export interface NoteVersion { id: number; itemId: number; title: string; content: string; savedAt: number }
/** A picture on a note; the file is stored by its SHA-256 [hash] (see store/images.ts). */
export interface NoteImage { id: number; itemId: number; hash: string; mime: string; width: number; height: number; createdAt: number }

export const NO_DAY = 0;
export const PRIORITIES = ["None", "Low", "Medium", "High", "Urgent"] as const;
export const PRIORITY_COLORS = ["#9e9e9e", "#42a5f5", "#ffb300", "#ff7043", "#e53935"];

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

export const TYPE_COLORS: Record<ItemType, string> = { TASK: "#26a69a", EVENT: "#5c6bc0", NOTE: "#ffa726" };

/** The title with "↻" in front for repeating items, for places too small for a badge. */
export const displayTitle = (item: Item) => (isRecurring(item) ? "↻ " : "") + (item.title || "Untitled");
