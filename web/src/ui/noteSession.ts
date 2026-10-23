// One open note, for both note editors (the phone's PhoneNote and the PC's NoteEditor): what it shows,
// and saving it. Saved a moment after each change, at once when the app is put away, and on leaving;
// only what the user changed is written, onto the note as it's stored now (domain/noteDraft.ts), so an
// edit that came from another device while the note was open stays. Such an edit shows in the editor
// as it arrives, unless the user has changed that part here (then theirs is kept and saved).
import { useEffect, useRef, useState } from "react";
import { type NoteBaseline, type NoteDraft, afterSave, baselineOf, draftOf, localChanges, noteToSave, rebase } from "../domain/noteDraft.ts";
import { type Item, newItem } from "../domain/types.ts";
import { allRecords, deleteIfEmpty, isEmptyNote, onFlush, saveItem, saveVersion, type Snapshot, snapshot, useSnapshot } from "../store/store.ts";
import { type RichEditorHandle, useEditorHtml } from "./RichEditor.tsx";

export interface NoteStyle { pinned: boolean; bgColor: number | null; bgPattern: number; fontFamily: number; categoryId: number | null; color: number | null }
export interface NotePlace { location: string; lat: number | null; lng: number | null }

const styleOf = (i: Item): NoteStyle => ({ pinned: i.pinned, bgColor: i.bgColor, bgPattern: i.bgPattern, fontFamily: i.fontFamily, categoryId: i.categoryId, color: i.color });
const tagsOf = (s: Snapshot, id: number) => (s.tagsByItem.get(id) ?? []).map((t) => t.name).join(" ");
/** The note as stored, trashed or not (undefined when it's gone). */
const storedItem = (id: number) => (id ? allRecords().get(`items/${id}`) as Item | undefined : undefined);

