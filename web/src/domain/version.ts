// App versions and release notes, for the phone's update check (ui/phone/update.ts).

/** "v2.10" / "2.10.1" / "V3" -> [2, 10] / [2, 10, 1] / [3]; null when it isn't a version. */
export function parseVersion(v: string): number[] | null {
  const m = v.trim().match(/^v?(\d+(?:\.\d+)*)/i);
  return m ? m[1].split(".").map(Number) : null;
}

/** Negative, 0 or positive as [a] is older, the same as, or newer than [b]; missing parts count as 0 (2.1 = 2.1.0). */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? [], y = parseVersion(b) ?? [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Whether release tag [tag] is newer than the [installed] version; false when either isn't a version. */
export function isNewerVersion(tag: string, installed: string): boolean {
  if (!parseVersion(tag) || !parseVersion(installed)) return false;
  return compareVersions(tag, installed) > 0;
}

/** One line of release notes, for a calm plain-text rendering (no HTML from the release is used). */
/** How often the app asks GitHub for a new release by itself: on a fresh start or a return to the app. */
export const UPDATE_CHECK_EVERY_MS = 6 * 3600_000;

/**
 * Whether an automatic update check is due at [now], the last one having been at [lastAt] (0: never).
 * A clock set back (last check "in the future") counts as due, so a wrong date never stops the checks.
 */
export function updateCheckDue(lastAt: number, now: number, every = UPDATE_CHECK_EVERY_MS): boolean {
  if (!Number.isFinite(lastAt) || lastAt <= 0) return true;
  return now < lastAt || now - lastAt >= every;
}

export interface NoteBlock { kind: "heading" | "bullet" | "text"; text: string }

/**
 * Release notes written in GitHub markdown, as simple blocks: headings, bullets and text, with the
 * inline marks (bold, code, links) reduced to their text. Blank lines are dropped.
 */
export function releaseNoteBlocks(body: string): NoteBlock[] {
  const inline = (s: string) => s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])[*_]([^*_]+)[*_](?=[^*\w]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
  const out: NoteBlock[] = [];
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    const b = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (h) out.push({ kind: "heading", text: inline(h[1]) });
    else if (b) out.push({ kind: "bullet", text: inline(b[1]) });
    else out.push({ kind: "text", text: inline(line) });
  }
  return out.filter((x) => x.text);
}
