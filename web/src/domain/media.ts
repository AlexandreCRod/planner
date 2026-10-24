// A note's pictures and videos ("images" records). A picture's file syncs through the server's blob
// store (JPEG, at most about 1.8 MB, see store/images.ts). A video's file doesn't: the server takes
// pictures only, and up to 1.9 MB, so a video stays on the phone that added it (in its own storage), and
// only a still from it (its poster, a small JPEG) syncs: other devices show that still, marked as a video
// on the phone. Pure, so it's tested (test/media.test.ts).
import type { NoteImage } from "./types.ts";

/** The largest video a note takes (it's read whole once, to name it by its hash). */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export const isVideo = (m: Pick<NoteImage, "mime">) => String(m.mime ?? "").startsWith("video/");

/** The file that shows it small: the picture itself, or a video's poster ("" when it has none). */
export const previewHash = (m: Pick<NoteImage, "mime" | "hash" | "poster">) => (isVideo(m) ? m.poster ?? "" : m.hash);

/**
 * The files to have here for the synced records ([key, record] pairs): each note picture's file, or a
 * video's still, once each. After every sync the ones not stored yet are downloaded, and a picture
 * shown as missing appears as its file arrives (store/images.ts), without reloading the page.
 */
export function filesToFetch(records: Iterable<[string, unknown]>): string[] {
  const out = new Set<string>();
  for (const [key, r] of records) {
    if (!key.startsWith("images/") || !r || typeof r !== "object") continue;
    const h = previewHash({ mime: "image/jpeg", ...(r as Partial<NoteImage>) } as NoteImage);
    if (h) out.add(h);
  }
  return [...out];
}

/** The file that syncs through the server for it (a video's poster, never the video), or null. */
export function syncedFile(m: Pick<NoteImage, "mime" | "hash" | "poster">): { hash: string; mime: string } | null {
  if (!isVideo(m)) return { hash: m.hash, mime: m.mime || "image/jpeg" };
  return m.poster ? { hash: m.poster, mime: "image/jpeg" } : null;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/3gpp": "3gp", "video/x-matroska": "mkv",
};
/** A file name for saving it to the phone: "Planner 2026-10-23 1432.jpg". */
export function downloadName(m: Pick<NoteImage, "mime" | "createdAt">, n = 0): string {
  const d = new Date(m.createdAt);
  const p = (x: number) => String(x).padStart(2, "0");
  const ext = EXT[m.mime] ?? (m.mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin");
  return `Planner ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${n ? ` (${n})` : ""}.${ext}`;
}

/** [size] bytes cut into pieces of at most [piece] (a multiple of 3, so each one's base64 stands alone). */
export function pieces(size: number, piece = 3 * 256 * 1024): [number, number][] {
  const step = Math.max(3, piece - (piece % 3));
  const out: [number, number][] = [];
  for (let a = 0; a < size; a += step) out.push([a, Math.min(size, a + step)]);
  return out;
}

/** The lens's miniatures beside the big one: their longer side (px), and the gaps (px). */
export const LENS_MINI = 56;
const LENS_GAP = 14;
const MINI_GAP = 8;

/** The scale that makes an item of [w] x [h] px a miniature. */
export const miniScale = (w: number, h: number) => Math.min(1, LENS_MINI / Math.max(1, w, h));

/**
 * The lens, a carousel: the media in a row, the one at [offset] 0 big in the middle and the others as
 * miniatures beside it, by how far each is from the middle ([offset] is fractional while the row
 * slides). [w] is the big one's width, [mini] the item's own scale as a miniature (miniScale). Returns
 * where its centre goes (px from the middle), its scale, and how visible it is.
 */
export function lensPlace(offset: number, w: number, mini = miniScale(w, w)): { x: number; scale: number; opacity: number } {
  const a = Math.abs(offset), s = Math.sign(offset);
  // Next to the big one: half of it, a gap, half a miniature; then one miniature after another.
  const near = w / 2 + LENS_GAP + LENS_MINI / 2;
  const x = a <= 1 ? s * a * near : s * (near + (a - 1) * (LENS_MINI + MINI_GAP));
  const scale = 1 - (1 - mini) * Math.min(1, a);
  const opacity = a <= 3.5 ? 1 : Math.max(0, 1 - (a - 3.5) / 0.75);
  return { x, scale, opacity };
}

/** How far a finger slides the lens for one item: one miniature along. */
export function lensStep(): number {
  return LENS_MINI + MINI_GAP;
}

/**
 * Where the lens's row is for a finger [dx] px from where it started at [p0] (an item index): the finger
 * moving right brings the ones on the right to the middle, as if running along the miniatures.
 */
export function lensPosFor(p0: number, dx: number): number {
  return p0 + dx / lensStep();
}
