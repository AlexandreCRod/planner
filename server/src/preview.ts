// Web link previews: which addresses may be fetched, and the title, description, site name and picture
// read out of a page's HTML. The pure parts live here (checked by test/preview.test.ts); the fetching is in web.ts.

/** What the app gets back for a web link. [image] is a small data URL (or "") so the device never contacts the site. */
export interface Preview { url: string; title: string; description: string; site: string; image: string }

/** Whether [host] is the machine itself or a private-network address (so the Worker is never aimed at one). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
  if (h.includes(":")) {
    // IPv6: IPv4 inside it (::ffff:a.b.c.d, or its hex form) is judged as that IPv4; loopback,
    // unspecified, unique-local and link-local are private.
    const mapped = h.match(/^(?:0*:)*:?(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHost(mapped[1]);
    const hex = h.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
      return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^(?:0*:)*:?[01]?$/.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  }
  // IPv4 literals, also the odd spellings (one number, hex or octal parts) browsers accept.
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/.test(h)) {
    const parts = h.split(".").map((p) => (/^0x/.test(p) ? parseInt(p, 16) : /^0\d/.test(p) ? parseInt(p, 8) : Number(p)));
    if (parts.some((n) => !Number.isFinite(n))) return true;
    const last = parts[parts.length - 1];
    let n = last;
    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i] > 255) return true;
      n += parts[i] * 256 ** (3 - i);
    }
    if (n > 0xffffffff) return true;
    const a = Math.floor(n / 2 ** 24), b = Math.floor(n / 65536) % 256;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  return false;
}

/** [raw] as an address the Worker may fetch (http or https, no sign-in part, not a private host), else null. */
export function parseWebUrl(raw: string | null | undefined): URL | null {
  if (!raw || raw.length > 2000) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (isPrivateHost(u.hostname)) return null;
  return u;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const safeChar = (code: number, fallback: string) => { try { return String.fromCodePoint(code); } catch { return fallback; } };

/** HTML text as plain text: entities decoded, whitespace folded. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (m, n) => safeChar(Number(n), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => safeChar(parseInt(n, 16), m))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** The attributes of one tag, names lowercased. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** Title, description, site name and picture address from a page's HTML ([pageUrl] resolves relative addresses). */
export function parsePage(html: string, pageUrl: string): Omit<Preview, "image"> & { imageUrl: string } {
  const head = html.slice(0, 300_000);
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if (key && a.content !== undefined && meta[key] === undefined) meta[key] = decodeEntities(a.content);
  }
  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const title = meta["og:title"] || meta["twitter:title"] || (titleTag ? decodeEntities(titleTag) : "");
  const description = meta["og:description"] || meta["twitter:description"] || meta["description"] || "";
  const site = meta["og:site_name"] || host;
  const rawImage = meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || meta["twitter:image:src"] || "";
  let imageUrl = "";
  if (rawImage) { try { imageUrl = new URL(rawImage, pageUrl).href; } catch { /* not an address */ } }
  return { url: pageUrl, title: clip(title, 200), description: clip(description, 400), site: clip(site, 80), imageUrl };
}

/** Base64 of [bytes] (a Worker has btoa but no Buffer). */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The charset a page names in its Content-Type or early meta tag (utf-8 when none). */
export function charsetOf(contentType: string, head: string): string {
  const m = contentType.match(/charset\s*=\s*"?([\w-]+)/i) ?? head.slice(0, 2048).match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i);
  return m ? m[1].toLowerCase() : "utf-8";
}