export function useNoteSession({ id, day, newTitle }: { id: number | null; day: number | null; newTitle: (day: number) => string }) {
  const s = useSnapshot();
  const [base] = useState<Item>(() => (id !== null ? s.byId.get(id) : undefined) ?? newItem({ type: "NOTE", noteDay: day, title: day !== null ? newTitle(day) : "" }));
  const [noteId, setNoteId] = useState(base.id);
  const [title, setTitleState] = useState(base.title);
  const [tags, setTagsState] = useState(() => tagsOf(s, base.id));
  const [style, setStyleState] = useState<NoteStyle>(() => styleOf(base));
  const [place, setPlaceState] = useState<NotePlace>({ location: base.location ?? "", lat: base.lat ?? null, lng: base.lng ?? null });
  // What the editor is told to show; [n] makes it show the same text again.
  const [content, setContentState] = useState({ html: base.content, n: 0 });
  const rich = useRef<RichEditorHandle>(null);
  const baseline = useRef<NoteBaseline>(baselineOf(base, tags));
  // The editor's own reading of text it was given from the store is taken once it shows it.
  const readBack = useRef(true);
  const latest = useRef({ noteId, title, tags, style, place });
  latest.current = { noteId, title, tags, style, place };
  const opened = useRef(base.content);
  const contentSaved = useRef(false);
  const deleted = useRef(false);
  const leaving = useRef(false);
  const timer = useRef<number>();
  const html = useEditorHtml(rich);

  useEffect(() => {
    if (!readBack.current) return;
    readBack.current = false;
    const h = html();
    if (h !== null) baseline.current = { ...baseline.current, shownContent: h };
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The editor now (content null while text from the store is still on its way in). */
  const current = () => {
    const l = latest.current;
    return { title: l.title, tags: l.tags, ...l.style, ...l.place, content: readBack.current ? null : html() };
  };
  const adopt = (saved: number) => {
    if (saved === latest.current.noteId) return;
    latest.current.noteId = saved;
    if (leaving.current) return; // the page shown now is another one
    setNoteId(saved);
    history.replaceState(null, "", `#/note/${saved}`);
  };

  /** Saves what changed here, if anything; [force] saves a new note even untouched (to attach pictures to). Returns its id (0: not saved). */
  const save = (force = false): number => {
    clearTimeout(timer.current);
    const changes = localChanges(baseline.current, current());
    const nid = latest.current.noteId;
    const stored = storedItem(nid) ?? null;
    const plan = noteToSave(stored, { ...base, id: nid }, changes) ?? (force && !nid ? { item: base } : null);
    if (!plan) return nid;
    if (plan.item.id === 0 && !force && isEmptyNote(plan.item)) return 0;
    const saved = saveItem(plan.item, plan.tags ? { tags: plan.tags } : {});
    baseline.current = afterSave(baseline.current, changes);
    if (changes.content !== undefined) contentSaved.current = true;
    adopt(saved);
    return saved;
  };
  const scheduleSave = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (!deleted.current) save(); }, 600); };
  // Put away: saved at once. Also catches text changed without an input event (some keyboards' corrections).
  useEffect(() => onFlush(() => { if (!deleted.current) save(); }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // A change to this note from elsewhere (sync): shown, except where the user has changed it here.
  useEffect(() => {
    const nid = latest.current.noteId;
    const rec = nid ? s.byId.get(nid) : undefined;
    if (!rec) return;
    const r = rebase(baseline.current, current(), draftOf(rec, tagsOf(s, nid)));
    baseline.current = r.baseline;
    load(r.load);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = (d: Partial<NoteDraft>) => {
    const l = latest.current;
    if (d.title !== undefined) { l.title = d.title; setTitleState(d.title); }
    if (d.tags !== undefined) { l.tags = d.tags; setTagsState(d.tags); }
    const st: Partial<NoteStyle> = {};
    for (const k of ["pinned", "bgColor", "bgPattern", "fontFamily", "categoryId", "color"] as const) if (k in d) (st as Record<string, unknown>)[k] = d[k];
    if (Object.keys(st).length) { l.style = { ...l.style, ...st }; setStyleState(l.style); }
    if ("location" in d || "lat" in d || "lng" in d) {
      l.place = { location: d.location ?? l.place.location, lat: "lat" in d ? d.lat! : l.place.lat, lng: "lng" in d ? d.lng! : l.place.lng };
      setPlaceState(l.place);
    }
    if (d.content !== undefined) { readBack.current = true; setContentState((c) => ({ html: d.content!, n: c.n + 1 })); }
  };

  // On leaving: saved if changed; a version kept if the text changed; the note dropped if it ended up empty.
  useEffect(() => { leaving.current = false; return () => {
    clearTimeout(timer.current);
    if (deleted.current) return;
    leaving.current = true;
    const savedId = save();
    if (!savedId) return;
    const fresh = storedItem(savedId);
    if (!fresh || fresh.deletedAt !== null) return;
    if (isEmptyNote(fresh)) { deleteIfEmpty(savedId); return; }
    if (contentSaved.current && fresh.content !== opened.current) saveVersion(snapshot().byId.get(savedId) ?? fresh);
  }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The user's own changes: shown, and saved shortly after.
  const edit = <T,>(set: (v: T) => void, key: "title" | "tags" | "style" | "place") => (v: T) => {
    (latest.current as Record<string, unknown>)[key] = v;
    set(v);
    scheduleSave();
  };
  return {
    s, base, rich, noteId,
    title, setTitle: edit(setTitleState, "title"),
    tags, setTags: edit(setTagsState, "tags"),
    style, setStyle: edit(setStyleState, "style"),
    place, setPlace: edit(setPlaceState, "place"),
    /** The text to give the editor, and its revision. */
    content: content.html, revision: content.n,
    /** Replaces the text (a template, an earlier version): a change of the user's, saved. */
    setContent: (h: string) => { setContentState((c) => ({ html: h, n: c.n + 1 })); scheduleSave(); },
    /** For the editor's onChange. */
    changed: scheduleSave,
    save,
    /** The note was moved to the trash: nothing more is saved. */
    markDeleted: () => { deleted.current = true; clearTimeout(timer.current); },
  };
}
