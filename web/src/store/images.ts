// Picture files for notes. Each file is stored in IndexedDB under its SHA-256 hash, and synced
// through the server's /api/blobs/<hash> (the "images" records only carry the hash), the same
// way the phone does it.
import { useEffect, useState } from "react";
import { apiUrl } from "../platform.ts";
import * as db from "./db.ts";
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

/** Object URL for a stored picture; updates when a file still downloading arrives. */
export function useImageUrl(hash: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
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
