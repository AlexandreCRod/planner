// Searching the training plan (Training's search): its sessions, its exercises and the words in its
// documents, in one go. Matching ignores case and accents, as everywhere else (find.ts). Also the parts
// of an exercise's guide card that its sheet shows apart (the video link, the rest).

import { findMatches } from "./find.ts";
import { anchorsIn, inlines, plainOf } from "./markdown.ts";
import type { Plan } from "./training.ts";

export interface SessionHit {
  id: string; title: string; phase: number;
  /** What matched besides the title: exercise names, the detail, an extra line. */
  matched: string[];
}
export interface ExerciseHit { id: string; name: string }
export interface GuideHit {
  file: string; doc: string;
  /** The place to open the document at: its section's heading (null before the first heading). */
  anchor: string | null;
  heading: string;
  /** The line that matched, cut short around the match ("" when only the heading did). */
  text: string;
}
export interface TrainingHits { sessions: SessionHit[]; exercises: ExerciseHit[]; guides: GuideHit[] }

const has = (text: string, q: string) => findMatches(text, q).length > 0;

/** [text] cut to about [max] characters around its first match of [q], with "…" where it's cut. */
export function snippet(text: string, q: string, max = 90): string {
  if (text.length <= max) return text;
  const m = findMatches(text, q)[0];
  let from = m ? Math.max(0, m[0] - 30) : 0;
  if (from > 0) { const sp = text.lastIndexOf(" ", from); from = sp > from - 12 ? sp + 1 : from; }
  let to = Math.min(text.length, from + max);
  if (to < text.length) { const sp = text.lastIndexOf(" ", to); to = sp > from + max / 2 ? sp : to; }
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

/** One line of a document as plain words: no markers, tags or link targets. */
function plainLine(line: string): string {
  const t = line
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*(>\s*)+/, "")
    .replace(/^\s*([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s*\|\s*/g, " ")
    .trim();
  return plainOf(inlines(t)).trim();
}

const ANCHOR_LINE = /^\s*<a\s+id="[^"]+"\s*>\s*<\/a>\s*$/i;
const RULE_LINE = /^\s*(\|?\s*:?-{2,}:?\s*)+\|?\s*$|^\s{0,3}([-*_])(\s*\2){2,}\s*$/;

/** The sections of [md] whose words match [q]: one hit each, at its first matching line. */
function findInDoc(file: string, doc: string, md: string, q: string): GuideHit[] {
  const idAt = new Map<number, string>();
  for (const [id, line] of anchorsIn(md)) if (!idAt.has(line)) idAt.set(line, id);
  const out: GuideHit[] = [];
  let cur: GuideHit | null = null;
  let heading = doc;
  let anchor: string | null = null;
  let fence = false;
  md.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
    const isHeading = !fence && /^\s*#{1,6}\s+/.test(line);
    if (isHeading) {
      heading = plainLine(line);
      // The heading's own id (a fixed anchor on the line before points at the same place).
      anchor = idAt.get(i) ?? anchor;
      cur = null;
      if (has(heading, q)) { cur = { file, doc, anchor, heading, text: "" }; out.push(cur); }
      return;
    }
    if (!line.trim() || ANCHOR_LINE.test(line) || RULE_LINE.test(line)) return;
    const text = plainLine(line);
    if (!text || !has(text, q)) return;
    if (!cur) { cur = { file, doc, anchor, heading, text: snippet(text, q) }; out.push(cur); }
    else if (!cur.text) cur.text = snippet(text, q);
  });
  return out;
}

/** Everything in [plan] (and its documents, [docs]) that [query] finds; nothing for an empty query. */
export function findInTraining(plan: Plan, docs: ReadonlyMap<string, string>, query: string, limit = 60): TrainingHits {
  const q = query.trim();
  if (!q) return { sessions: [], exercises: [], guides: [] };
  const nameOf = new Map(plan.exercises.map((e) => [e.id, e.name]));
  const sessions: SessionHit[] = [];
  for (const [phase, ph] of plan.phases.entries()) {
    for (const s of ph.sessions) {
      const names = [...new Set(s.exercises.flatMap((x) => [x.exercise, ...x.swaps.map((w) => w.exercise)]).map((id) => nameOf.get(id) ?? id))];
      const matched = [...names, s.detail, ...s.extra].filter((t) => t && has(t, q));
      if (has(s.title, q) || matched.length) sessions.push({ id: s.id, title: s.title, phase, matched: [...new Set(matched)] });
    }
  }
  const starts = (name: string) => findMatches(name, q).some(([a]) => a === 0 || /\s/.test(name[a - 1]));
  const exercises = plan.exercises.filter((e) => has(e.name, q))
    .map((e, k) => ({ e, k, w: starts(e.name) ? 0 : 1 }))
    .sort((a, b) => a.w - b.w || a.k - b.k)
    .map(({ e }) => ({ id: e.id, name: e.name }));
  const guides = plan.documents.flatMap((d) => {
    const md = docs.get(d.file);
    return md ? findInDoc(d.file, d.title, md, q) : [];
  });
  return { sessions: sessions.slice(0, limit), exercises: exercises.slice(0, limit), guides: guides.slice(0, limit) };
}

// ---------- An exercise's guide card, in parts ----------

export interface GuideParts {
  /** The card's video link (a YouTube search, as the guide writes them), and what it searches for. */
  video: { url: string; query: string | null } | null;
  /** The card without its heading and its video link. */
  body: string;
}

const LINK = /\[([^\]]*)\]\((https?:[^)\s]+)\)/g;

/** Splits a guide card (a section from [sectionAt]) into its video link and the rest. */
export function guideParts(section: string): GuideParts {
  let video: GuideParts["video"] = null;
  const lines = section.split(/\r?\n/);
  if (lines.length && /^\s*#{1,6}\s+/.test(lines[0])) lines.shift();
  const out: string[] = [];
  for (const line of lines) {
    let kept = line;
    if (!video) {
      for (const m of line.matchAll(LINK)) {
        if (!/video|watch/i.test(m[1]) && !/youtu\.?be/i.test(m[2])) continue;
        let query: string | null = null;
        try { query = new URL(m[2]).searchParams.get("search_query"); } catch { /* not a URL */ }
        video = { url: m[2], query: query && query.trim() ? query.trim() : null };
        kept = line.replace(m[0], "").replace(/\s+([.,;])?\s*$/, "").replace(/\s{2,}/g, " ");
        break;
      }
    }
    // A line that held only the link goes with it.
    if (kept !== line && !kept.replace(/^\s*([-*+]|\d{1,9}[.)])?\s*/, "").trim()) continue;
    out.push(kept);
  }
  return { video, body: out.join("\n").trim() };
}
