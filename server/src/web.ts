// Fetching for web link previews (GET /api/preview): short timeouts, capped
// reads, redirects followed by hand so every host is checked, and a browser-like User-Agent.
import { type Preview, charsetOf, parsePage, parseWebUrl, toBase64 } from "./preview.ts";

const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const TIMEOUT_MS = 4000;
const MAX_PAGE_BYTES = 262_144;
const MAX_IMAGE_BYTES = 150_000;
const MAX_REDIRECTS = 5;

/** Reads at most [max] bytes of a response body. */
export async function readCapped(res: Response, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= max) { truncated = total > max; await reader.cancel().catch(() => {}); break; }
  }
  const bytes = new Uint8Array(Math.min(total, max));
  let at = 0;
  for (const c of chunks) { const part = c.subarray(0, Math.max(0, bytes.length - at)); bytes.set(part, at); at += part.length; }
  return { bytes, truncated };
}

/** GET [start], following up to 5 redirects by hand; each address must pass [allowed]. Gives the last response and its address. */
export async function fetchFollowing(start: URL, allowed: (u: URL) => boolean, accept: string): Promise<{ res: Response; url: URL } | null> {
  let url = start;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(url.href, {
      redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en;q=0.8" },
    });
    const loc = res.headers.get("Location");
    if (res.status >= 300 && res.status < 400 && loc) {
      let next: URL;
      try { next = new URL(loc, url); } catch { return null; }
      if (!allowed(next)) return null;
      url = next;
      continue;
    }
    return { res, url };
  }
  return null;
}

const allowedWeb = (u: URL) => parseWebUrl(u.href) !== null;

/** The preview of a web page, its picture inlined ("" when it has none or it is too big). Null when the page can't be read. */
export async function previewOf(target: URL): Promise<Preview | null> {
  const got = await fetchFollowing(target, allowedWeb, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
  if (!got || !got.res.ok) return null;
  const type = got.res.headers.get("Content-Type") ?? "";
  if (!/html|xml/i.test(type)) return { url: target.href, title: "", description: "", site: got.url.hostname.replace(/^www\./, ""), image: "" };
  const { bytes } = await readCapped(got.res, MAX_PAGE_BYTES);
  const charset = charsetOf(type, new TextDecoder("latin1").decode(bytes.subarray(0, 2048)));
  let html: string;
  try { html = new TextDecoder(charset).decode(bytes); } catch { html = new TextDecoder().decode(bytes); }
  const { imageUrl, ...page } = parsePage(html, got.url.href);
  return { ...page, url: target.href, image: imageUrl ? await inlineImage(imageUrl) : "" };
}

/** A picture as a small data URL, or "" when it can't be had (not an image, too big, slow). */
async function inlineImage(raw: string): Promise<string> {
  try {
    const start = parseWebUrl(raw);
    if (!start) return "";
    const got = await fetchFollowing(start, allowedWeb, "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8");
    if (!got || !got.res.ok) return "";
    const type = (got.res.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(png|jpeg|jpg|webp|gif|avif)$/.test(type)) return "";
    if (Number(got.res.headers.get("Content-Length") ?? 0) > MAX_IMAGE_BYTES) return "";
    const { bytes, truncated } = await readCapped(got.res, MAX_IMAGE_BYTES);
    if (truncated || bytes.length === 0) return "";
    return `data:${type};base64,${toBase64(bytes)}`;
  } catch {
    return "";
  }
}
