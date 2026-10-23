// What a note editor saves, and when. An open note keeps a "baseline": the note as this editor last
// loaded it from the store or saved it. Only the fields the user changed since then are written, and they
// go onto the record as it is stored now (not as it was when the note was opened), so an edit made on
// another device while the note is open isn't overwritten by text nobody touched here. A change that
// arrives from sync for a field the user hasn't touched is shown in the editor straight away.
import type { Item } from "./types.ts";

/**
 * The parts of a note its editor can change. [tags] is the names, space separated. (Notes no longer have
 * a place: a place stored on an older note is never written here, so it's kept as it is.)
 */
export interface NoteDraft {
  title: string; content: string; tags: string;
  pinned: boolean; bgColor: number | null; bgPattern: number; fontFamily: number; categoryId: number | null; color: number | null;
  hidden: boolean;
}
export type NoteField = keyof NoteDraft;
export const NOTE_FIELDS: readonly NoteField[] = ["title", "content", "tags", "pinned", "bgColor", "bgPattern", "fontFamily", "categoryId", "color", "hidden"];

/**
 * What the editor last loaded or saved: [stored] is that note as stored; [shownContent] its text as the
 * editor reads it back (the editor tidies HTML, so its text can differ from the stored string with no edit).
 */
export interface NoteBaseline { stored: NoteDraft; shownContent: string }

/** Tag names as typed ("#a b, c") in a fixed form, for comparing. */
export function tagNames(tags: string): string[] {
  return [...new Set(tags.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean))];
}
const tagKey = (t: string) => tagNames(t).map((n) => n.toLowerCase()).sort().join(" ");
const sameTags = (a: string, b: string) => tagKey(a) === tagKey(b);

export function draftOf(item: Item, tags: string[] | string): NoteDraft {
  return {
    title: item.title, content: item.content, tags: Array.isArray(tags) ? tags.join(" ") : tags,
    pinned: item.pinned, bgColor: item.bgColor, bgPattern: item.bgPattern, fontFamily: item.fontFamily,
    categoryId: item.categoryId, color: item.color, hidden: item.hidden ?? false,
  };
}

/**
 * The editor's text now: from its handle, else from its element (React has already cleared the handle
 * when a leaving note's cleanup runs, but the element still holds the text), else null: unknown, which
 * counts as unchanged. Never the text as it was opened: saving that on leaving reverted every edit.
 */
export function editorText(fromHandle: (() => string) | undefined, fromElement: (() => string) | undefined): string | null {
  return fromHandle ? fromHandle() : fromElement ? fromElement() : null;
}

export function baselineOf(item: Item, tags: string[] | string, shownContent = item.content): NoteBaseline {
  return { stored: draftOf(item, tags), shownContent };
}

/**
 * The fields the user changed since [baseline]. [current] is the editor now; its content is null when the
 * editor can't be read (then the text counts as unchanged: never the opened text written back).
 */
export function localChanges(baseline: NoteBaseline, current: Omit<NoteDraft, "content"> & { content: string | null }): Partial<NoteDraft> {
  const out: Partial<NoteDraft> = {};
  for (const f of NOTE_FIELDS) {
    if (f === "content") { if (current.content !== null && current.content !== baseline.shownContent) out.content = current.content; }
    else if (f === "title") { if (current.title.trim() !== baseline.stored.title.trim()) out.title = current.title.trim(); }
    else if (f === "tags") { if (!sameTags(current.tags, baseline.stored.tags)) out.tags = tagNames(current.tags).join(" "); }
    else if (current[f] !== baseline.stored[f]) (out as Record<string, unknown>)[f] = current[f];
  }
  return out;
}

/**
 * The record to save for [changes], written onto the note as stored now ([stored]; [fallback] for a note
 * not saved yet, or gone from the store). Null when there's nothing to save. [tags] is set only when the
 * tags changed here.
 */
export function noteToSave(stored: Item | null, fallback: Item, changes: Partial<NoteDraft>): { item: Item; tags?: string[] } | null {
  if (!Object.keys(changes).length) return null;
  const { tags, ...fields } = changes;
  return { item: { ...(stored ?? fallback), ...fields }, ...(tags !== undefined ? { tags: tagNames(tags) } : {}) };
}

/** The baseline after a save of [changes]: the stored note now holds them, and the editor shows them. */
export function afterSave(baseline: NoteBaseline, changes: Partial<NoteDraft>): NoteBaseline {
  return { stored: { ...baseline.stored, ...changes }, shownContent: changes.content ?? baseline.shownContent };
}

/**
 * A note changed in the store (sync) while open. Returns the fields to put into the editor: every one
 * that changed there and that the user hasn't changed here (the user's own unsaved edits stay and are
 * saved over it). The returned baseline takes the stored values of those fields; when the content is
 * reloaded, [shownContent] must be read back from the editor once it shows it (it's set to the stored
 * text until then).
 */
export function rebase(baseline: NoteBaseline, current: Omit<NoteDraft, "content"> & { content: string | null }, storedNow: NoteDraft):
  { load: Partial<NoteDraft>; baseline: NoteBaseline } {
  const mine = localChanges(baseline, current);
  const load: Partial<NoteDraft> = {};
  const stored = { ...baseline.stored };
  let shownContent = baseline.shownContent;
  for (const f of NOTE_FIELDS) {
    const theirs = f === "tags" ? !sameTags(storedNow.tags, baseline.stored.tags) : storedNow[f] !== baseline.stored[f];
    if (!theirs) continue;
    (stored as Record<string, unknown>)[f] = storedNow[f];
    if (f in mine) continue;
    (load as Record<string, unknown>)[f] = storedNow[f];
    if (f === "content") shownContent = storedNow.content;
  }
  return { load, baseline: { stored, shownContent } };
}
