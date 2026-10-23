// Picture and video files for notes. Each file is stored in IndexedDB under its SHA-256 hash. A
// picture's file syncs through the server's /api/blobs/<hash> (the "images" records only carry the
// hash); a video's file stays on the device that added it, and only its still (poster) syncs
// (domain/media.ts says why).
import { useEffect, useState } from "react";
import { apiUrl } from "../platform.ts";
import * as db from "./db.ts";
import { MAX_VIDEO_BYTES } from "../domain/media.ts";
import { getToken } from "./sync.ts";

/** Longest side after shrinking, like the phone. */
const MAX_SIDE = 1600;
const MAX_BYTES = 1_800_000;

const key = (hash: string) => `blob:${hash}`;
export const getBlob = (hash: string) => db.get<Blob>(key(hash));

const listeners = new Set<(hash: string) => void>();
async function putBlob(hash: string, blob: Blob) {
  await db.put(key(hash), blob);
  listeners.forEach((l) => l(hash));
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Shrinks a picture, re-encodes it as JPEG and stores it. */
export async function importImage(file: Blob): Promise<{ hash: string; mime: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background in JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let quality = 0.85;
  let blob: Blob;
  do {
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the picture"))), "image/jpeg", quality));
    quality -= 0.1;
  } while (blob.size > MAX_BYTES && quality > 0.3);
  const hash = await sha256(blob);
  await putBlob(hash, blob);
  return { hash, mime: "image/jpeg", width, height };
}

/**
 * Stores a video as it is (videos aren't re-encoded: a browser can't shrink one quickly or well), with a
 * still from it as its poster. Throws for a video over MAX_VIDEO_BYTES.
 */
export async function importVideo(file: File): Promise<{ hash: string; mime: string; width: number; height: number; poster?: string; size: number; duration?: number; phoneOnly: true }> {
  if (file.size > MAX_VIDEO_BYTES) throw new Error(`Videos up to ${Math.round(MAX_VIDEO_BYTES / 1048576)} MB can be added`);
  const hash = await sha256(file);
  await putBlob(hash, file);
  const still = await videoStill(file).catch(() => null);
  return {
    hash, mime: file.type || "video/mp4", width: still?.width ?? 0, height: still?.height ?? 0,
    ...(still?.poster ? { poster: still.poster } : {}), size: file.size, ...(still?.duration ? { duration: still.duration } : {}), phoneOnly: true,
  };
}

/** A frame from early in the video, as a stored JPEG, with the video's size and length. */
async function videoStill(file: Blob): Promise<{ poster: string; width: number; height: number; duration: number }> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    await new Promise<void>((ok, fail) => { v.onloadeddata = () => ok(); v.onerror = () => fail(new Error("Can't read the video")); setTimeout(() => fail(new Error("timeout")), 8000); });
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    const at = Math.min(0.5, duration / 3);
    if (at > 0) await new Promise<void>((ok) => { v.onseeked = () => ok(); v.currentTime = at; setTimeout(ok, 2000); });
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight, 1));
    const width = Math.max(1, Math.round(v.videoWidth * scale)), height = Math.max(1, Math.round(v.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d")!.drawImage(v, 0, 0, width, height);
    const jpeg = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("no still"))), "image/jpeg", 0.8));
    const poster = await sha256(jpeg);
    await putBlob(poster, jpeg);
    return { poster, width: v.videoWidth, height: v.videoHeight, duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Object URL for a stored picture; updates when a file still downloading arrives. */
export function useImageUrl(hash: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hash) { setUrl(null); return; }
    let current: string | null = null;
    let alive = true;
    const load = async () => {
      const blob = await getBlob(hash);
      if (!blob || !alive) return;
      current = URL.createObjectURL(blob);
      setUrl(current);
    };
    const on = (h: string) => { if (h === hash && !current) void load(); };
    listeners.add(on);
    void load();
    return () => { alive = false; listeners.delete(on); if (current) URL.revokeObjectURL(current); };
  }, [hash]);
  return url;
}

/** Sends a picture file to the server (before its record, so the phone can always fetch it). */
export async function uploadBlob(hash: string, mime: string): Promise<void> {
  const blob = await getBlob(hash);
  if (!blob) return;
  const res = await fetch(apiUrl(`/api/blobs/${hash}`), {
    method: "PUT",
    headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": mime },
    body: blob,
  });
  if (!res.ok) throw new Error(`Picture upload failed (${res.status})`);
}

/** Downloads picture files this computer doesn't have yet. Failures are retried on the next sync. */
export async function fetchMissing(hashes: Iterable<string>): Promise<void> {
  for (const hash of new Set(hashes)) {
    if (await getBlob(hash)) continue;
    try {
      const res = await fetch(apiUrl(`/api/blobs/${hash}`), { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) continue;
      const blob = await res.blob();
      if ((await sha256(blob)) === hash) await putBlob(hash, blob);
    } catch { /* offline: next time */ }
  }
}
